import { configured } from '../config.js';
import { db } from './supabase.js';
import { publishPost } from '../routes/business.js';
import { syncReviews } from '../routes/reviews.js';
import { checkKeyword, snapshotCompetitors, syncPerformance } from '../routes/growth.js';

const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
};

/** Claim (job, window) — the unique constraint means duplicate scheduler invocations cannot double-run. */
async function claim(job: string, window: string): Promise<string | null> {
  const { data, error } = await db().from('job_runs').insert({ job, window_key: window }).select('id').single();
  return error ? null : data.id;
}
async function finish(id: string, status: 'ok' | 'failed', detail: string) {
  await db().from('job_runs').update({ status, detail: detail.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', id);
}

async function forEachLocation(fn: (uid: string, loc: any) => Promise<void>) {
  const { data } = await db().from('business_locations').select('*').eq('enabled', true);
  let ok = 0, failed = 0; let lastErr = '';
  for (const loc of data ?? []) {
    try { await fn(loc.user_id, loc); ok++; } catch (e) { failed++; lastErr = e instanceof Error ? e.message : 'error'; }   // one failing location never stops the rest
  }
  return { ok, failed, lastErr };
}

async function publishDuePosts() {
  const { data: due } = await db().from('content_posts').select('id').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString()).limit(20);
  for (const d of due ?? []) {
    // atomic claim: only one worker can flip scheduled -> publishing
    const { data: p } = await db().from('content_posts').update({ status: 'publishing' }).eq('id', d.id).eq('status', 'scheduled').select().maybeSingle();
    if (!p) continue;
    try { await publishPost(p.user_id, p); } catch { /* publishPost already recorded failure + notification */ }
  }
}

async function daily(window: string) {
  const id = await claim('daily_sync', window); if (!id) return;
  const rv = await forEachLocation((uid, loc) => syncReviews(uid, loc).then(() => undefined));
  const pf = await forEachLocation((uid, loc) => syncPerformance(uid, loc, 30).then(() => undefined));
  await finish(id, rv.failed + pf.failed ? 'failed' : 'ok', `reviews ok=${rv.ok} fail=${rv.failed}; perf ok=${pf.ok} fail=${pf.failed}; ${rv.lastErr || pf.lastErr}`);
}

async function weekly(window: string) {
  if (!configured.maps) return;                       // provider not connected: do nothing, do not fabricate
  const id = await claim('weekly_rank', window); if (!id) return;
  const r = await forEachLocation(async (uid, loc) => {
    const { data: kws } = await db().from('keywords').select('*').eq('location_id', loc.id).eq('active', true);
    for (const k of kws ?? []) await checkKeyword(uid, k, loc).catch(() => undefined);
    await snapshotCompetitors(uid, loc.id);
  });
  await finish(id, r.failed ? 'failed' : 'ok', `ok=${r.ok} fail=${r.failed}; ${r.lastErr}`);
}

let busy = false;
export function startScheduler() {
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      await publishDuePosts();
      const now = new Date();
      if (now.getUTCHours() >= 2) await daily(now.toISOString().slice(0, 10));   // ~07:30 IST onwards, once per day
      await weekly(isoWeek(now));
    } catch (e) { console.error('[scheduler]', e instanceof Error ? e.message : e); } finally { busy = false; }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 15_000).unref();
  console.log('Scheduler started (1-min tick).');
}
