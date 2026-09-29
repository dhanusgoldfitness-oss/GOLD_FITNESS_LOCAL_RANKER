import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { audit as auditLog, db } from '../lib/supabase.js';
import { configured, config } from '../config.js';
import { makeGrid, rankChange } from '../lib/geogrid.js';
import { placeDetails, rankOf, searchPlaces } from '../lib/places.js';
import * as G from '../lib/google.js';
import { ownLocation, spendCredit } from './gbp.js';
import { fireEvent } from '../lib/automation.js';
import { geminiJson } from '../lib/gemini.js';
import { isUnlimited, UNLIMITED } from '../lib/unlimited.js';

export const growth = Router();
growth.use(auth);

async function planLimits(uid: string) {
  if (await isUnlimited(uid)) return { keyword_limit: UNLIMITED, scan_limit: UNLIMITED, location_limit: UNLIMITED };
  const { data } = await db().from('subscriptions').select('plans(*)').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const p: any = (data as any)?.plans ?? { keyword_limit: 5, scan_limit: 2, location_limit: 1 };
  return p as { keyword_limit: number; scan_limit: number; location_limit: number };
}

/** Ensure the location has a Google place id + coordinates (needed to rank it). */
export async function ensureGeo(uid: string, loc: any) {
  if (loc.place_id && loc.lat != null && loc.lng != null) return loc;
  const placeId: string | undefined = loc.place_id ?? loc.profile?.metadata?.placeId;
  if (!placeId) throw new ApiError(409, 'API_PENDING', 'This location has no Google place id yet. Refresh the profile from Google Business first.');
  const d = await placeDetails(placeId);
  const upd = { place_id: placeId, lat: d.lat ?? loc.profile?.latlng?.latitude ?? null, lng: d.lng ?? loc.profile?.latlng?.longitude ?? null };
  if (upd.lat == null || upd.lng == null) throw new ApiError(409, 'API_PENDING', 'Could not determine coordinates for this location.');
  await db().from('business_locations').update(upd).eq('id', loc.id).eq('user_id', uid);
  return { ...loc, ...upd };
}

// ================= keywords (phase 10) =================
growth.get('/locations/:id/keywords', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const { data: kws } = await db().from('keywords').select('*').eq('location_id', loc.id).eq('user_id', uid).order('created_at');
  const ids = (kws ?? []).map((k) => k.id);
  const { data: hist } = ids.length ? await db().from('keyword_rank_history').select('keyword_id,rank,status,checked_at').in('keyword_id', ids).order('checked_at', { ascending: false }).limit(2000) : { data: [] as any[] };
  const by = new Map<string, any[]>();
  for (const h of hist ?? []) { (by.get(h.keyword_id) ?? by.set(h.keyword_id, []).get(h.keyword_id)!).push(h); }
  res.json({
    keywords: (kws ?? []).map((k) => {
      const h = by.get(k.id) ?? [];
      const okH = h.filter((x) => x.status !== 'failed');
      return { ...k, current: okH[0] ?? null, previous: okH[1] ?? null, change: rankChange(okH[1]?.rank, okH[0]?.rank), history: h.slice(0, 90).reverse() };
    }),
    limit: (await planLimits(uid)).keyword_limit, provider: configured.maps ? 'CONNECTED' : 'NOT_CONNECTED',
  });
}));

growth.post('/locations/:id/keywords', validate(z.object({ keyword: z.string().trim().min(2).max(80) })), wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const { count } = await db().from('keywords').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  const lim = (await planLimits(uid)).keyword_limit;
  if ((count ?? 0) >= lim) throw new ApiError(403, 'LIMIT_REACHED', `Your plan allows ${lim} tracked keywords. Delete one or upgrade.`);
  const { data, error } = await db().from('keywords').insert({ user_id: uid, location_id: loc.id, keyword: req.body.keyword.toLowerCase() }).select().single();
  if (error) throw new ApiError(error.code === '23505' ? 409 : 400, 'VALIDATION', error.code === '23505' ? 'You already track this keyword.' : 'Could not save keyword.');
  res.status(201).json({ keyword: data });
}));

growth.patch('/keywords/:id', validate(z.object({ active: z.boolean() })), wrap(async (req, res) => {
  await db().from('keywords').update({ active: req.body.active }).eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));
growth.delete('/keywords/:id', wrap(async (req, res) => {
  await db().from('keywords').delete().eq('id', req.params.id).eq('user_id', req.user!.id);   // history cascades only on explicit delete
  res.json({ ok: true });
}));

/** Run a rank check for one keyword. Always appends a history row (never overwrites). */
export async function checkKeyword(uid: string, kw: any, loc: any) {
  try {
    const l = await ensureGeo(uid, loc);
    const hits = await searchPlaces(`${kw.keyword}`, l.lat, l.lng, 3000, 20);
    const rank = rankOf(hits, l.place_id);
    await db().from('keyword_rank_history').insert({ user_id: uid, keyword_id: kw.id, rank, status: rank ? 'ok' : 'not_found' });
    return { rank, status: rank ? 'ok' : 'not_found' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed';
    await db().from('keyword_rank_history').insert({ user_id: uid, keyword_id: kw.id, rank: null, status: 'failed', error: msg });   // failure is recorded, not faked as a rank
    throw e;
  }
}

growth.post('/locations/:id/keywords/check', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const { data: kws } = await db().from('keywords').select('*').eq('location_id', loc.id).eq('user_id', uid).eq('active', true);
  if (!kws?.length) throw new ApiError(400, 'VALIDATION', 'Add at least one active keyword first.');
  const results: any[] = []; let firstErr: unknown;
  for (const k of kws) {
    const before = await db().from('keyword_rank_history').select('rank').eq('keyword_id', k.id).neq('status', 'failed').order('checked_at', { ascending: false }).limit(1).maybeSingle();
    try {
      const r = await checkKeyword(uid, k, loc);
      results.push({ keyword: k.keyword, ...r });
      const drop = before.data?.rank != null && r.rank != null ? r.rank - before.data.rank : null;
      if (drop && drop > 0) await fireEvent(uid, 'rank_drop', `rank-${k.id}-${new Date().toISOString().slice(0, 10)}`, { keyword: k.keyword, drop, rank: r.rank });
    } catch (e) { firstErr ??= e; results.push({ keyword: k.keyword, status: 'failed', error: (e as Error).message }); }
  }
  if (results.every((r) => r.status === 'failed') && firstErr) throw firstErr;
  res.json({ results });
}));

growth.post('/locations/:id/keywords/suggest', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const settle = await spendCredit(uid, 'keyword_suggest');
  try {
    const out = await geminiJson<{ keywords: string[] }>(`Suggest 12 high-intent local search phrases people in ${loc.city ?? 'the area'} would use to find a "${loc.primary_category ?? 'gym'}" like "${loc.title}". Real search phrasing only, no brand names of competitors. Return JSON {"keywords": string[]}`);
    await settle(true);
    res.json({ keywords: (out.keywords ?? []).map((k) => String(k).toLowerCase().slice(0, 80)).slice(0, 12), note: 'AI suggestions — not measured search volume.' });
  } catch (e) { await settle(false); throw e; }
}));

// ================= geo-grid (phase 11) =================
growth.post('/locations/:id/geo-scans', validate(z.object({ keyword: z.string().trim().min(2).max(80), grid_size: z.union([z.literal(3), z.literal(5), z.literal(7)]).default(5), radius_km: z.coerce.number().min(0.5).max(25).default(3) })), wrap(async (req, res) => {
  const uid = req.user!.id; const loc0 = await ownLocation(uid, req.params.id);
  const lim = (await planLimits(uid)).scan_limit;
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db().from('geo_scans').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', monthStart.toISOString());
  if ((count ?? 0) >= lim) throw new ApiError(403, 'LIMIT_REACHED', `Your plan allows ${lim} geo-grid scans per month.`);
  const loc = await ensureGeo(uid, loc0);
  const pts = makeGrid(loc.lat, loc.lng, req.body.grid_size, req.body.radius_km);
  const { data: scan } = await db().from('geo_scans').insert({ user_id: uid, location_id: loc.id, keyword: req.body.keyword.toLowerCase(), center_lat: loc.lat, center_lng: loc.lng, grid_size: req.body.grid_size, radius_km: req.body.radius_km }).select().single();
  const rows: any[] = [];
  const CONC = 5;
  for (let i = 0; i < pts.length; i += CONC) {
    await Promise.all(pts.slice(i, i + CONC).map(async (p) => {
      try {
        const hits = await searchPlaces(scan!.keyword, p.lat, p.lng, 1500, 20);
        const rank = rankOf(hits, loc.place_id);
        rows.push({ scan_id: scan!.id, idx: p.idx, lat: p.lat, lng: p.lng, rank, status: rank ? 'ok' : 'not_found' });
      } catch (e) {
        rows.push({ scan_id: scan!.id, idx: p.idx, lat: p.lat, lng: p.lng, rank: null, status: 'failed', error: (e as Error).message.slice(0, 200) });   // marked failed, never fabricated
      }
    }));
  }
  await db().from('geo_scan_points').insert(rows);
  const failed = rows.filter((r) => r.status === 'failed').length;
  const status = failed === rows.length ? 'failed' : failed ? 'partial' : 'done';
  await db().from('geo_scans').update({ status }).eq('id', scan!.id);
  if (status === 'failed') throw new ApiError(502, 'UPSTREAM', rows[0]?.error ?? 'All grid points failed.');
  res.status(201).json({ scan: { ...scan, status }, points: rows.sort((a, b) => a.idx - b.idx) });
}));

growth.get('/locations/:id/geo-scans', wrap(async (req, res) => {
  const loc = await ownLocation(req.user!.id, req.params.id);
  const { data } = await db().from('geo_scans').select('*').eq('location_id', loc.id).eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(30);
  res.json({ scans: data ?? [] });
}));
growth.get('/geo-scans/:id', wrap(async (req, res) => {
  const { data: scan } = await db().from('geo_scans').select('*').eq('id', req.params.id).eq('user_id', req.user!.id).maybeSingle();
  if (!scan) throw new ApiError(404, 'NOT_FOUND', 'Scan not found.');
  const { data: points } = await db().from('geo_scan_points').select('*').eq('scan_id', scan.id).order('idx');
  res.json({ scan, points: points ?? [] });
}));

// ================= competitors (phase 12) =================
growth.get('/locations/:id/competitors', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const { data: comps } = await db().from('competitors').select('*').eq('location_id', loc.id).eq('user_id', uid).order('created_at');
  const ids = (comps ?? []).map((c) => c.id);
  const { data: snaps } = ids.length ? await db().from('competitor_snapshots').select('*').in('competitor_id', ids).order('captured_at', { ascending: false }).limit(1000) : { data: [] as any[] };
  const latest = new Map<string, any>();
  for (const s of snaps ?? []) if (!latest.has(s.competitor_id)) latest.set(s.competitor_id, s);
  const { data: mine } = await db().from('reviews').select('rating').eq('location_id', loc.id);
  const m = mine ?? [];
  res.json({
    me: { name: loc.title, reviews: m.length || null, rating: m.length ? +(m.reduce((a, r) => a + r.rating, 0) / m.length).toFixed(2) : null, category: loc.primary_category },
    competitors: (comps ?? []).map((c) => ({ ...c, latest: latest.get(c.id) ?? null })),
    provider: configured.maps ? 'CONNECTED' : 'NOT_CONNECTED',
  });
}));

growth.post('/locations/:id/competitors/discover', validate(z.object({ query: z.string().trim().min(2).max(80).optional() })), wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ensureGeo(uid, await ownLocation(uid, req.params.id));
  const hits = await searchPlaces(req.body.query ?? loc.primary_category ?? 'gym', loc.lat, loc.lng, 5000, 20);
  res.json({ candidates: hits.filter((h) => h.id !== loc.place_id).slice(0, 15), note: 'Suggestions only — you confirm which businesses count as competitors.' });
}));

growth.post('/locations/:id/competitors', validate(z.object({ place_id: z.string().min(5).max(200), name: z.string().min(1).max(200), address: z.string().max(300).optional() })), wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const { data, error } = await db().from('competitors').insert({ user_id: uid, location_id: loc.id, ...req.body }).select().single();
  if (error) throw new ApiError(error.code === '23505' ? 409 : 400, 'VALIDATION', error.code === '23505' ? 'Already tracked.' : 'Could not add competitor.');
  res.status(201).json({ competitor: data });
}));
growth.delete('/competitors/:id', wrap(async (req, res) => {
  await db().from('competitors').delete().eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));

/** Take a fresh snapshot per competitor (history kept). */
export async function snapshotCompetitors(uid: string, locationId: string) {
  const { data: comps } = await db().from('competitors').select('*').eq('location_id', locationId).eq('user_id', uid);
  let ok = 0;
  for (const c of comps ?? []) {
    try {
      const d = await placeDetails(c.place_id);
      await db().from('competitor_snapshots').insert({ competitor_id: c.id, rating: d.rating ?? null, review_count: d.reviews ?? null, primary_type: d.type ?? null });
      ok++;
    } catch { /* leave previous snapshot; surfaced by count */ }
  }
  return { total: comps?.length ?? 0, ok };
}
growth.post('/locations/:id/competitors/refresh', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  if (!configured.maps) throw new ApiError(503, 'NOT_CONNECTED', 'Google Maps Platform key is not configured.');
  const r = await snapshotCompetitors(uid, loc.id);
  res.json(r);
}));

growth.post('/locations/:id/competitors/gap-analysis', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const { data: comps } = await db().from('competitors').select('id,name').eq('location_id', loc.id).eq('user_id', uid);
  const rows: any[] = [];
  for (const c of comps ?? []) {
    const { data: s } = await db().from('competitor_snapshots').select('rating,review_count,primary_type,captured_at').eq('competitor_id', c.id).order('captured_at', { ascending: false }).limit(1).maybeSingle();
    if (s) rows.push({ name: c.name, ...s });
  }
  if (!rows.length) throw new ApiError(409, 'VALIDATION', 'No competitor data yet. Add competitors and refresh them first.');
  const { data: mine } = await db().from('reviews').select('rating').eq('location_id', loc.id);
  const my = { reviews: mine?.length ?? null, rating: mine?.length ? +(mine.reduce((a, r) => a + r.rating, 0) / mine.length).toFixed(2) : null };
  const settle = await spendCredit(uid, 'gap_analysis');
  try {
    const out = await geminiJson<{ actions: { title: string; why: string }[] }>(
      `Local SEO analyst. Use ONLY these measured numbers. Do not invent any metric. If a number is null, say it is unknown.\nMe: ${JSON.stringify(my)}\nCompetitors: ${JSON.stringify(rows)}\nReturn JSON {"actions":[{"title":string,"why":string (cite the number)}]} with at most 5 prioritised actions.`);
    await settle(true);
    res.json({ observed: { me: my, competitors: rows }, recommendations: (out.actions ?? []).slice(0, 5), note: 'Observed facts are measured; recommendations are AI-generated.' });
  } catch (e) { await settle(false); throw e; }
}));

// ================= performance analytics (phase 15) =================
const METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS'];
const ymd = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });

export async function syncPerformance(uid: string, loc: any, days = 90) {
  const end = new Date(Date.now() - 2 * 864e5), start = new Date(end.getTime() - days * 864e5);
  const s = ymd(start), e = ymd(end);
  const q = METRICS.map((m) => `dailyMetrics=${m}`).join('&') + `&dailyRange.startDate.year=${s.year}&dailyRange.startDate.month=${s.month}&dailyRange.startDate.day=${s.day}&dailyRange.endDate.year=${e.year}&dailyRange.endDate.month=${e.month}&dailyRange.endDate.day=${e.day}`;
  const r = await G.gget<any>(uid, `https://businessprofileperformance.googleapis.com/v1/${loc.google_location_id}:fetchMultiDailyMetricsTimeSeries?${q}`, 'Fetch performance');
  const rows: any[] = [];
  for (const series of r.multiDailyMetricTimeSeries ?? []) for (const m of series.dailyMetricTimeSeries ?? []) {
    for (const dv of m.timeSeries?.datedValues ?? []) {
      if (!dv.date) continue;   // missing value => not stored (unavailable), never coerced to 0
      rows.push({ user_id: uid, location_id: loc.id, metric: m.dailyMetric, day: `${dv.date.year}-${String(dv.date.month).padStart(2, '0')}-${String(dv.date.day).padStart(2, '0')}`, value: Number(dv.value ?? NaN), synced_at: new Date().toISOString() });
    }
  }
  const clean = rows.filter((x) => Number.isFinite(x.value));
  for (let i = 0; i < clean.length; i += 500) await db().from('performance_metrics').upsert(clean.slice(i, i + 500), { onConflict: 'location_id,metric,day' });
  return clean.length;
}
growth.post('/locations/:id/performance/sync', wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  res.json({ rows: await syncPerformance(uid, loc) });
}));
growth.get('/locations/:id/performance', validate(z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 180, 365].includes(d)).default(30) }), 'query'), wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.params.id);
  const days = (req.query as any).days as number;
  const end = new Date(); const cur0 = new Date(end.getTime() - days * 864e5), prev0 = new Date(cur0.getTime() - days * 864e5);
  const { data } = await db().from('performance_metrics').select('metric,day,value,synced_at').eq('location_id', loc.id).eq('user_id', uid).gte('day', prev0.toISOString().slice(0, 10)).limit(20000);
  const rows = data ?? [];
  const sum = (from: Date, to: Date, pred: (m: string) => boolean) => rows.filter((r) => r.day >= from.toISOString().slice(0, 10) && r.day < to.toISOString().slice(0, 10) && pred(r.metric)).reduce((a, r) => a + r.value, 0);
  const has = (from: Date, to: Date) => rows.some((r) => r.day >= from.toISOString().slice(0, 10) && r.day < to.toISOString().slice(0, 10));
  const defs: [string, (m: string) => boolean][] = [['impressions', (m) => m.startsWith('BUSINESS_IMPRESSIONS')], ['calls', (m) => m === 'CALL_CLICKS'], ['website', (m) => m === 'WEBSITE_CLICKS'], ['directions', (m) => m === 'BUSINESS_DIRECTION_REQUESTS']];
  const cards = defs.map(([k, p]) => {
    const c = sum(cur0, end, p), pv = sum(prev0, cur0, p);
    const known = has(cur0, end);
    return { key: k, value: known ? c : null, previous: has(prev0, cur0) ? pv : null, changePct: known && has(prev0, cur0) && pv > 0 ? Math.round(((c - pv) / pv) * 100) : null };   // null = unavailable, not zero
  });
  const daily = new Map<string, number>();
  for (const r of rows) if (r.day >= cur0.toISOString().slice(0, 10) && r.metric.startsWith('BUSINESS_IMPRESSIONS')) daily.set(r.day, (daily.get(r.day) ?? 0) + r.value);
  res.json({ days, cards, series: [...daily.entries()].sort().map(([day, impressions]) => ({ day, impressions })), lastSynced: rows.map((r) => r.synced_at).sort().pop() ?? null });
}));

// ================= reports (phase 16) =================
growth.post('/reports', validate(z.object({ location_id: z.string().uuid(), days: z.union([z.literal(30), z.literal(90), z.literal(180)]).default(30) })), wrap(async (req, res) => {
  const uid = req.user!.id; const loc = await ownLocation(uid, req.body.location_id);
  const end = new Date(), start = new Date(end.getTime() - req.body.days * 864e5);
  const s = start.toISOString().slice(0, 10), e = end.toISOString().slice(0, 10);
  const [audit, reviews, perf, kws, comps, posts] = await Promise.all([
    db().from('gbp_audits').select('score,created_at,recommendations').eq('location_id', loc.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db().from('reviews').select('rating,reply_status,review_time').eq('location_id', loc.id),
    db().from('performance_metrics').select('metric,value').eq('location_id', loc.id).gte('day', s).lte('day', e),
    db().from('keywords').select('id,keyword').eq('location_id', loc.id),
    db().from('competitors').select('id,name').eq('location_id', loc.id),
    db().from('content_posts').select('status').eq('location_id', loc.id).gte('created_at', start.toISOString()),
  ]);
  const rv = (reviews.data ?? []).filter((r) => r.review_time && r.review_time >= start.toISOString());
  const pm = perf.data ?? [];
  const tot = (p: (m: string) => boolean) => pm.filter((r) => p(r.metric)).reduce((a, r) => a + r.value, 0);
  const kwRows: any[] = [];
  for (const k of kws.data ?? []) {
    const { data: h } = await db().from('keyword_rank_history').select('rank,checked_at').eq('keyword_id', k.id).neq('status', 'failed').order('checked_at', { ascending: false }).limit(1).maybeSingle();
    kwRows.push({ keyword: k.keyword, rank: h?.rank ?? null, checked_at: h?.checked_at ?? null });
  }
  const compRows: any[] = [];
  for (const c of comps.data ?? []) {
    const { data: sn } = await db().from('competitor_snapshots').select('rating,review_count,captured_at').eq('competitor_id', c.id).order('captured_at', { ascending: false }).limit(1).maybeSingle();
    compRows.push({ name: c.name, rating: sn?.rating ?? null, reviews: sn?.review_count ?? null, captured_at: sn?.captured_at ?? null });
  }
  const snapshot = {
    generatedAt: new Date().toISOString(), business: loc.title, period: { start: s, end: e },
    audit: audit.data ? { score: audit.data.score, at: audit.data.created_at, top: (audit.data.recommendations as any[]).slice(0, 5) } : null,
    reviews: { newInPeriod: rv.length, avgInPeriod: rv.length ? +(rv.reduce((a, r) => a + r.rating, 0) / rv.length).toFixed(2) : null, unanswered: (reviews.data ?? []).filter((r) => r.reply_status !== 'published').length },
    performance: pm.length ? { impressions: tot((m) => m.startsWith('BUSINESS_IMPRESSIONS')), calls: tot((m) => m === 'CALL_CLICKS'), website: tot((m) => m === 'WEBSITE_CLICKS'), directions: tot((m) => m === 'BUSINESS_DIRECTION_REQUESTS') } : null,
    keywords: kwRows, competitors: compRows,
    posts: { published: (posts.data ?? []).filter((p) => p.status === 'published').length, total: (posts.data ?? []).length },
  };
  const { data, error } = await db().from('reports').insert({ user_id: uid, location_id: loc.id, title: `${loc.title} — ${req.body.days}-day report`, period_start: s, period_end: e, snapshot }).select().single();
  if (error) throw new ApiError(500, 'INTERNAL', 'Could not save report.');
  await auditLog(uid, 'report.create', 'reports', data.id);
  res.status(201).json({ report: data });
}));
growth.get('/reports', wrap(async (req, res) => {
  const { data } = await db().from('reports').select('id,title,period_start,period_end,created_at,location_id').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(100);
  res.json({ reports: data ?? [] });
}));
growth.get('/reports/:id', wrap(async (req, res) => {
  const { data } = await db().from('reports').select('*').eq('id', req.params.id).eq('user_id', req.user!.id).maybeSingle();
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Report not found.');
  res.json({ report: data });
}));
growth.delete('/reports/:id', wrap(async (req, res) => {
  await db().from('reports').delete().eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));

// ================= AI images (phase 14) =================
growth.post('/ai-images', validate(z.object({ prompt: z.string().trim().min(3).max(600), location_id: z.string().uuid().optional() })), wrap(async (req, res) => {
  const uid = req.user!.id;
  if (!configured.gemini) throw new ApiError(503, 'NOT_CONNECTED', 'Gemini API key is not configured on the server.');
  if (req.body.location_id) await ownLocation(uid, req.body.location_id);
  const settle = await spendCredit(uid, 'ai_image', 1);
  try {
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_IMAGE_MODEL}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY! },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Professional promotional image for a fitness gym. ${req.body.prompt}. No text, no logos.` }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      });
    } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Gemini.'); }
    if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Gemini quota exceeded.');
    if (!r.ok) throw new ApiError(502, 'API_PENDING' as any, `Image model unavailable (${r.status}). Your Gemini plan may not include image generation.`);
    const j: any = await r.json();
    const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part) throw new ApiError(502, 'UPSTREAM', 'The model returned no image. Try a different prompt.');
    const path = `${uid}/${Date.now()}.png`;
    const up = await db().storage.from('dgf-media').upload(path, Buffer.from(part.inlineData.data, 'base64'), { contentType: part.inlineData.mimeType ?? 'image/png' });
    if (up.error) throw new ApiError(500, 'INTERNAL', 'Could not store the image.');
    const { data } = await db().from('ai_media').insert({ user_id: uid, location_id: req.body.location_id ?? null, prompt: req.body.prompt, storage_path: path }).select().single();
    await settle(true);   // credit is only spent when an image was actually stored
    const signed = await db().storage.from('dgf-media').createSignedUrl(path, 3600);
    res.status(201).json({ media: data, url: signed.data?.signedUrl });
  } catch (e) { await settle(false); throw e; }
}));
growth.get('/ai-images', wrap(async (req, res) => {
  const { data } = await db().from('ai_media').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(48);
  const out = await Promise.all((data ?? []).map(async (m) => ({ ...m, url: (await db().storage.from('dgf-media').createSignedUrl(m.storage_path, 3600)).data?.signedUrl ?? null })));
  res.json({ items: out });
}));
growth.patch('/ai-images/:id', validate(z.object({ status: z.enum(['draft', 'approved']) })), wrap(async (req, res) => {
  await db().from('ai_media').update({ status: req.body.status }).eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));
growth.delete('/ai-images/:id', wrap(async (req, res) => {
  const { data } = await db().from('ai_media').select('storage_path').eq('id', req.params.id).eq('user_id', req.user!.id).maybeSingle();
  if (data) { await db().storage.from('dgf-media').remove([data.storage_path]); await db().from('ai_media').delete().eq('id', req.params.id).eq('user_id', req.user!.id); }
  res.json({ ok: true });
}));
