import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { audit, db } from '../lib/supabase.js';
import { authUrl, exchangeCode, clearTokenCache, listAccounts } from '../lib/google.js';
import { config, configured } from '../config.js';
import { encrypt, signState, verifyState } from '../lib/crypto.js';

export const core = Router();

// ---------- public health / integration status ----------
core.get('/health', (_req, res) => res.json({ ok: true, service: 'dgf-local-ranker-api', time: new Date().toISOString() }));

core.get('/diagnostics', auth, wrap(async (req, res) => {
  const checks: Record<string, { status: string; detail?: string }> = {
    supabase: { status: configured.supabase ? 'CONNECTED' : 'NOT_CONNECTED' },
    google_oauth: { status: configured.google ? 'CONNECTED' : 'NOT_CONNECTED' },
    token_encryption: { status: configured.crypto ? 'CONNECTED' : 'NOT_CONNECTED', detail: configured.crypto ? undefined : 'TOKEN_ENC_KEY must be 64 hex chars' },
    gemini: { status: configured.gemini ? 'CONNECTED' : 'NOT_CONNECTED' },
    whatsapp: { status: configured.whatsapp ? 'CONNECTED' : 'NOT_CONNECTED', detail: configured.whatsapp ? undefined : 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID' },
    rank_provider: { status: configured.maps ? 'CONNECTED' : 'NOT_CONNECTED', detail: configured.maps ? undefined : 'Set GOOGLE_MAPS_API_KEY (Places API New)' },
  };
  try { await db().from('plans').select('id').limit(1); checks.database = { status: 'CONNECTED' }; }
  catch (e) { checks.database = { status: 'ERROR', detail: 'Database query failed' }; }
  const { data: g } = await db().from('google_connections').select('status,status_detail').eq('user_id', req.user!.id).maybeSingle();
  checks.gbp_api = { status: g?.status ?? 'NOT_CONNECTED', detail: g?.status_detail ?? undefined };
  res.json({ checkedAt: new Date().toISOString(), checks });
}));

// ---------- me ----------
core.get('/me', auth, wrap(async (req, res) => {
  const { data } = await db().from('profiles').select('*').eq('id', req.user!.id).single();
  res.json({ profile: data });
}));

const profilePatch = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  notif_whatsapp: z.boolean().optional(), notif_review_alerts: z.boolean().optional(),
  notif_email: z.boolean().optional(), auto_reply: z.boolean().optional(),
  reply_tone: z.enum(['friendly', 'professional', 'energetic', 'empathetic']).optional(),
}).strict();
core.patch('/me', auth, validate(profilePatch), wrap(async (req, res) => {
  const { data, error } = await db().from('profiles').update(req.body).eq('id', req.user!.id).select().single();
  if (error) throw new ApiError(400, 'VALIDATION', 'Could not update profile.');
  res.json({ profile: data });
}));

// ---------- data export & account deletion (Settings → Danger zone) ----------
const EXPORT_TABLES = ['business_locations', 'gbp_audits', 'reviews', 'content_posts', 'keywords', 'keyword_rank_history', 'geo_scans', 'competitors', 'performance_metrics', 'reports', 'leads', 'automation_rules', 'whatsapp_messages', 'customers', 'invoices', 'ai_media', 'ai_videos', 'social_posts', 'notifications'];
core.get('/me/export', auth, wrap(async (req, res) => {
  const uid = req.user!.id;
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  const { data: prof } = await db().from('profiles').select('*').eq('id', uid).single();
  out.profile = prof;
  for (const t of EXPORT_TABLES) {
    const { data, error } = await db().from(t).select('*').eq('user_id', uid).limit(10000);
    if (!error) out[t] = data ?? [];
  }
  await audit(uid, 'data_export');
  res.json(out);
}));

core.post('/me/delete', auth, validate(z.object({ confirm: z.string().min(3).max(200) })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: prof } = await db().from('profiles').select('email,role').eq('id', uid).single();
  if (!prof || String(req.body.confirm).trim().toLowerCase() !== String(prof.email ?? '').toLowerCase()) throw new ApiError(400, 'VALIDATION', 'Email confirmation does not match.');
  if (prof.role === 'super_admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator accounts cannot be self-deleted.');
  await db().from('google_connections').delete().eq('user_id', uid);
  clearTokenCache(uid);
  const { error } = await db().auth.admin.deleteUser(uid);   // all user data cascades from auth.users
  if (error) throw new ApiError(500, 'INTERNAL', 'Could not delete the account. Please contact support.');
  res.json({ ok: true });
}));

// ---------- notifications ----------
core.get('/notifications', auth, wrap(async (req, res) => {
  const { data } = await db().from('notifications').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(50);
  res.json({ notifications: data ?? [], unread: (data ?? []).filter((n) => !n.read).length });
}));
core.post('/notifications/read-all', auth, wrap(async (req, res) => {
  await db().from('notifications').update({ read: true }).eq('user_id', req.user!.id).eq('read', false);
  res.json({ ok: true });
}));
core.post('/notifications/:id/read', auth, wrap(async (req, res) => {
  await db().from('notifications').update({ read: true }).eq('user_id', req.user!.id).eq('id', req.params.id);
  res.json({ ok: true });
}));

export async function notify(userId: string, kind: string, title: string, body?: string, dedupeKey?: string) {
  await db().from('notifications').upsert({ user_id: userId, kind, title, body, dedupe_key: dedupeKey ?? null }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
}

// ---------- Google OAuth ----------
core.get('/auth/google/url', auth, wrap(async (req, res) => {
  const state = signState(req.user!.id);
  await db().from('google_connections').upsert({ user_id: req.user!.id, status: 'CONNECTING' }, { onConflict: 'user_id', ignoreDuplicates: false });
  res.json({ url: authUrl(state) });
}));

core.get('/auth/google/callback', wrap(async (req, res) => {
  const back = (q: string) => res.redirect(`${config.FRONTEND_URL}/google-business?${q}`);
  const { code, state, error } = req.query as Record<string, string>;
  if (error) return back(`google=denied`);
  const userId = state ? verifyState(state) : null;
  if (!userId || !code) return back('google=invalid_state');
  try {
    const t = await exchangeCode(code);
    let email: string | undefined, name: string | undefined, picture: string | undefined;
    const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } });
    if (ui.ok) { const j: any = await ui.json(); email = j.email; name = j.name; picture = j.picture; }
    const existing = await db().from('google_connections').select('refresh_token_enc').eq('user_id', userId).maybeSingle();
    const refresh = t.refresh_token ? encrypt(t.refresh_token) : existing.data?.refresh_token_enc;
    if (!refresh) return back('google=no_refresh_token');
    // OAuth success != Business Profile API access. Probe it and record the true status.
    await db().from('google_connections').upsert({
      user_id: userId, google_email: email, google_name: name, google_picture: picture, refresh_token_enc: refresh,
      scopes: t.scope, status: 'CONNECTED', status_detail: null, connected_at: new Date().toISOString(), last_checked_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    clearTokenCache(userId);
    try { await listAccounts(userId); }
    catch (e) {
      if (e instanceof ApiError && (e.code === 'API_PENDING' || e.code === 'RATE_LIMITED')) {
        await db().from('google_connections').update({ status: 'API_PENDING', status_detail: e.message }).eq('user_id', userId);
      }
    }
    await audit(userId, 'google.connect', 'google_connections', userId);
    return back('google=connected');
  } catch (e) {
    console.error('[oauth callback]', e instanceof Error ? e.message : e);
    return back('google=error');
  }
}));

core.get('/google/status', auth, wrap(async (req, res) => {
  const { data } = await db().from('google_connections')
    .select('status,status_detail,google_email,google_name,google_picture,connected_at,last_checked_at').eq('user_id', req.user!.id).maybeSingle();
  res.json({ connection: data ?? { status: 'NOT_CONNECTED' }, oauthConfigured: configured.google });
}));

core.post('/google/disconnect', auth, wrap(async (req, res) => {
  await db().from('google_connections').update({ refresh_token_enc: null, status: 'NOT_CONNECTED', status_detail: null, connected_at: null }).eq('user_id', req.user!.id);
  clearTokenCache(req.user!.id);
  await audit(req.user!.id, 'google.disconnect');
  res.json({ ok: true });
}));

// ---------- plan / credits ----------
core.get('/plan', auth, wrap(async (req, res) => {
  const uid = req.user!.id;
  let { data: subs } = await db().from('subscriptions').select('*, plans(*)').eq('user_id', uid).order('created_at', { ascending: false });
  if (!subs?.length) {
    await db().from('subscriptions').insert({ user_id: uid, plan_id: 'trial' });
    ({ data: subs } = await db().from('subscriptions').select('*, plans(*)').eq('user_id', uid).order('created_at', { ascending: false }));
  }
  const { data: p } = await db().from('profiles').select('ai_credits').eq('id', uid).single();
  const { data: usage } = await db().from('ai_usage').select('credits').eq('user_id', uid);
  const { data: plans } = await db().from('plans').select('*').order('price_inr');
  res.json({
    current: subs![0], history: subs, plans,
    credits: { left: p?.ai_credits ?? 0, used: (usage ?? []).reduce((a, u) => a + u.credits, 0) },
    billing: 'Payment gateway not connected yet (API_PENDING). Plan changes are managed by an admin.',
  });
}));
