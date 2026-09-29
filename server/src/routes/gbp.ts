import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { audit as auditLog, db } from '../lib/supabase.js';
import * as G from '../lib/google.js';
import { runAudit, RULES_VERSION } from '../lib/audit.js';
import { gemini, geminiJson } from '../lib/gemini.js';
import { notify } from './core.js';

export const gbp = Router();
gbp.use(auth);

const uuid = z.string().uuid();

export async function ownLocation(userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw new ApiError(404, 'NOT_FOUND', 'Location not found.');
  const { data } = await db().from('business_locations').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Location not found.');
  return data;
}

function mapLocation(userId: string, account: string, l: any) {
  const a = l.storefrontAddress ?? {};
  return {
    user_id: userId, google_account_id: account, google_location_id: l.name,
    title: l.title ?? 'Untitled', store_code: l.storeCode ?? null,
    address: [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(', ') || null,
    city: a.locality ?? null, phone: l.phoneNumbers?.primaryPhone ?? null, website: l.websiteUri ?? null,
    primary_category: l.categories?.primaryCategory?.displayName ?? null,
    verified: l.metadata?.hasVoiceOfMerchant === true,
    profile: l, last_synced_at: new Date().toISOString(), sync_error: null,
  };
}

// ---------- locations ----------
gbp.post('/locations/sync', wrap(async (req, res) => {
  const uid = req.user!.id;
  const { accounts = [] } = await G.listAccounts(uid);
  let count = 0;
  for (const acc of accounts) {
    const { locations = [] } = await G.listLocations(uid, acc.name);
    if (!locations.length) continue;
    // upsert on the natural key => duplicate syncs never create duplicate rows; `enabled` is preserved
    const rows = locations.map((l) => mapLocation(uid, acc.name, l));
    const { error } = await db().from('business_locations').upsert(rows, { onConflict: 'user_id,google_account_id,google_location_id', ignoreDuplicates: false });
    if (error) throw new ApiError(500, 'INTERNAL', 'Could not save locations.');
    count += rows.length;
  }
  await db().from('google_connections').update({ status: 'CONNECTED', status_detail: null, last_checked_at: new Date().toISOString() }).eq('user_id', uid);
  res.json({ synced: count, accounts: accounts.length });
}));

gbp.get('/locations', wrap(async (req, res) => {
  const { data } = await db().from('business_locations')
    .select('id,google_account_id,google_location_id,title,store_code,address,city,phone,website,primary_category,verified,enabled,last_synced_at,sync_error')
    .eq('user_id', req.user!.id).order('title');
  res.json({ locations: data ?? [] });
}));

gbp.patch('/locations/:id', validate(z.object({ enabled: z.boolean() })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.params.id);
  if (req.body.enabled && !loc.enabled) {
    const { data: sub } = await db().from('subscriptions').select('plans(location_limit)').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const limit = (sub as any)?.plans?.location_limit ?? 1;
    const { count } = await db().from('business_locations').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('enabled', true);
    if ((count ?? 0) >= limit) throw new ApiError(403, 'LIMIT_REACHED', `Your plan allows ${limit} active location(s). Disable one or upgrade.`);
  }
  await db().from('business_locations').update({ enabled: req.body.enabled }).eq('id', loc.id);   // disabling never deletes history
  await auditLog(uid, req.body.enabled ? 'location.enable' : 'location.disable', 'business_locations', loc.id);
  res.json({ ok: true });
}));

// Read-only live profile refresh
gbp.post('/locations/:id/refresh', wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.params.id);
  try {
    const l = await G.getLocation(uid, loc.google_location_id);
    const row = mapLocation(uid, loc.google_account_id, l);
    const { enabled: _e, ...rest } = row as any;
    await db().from('business_locations').update(rest).eq('id', loc.id);
    res.json({ profile: l, last_synced_at: row.last_synced_at });
  } catch (e) {
    if (e instanceof ApiError) await db().from('business_locations').update({ sync_error: e.message }).eq('id', loc.id);
    throw e;
  }
}));

gbp.get('/locations/:id', wrap(async (req, res) => {
  const loc = await ownLocation(req.user!.id, req.params.id);
  res.json({ location: loc });
}));

// ---------- audit ----------
async function buildAuditInput(uid: string, loc: any) {
  const p = loc.profile ?? {};
  const { data: rv } = await db().from('reviews').select('rating,reply_status').eq('location_id', loc.id);
  const hasReviews = !!loc.reviews_synced_at || (rv?.length ?? 0) > 0;
  const rows = rv ?? [];
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { count: posts } = await db().from('content_posts').select('id', { count: 'exact', head: true }).eq('location_id', loc.id).eq('status', 'published').gte('created_at', since);
  return {
    title: loc.title, phone: loc.phone, website: loc.website, address: loc.address, primaryCategory: loc.primary_category,
    additionalCategories: p.categories?.additionalCategories?.length ?? 0,
    description: p.profile?.description ?? '',
    hasHours: (p.regularHours?.periods?.length ?? 0) > 0,
    serviceCount: p.serviceItems?.length ?? 0,
    photoCount: null,                                        // media API not queried here => unknown, never fabricated
    reviewCount: hasReviews ? rows.length : null,
    unansweredReviews: hasReviews ? rows.filter((r) => r.reply_status !== 'published').length : null,
    avgRating: rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : null,
    postsLast30d: posts ?? 0,
  };
}

gbp.post('/locations/:id/audit', wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.params.id);
  const result = runAudit(await buildAuditInput(uid, loc));
  const { data, error } = await db().from('gbp_audits').insert({
    user_id: uid, location_id: loc.id, score: result.score, breakdown: result.breakdown,
    recommendations: result.recommendations, rules_version: RULES_VERSION,
  }).select().single();
  if (error) throw new ApiError(500, 'INTERNAL', 'Could not save audit.');
  res.json({ audit: data, rules: result.rules, unknown: result.unknown, note: 'DGF profile completeness score — not a Google-provided score.' });
}));

gbp.get('/locations/:id/audits', wrap(async (req, res) => {
  const loc = await ownLocation(req.user!.id, req.params.id);
  const { data } = await db().from('gbp_audits').select('*').eq('location_id', loc.id).eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(50);
  res.json({ audits: data ?? [] });
}));

// ---------- AI optimization (recommend -> owner approves -> backend applies) ----------
async function spendCredit(uid: string, feature: string, cost = 1) {
  const { data: p } = await db().from('profiles').select('ai_credits').eq('id', uid).single();
  if ((p?.ai_credits ?? 0) < cost) throw new ApiError(402 as any, 'LIMIT_REACHED', 'You are out of AI credits.');
  return async (ok: boolean) => {
    if (ok) await db().from('profiles').update({ ai_credits: (p!.ai_credits) - cost }).eq('id', uid);
    await db().from('ai_usage').insert({ user_id: uid, feature, ok, credits: ok ? cost : 0 });
  };
}
export { spendCredit };

gbp.post('/locations/:id/ai/optimize', wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.params.id);
  const settle = await spendCredit(uid, 'optimize');
  try {
    const p = loc.profile ?? {};
    const facts = {   // structured business data only — no tokens or secrets
      name: loc.title, city: loc.city, primaryCategory: loc.primary_category,
      additionalCategories: (p.categories?.additionalCategories ?? []).map((c: any) => c.displayName),
      currentDescription: p.profile?.description ?? '', services: (p.serviceItems ?? []).map((s: any) => s.freeFormServiceItem?.label?.displayName ?? s.structuredServiceItem?.serviceTypeId).filter(Boolean),
      website: loc.website,
    };
    const out = await geminiJson<{ description: string; categories: string[]; services: string[] }>(
      `You are a local SEO expert for a fitness business. Using ONLY these facts, propose improvements for the Google Business Profile.\n` +
      `Facts: ${JSON.stringify(facts)}\n` +
      `Return JSON: {"description": string (max 740 chars, natural, no keyword stuffing, no claims not in facts), "categories": string[] (max 3 real Google category names), "services": string[] (max 10 short service names)}`);
    const rows = [
      { kind: 'description', payload: { text: String(out.description ?? '').slice(0, 750) } },
      { kind: 'categories', payload: { items: (out.categories ?? []).slice(0, 3) } },
      { kind: 'services', payload: { items: (out.services ?? []).slice(0, 10) } },
    ].map((r) => ({ ...r, user_id: uid, location_id: loc.id, status: 'draft' }));
    const { data } = await db().from('ai_suggestions').insert(rows).select();
    await settle(true);
    res.json({ suggestions: data });
  } catch (e) { await settle(false); throw e; }
}));

gbp.get('/locations/:id/ai/suggestions', wrap(async (req, res) => {
  const loc = await ownLocation(req.user!.id, req.params.id);
  const { data } = await db().from('ai_suggestions').select('*').eq('location_id', loc.id).eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(30);
  res.json({ suggestions: data ?? [] });
}));

gbp.patch('/ai/suggestions/:id', validate(z.object({ status: z.enum(['approved', 'rejected']).optional(), payload: z.record(z.any()).optional() })), wrap(async (req, res) => {
  const { data: s } = await db().from('ai_suggestions').select('*').eq('id', req.params.id).eq('user_id', req.user!.id).maybeSingle();
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Suggestion not found.');
  if (s.status === 'applied') throw new ApiError(409, 'VALIDATION', 'Already applied.');
  const upd: any = {};
  if (req.body.payload) upd.payload = req.body.payload;    // owner edit
  if (req.body.status) { upd.status = req.body.status; upd.decided_at = new Date().toISOString(); }
  const { data } = await db().from('ai_suggestions').update(upd).eq('id', s.id).select().single();
  res.json({ suggestion: data });
}));

// Only APPROVED suggestions can be written to Google — description only in this release.
gbp.post('/ai/suggestions/:id/apply', wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: s } = await db().from('ai_suggestions').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Suggestion not found.');
  if (s.status !== 'approved') throw new ApiError(409, 'FORBIDDEN', 'Approve this suggestion before applying it.');
  if (s.kind !== 'description') throw new ApiError(400, 'VALIDATION', 'Only description updates can be applied automatically in this release.');
  const loc = await ownLocation(uid, s.location_id);
  await G.patchLocation(uid, loc.google_location_id, 'profile', { profile: { description: String(s.payload.text).slice(0, 750) } });
  await db().from('ai_suggestions').update({ status: 'applied', decided_at: new Date().toISOString() }).eq('id', s.id);
  await auditLog(uid, 'gbp.apply_description', 'business_locations', loc.id);
  await notify(uid, 'optimization', 'Description updated', `Your description for ${loc.title} was updated on Google.`);
  res.json({ ok: true });
}));

// ---------- Photos (read-only, from Google media endpoint) ----------
gbp.get('/locations/:id/media', wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.params.id);
  const r = await G.gget<{ mediaItems?: any[]; totalMediaItemCount?: number }>(uid, `https://mybusiness.googleapis.com/v4/${loc.google_account_id}/${loc.google_location_id}/media?pageSize=100`, 'List media');
  res.json({ items: r.mediaItems ?? [], total: r.totalMediaItemCount ?? (r.mediaItems?.length ?? 0) });
}));

export { gemini };
