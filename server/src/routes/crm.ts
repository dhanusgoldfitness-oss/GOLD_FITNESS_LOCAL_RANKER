import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { auth, requireRole, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { audit as auditLog, db } from '../lib/supabase.js';
import { config, configured } from '../config.js';
import { normalizePhone, sendText } from '../lib/whatsapp.js';
import { fireEvent } from '../lib/automation.js';
import { notify } from './core.js';

// ---------- PUBLIC: WhatsApp webhook (mounted before auth) ----------
export const hooks = Router();
hooks.get('/webhooks/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && req.query['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(req.query['hub.challenge']));
  res.sendStatus(403);
});
hooks.post('/webhooks/whatsapp', wrap(async (req, res) => {
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!config.WHATSAPP_APP_SECRET || !raw) return void res.sendStatus(403);          // never accept unsigned events
  const sig = String(req.headers['x-hub-signature-256'] ?? '');
  const expected = 'sha256=' + createHmac('sha256', config.WHATSAPP_APP_SECRET).update(raw).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return void res.sendStatus(403);
  res.sendStatus(200);                                                                // ack fast; process after
  for (const entry of req.body?.entry ?? []) for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {};
    for (const st of v.statuses ?? []) {
      await db().from('whatsapp_messages').update({ status: st.status, error: st.errors?.[0]?.title ?? null }).eq('provider_id', st.id);
    }
    for (const m of v.messages ?? []) {
      const num = normalizePhone(String(m.from ?? ''));
      if (!num) continue;
      const { data: lead } = await db().from('leads').select('user_id').eq('phone', num).limit(1).maybeSingle();
      const { data: owner } = lead ? { data: null } : await db().from('profiles').select('id').eq('role', 'super_admin').limit(1).maybeSingle();
      const uid = lead?.user_id ?? owner?.id;
      if (!uid) continue;
      const { data: dup } = await db().from('whatsapp_messages').select('id').eq('provider_id', m.id).maybeSingle();
      if (dup) continue;                                                              // idempotent on redelivery
      await db().from('whatsapp_messages').insert({ user_id: uid, direction: 'in', from_number: num, body: String(m.text?.body ?? `[${m.type}]`).slice(0, 4000), provider_id: m.id, status: 'received' });
      if (!lead) {
        const ins = await db().from('leads').insert({ user_id: uid, name: v.contacts?.[0]?.profile?.name ?? num, phone: num, source: 'whatsapp' }).select().single();
        if (ins.data) { await db().from('lead_activities').insert({ user_id: uid, lead_id: ins.data.id, kind: 'created', detail: 'via WhatsApp' }); await fireEvent(uid, 'new_lead', `lead-${ins.data.id}`, { name: ins.data.name, phone: num, eventKey: ins.data.id }); }
      }
      await notify(uid, 'whatsapp', 'New WhatsApp message', `${num}: ${String(m.text?.body ?? '').slice(0, 80)}`, `wa-${m.id}`);
    }
  }
}));

// ---------- AUTHENTICATED ----------
export const crm = Router();
crm.use(auth);

// ===== leads (phase 20) =====
const STATUSES = ['new', 'contacted', 'interested', 'trial_booked', 'visited', 'joined', 'lost'] as const;
const leadIn = z.object({
  name: z.string().trim().min(1).max(120), phone: z.string().trim().max(20).optional().nullable(),
  source: z.enum(['manual', 'website', 'whatsapp', 'walk_in', 'google', 'referral']).default('manual'),
  interest: z.string().trim().max(200).optional().nullable(), assigned_to: z.string().trim().max(120).optional().nullable(),
  next_follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
}).strict();

crm.get('/leads', wrap(async (req, res) => {
  const { data } = await db().from('leads').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(1000);
  const rows = data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const total = rows.length, joined = rows.filter((l) => l.status === 'joined').length;
  const bySource: Record<string, { total: number; joined: number }> = {};
  for (const l of rows) { const s = (bySource[l.source] ??= { total: 0, joined: 0 }); s.total++; if (l.status === 'joined') s.joined++; }
  res.json({ leads: rows, stats: { total, joined, conversionPct: total ? Math.round((joined / total) * 100) : null, dueFollowUps: rows.filter((l) => l.next_follow_up && l.next_follow_up <= today && !['joined', 'lost'].includes(l.status)).length, bySource } });
}));
crm.post('/leads', validate(leadIn), wrap(async (req, res) => {
  const uid = req.user!.id;
  const phone = req.body.phone ? normalizePhone(req.body.phone) : null;
  if (req.body.phone && !phone) throw new ApiError(400, 'VALIDATION', 'Enter a valid phone number.');
  const { data, error } = await db().from('leads').insert({ ...req.body, phone, user_id: uid }).select().single();
  if (error) throw new ApiError(400, 'VALIDATION', 'Could not save lead.');
  await db().from('lead_activities').insert({ user_id: uid, lead_id: data.id, kind: 'created', detail: `source: ${data.source}` });
  await fireEvent(uid, 'new_lead', `lead-${data.id}`, { name: data.name, phone: data.phone, eventKey: data.id });
  res.status(201).json({ lead: data });
}));
crm.patch('/leads/:id', validate(leadIn.partial().extend({ status: z.enum(STATUSES).optional(), member_ref: z.string().max(80).optional().nullable() })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: cur } = await db().from('leads').select('status').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!cur) throw new ApiError(404, 'NOT_FOUND', 'Lead not found.');
  const upd: any = { ...req.body };
  if (upd.phone) { upd.phone = normalizePhone(upd.phone); if (!upd.phone) throw new ApiError(400, 'VALIDATION', 'Enter a valid phone number.'); }
  const { data } = await db().from('leads').update(upd).eq('id', req.params.id).eq('user_id', uid).select().single();
  if (req.body.status && req.body.status !== cur.status) await db().from('lead_activities').insert({ user_id: uid, lead_id: req.params.id, kind: 'status', detail: `${cur.status} → ${req.body.status}` });   // status changes are logged
  res.json({ lead: data });
}));
crm.delete('/leads/:id', wrap(async (req, res) => {
  await db().from('leads').delete().eq('id', req.params.id).eq('user_id', req.user!.id);
  await auditLog(req.user!.id, 'lead.delete', 'leads', req.params.id);
  res.json({ ok: true });
}));
crm.get('/leads/:id', wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: lead } = await db().from('leads').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found.');
  const [n, a] = await Promise.all([
    db().from('lead_notes').select('*').eq('lead_id', lead.id).eq('user_id', uid).order('created_at', { ascending: false }),
    db().from('lead_activities').select('*').eq('lead_id', lead.id).eq('user_id', uid).order('created_at', { ascending: false }),
  ]);
  res.json({ lead, notes: n.data ?? [], activities: a.data ?? [] });
}));
crm.post('/leads/:id/notes', validate(z.object({ body: z.string().trim().min(1).max(2000) })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: lead } = await db().from('leads').select('id').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found.');
  const { data } = await db().from('lead_notes').insert({ user_id: uid, lead_id: lead.id, body: req.body.body }).select().single();
  res.status(201).json({ note: data });
}));
crm.post('/leads/:id/whatsapp', validate(z.object({ message: z.string().trim().min(1).max(1000) })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: lead } = await db().from('leads').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!lead?.phone) throw new ApiError(400, 'VALIDATION', 'This lead has no phone number.');
  await sendText(uid, lead.phone, req.body.message);
  await db().from('lead_activities').insert({ user_id: uid, lead_id: lead.id, kind: 'whatsapp', detail: req.body.message.slice(0, 200) });
  res.json({ ok: true });
}));

// ===== WhatsApp (phase 19) =====
crm.get('/whatsapp/status', wrap(async (_req, res) => {
  res.json({ status: configured.whatsapp ? 'CONNECTED' : 'NOT_CONNECTED', webhookSecret: !!config.WHATSAPP_APP_SECRET, note: configured.whatsapp ? 'Free-form messages only deliver inside the 24-hour customer window; use approved templates otherwise.' : 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID on the server.' });
}));
crm.get('/whatsapp/messages', wrap(async (req, res) => {
  const { data } = await db().from('whatsapp_messages').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(200);
  res.json({ messages: data ?? [] });
}));
crm.post('/whatsapp/send', validate(z.object({ to: z.string().min(8).max(20), message: z.string().trim().min(1).max(1000) })), wrap(async (req, res) => {
  res.json(await sendText(req.user!.id, req.body.to, req.body.message));
}));

// ===== automation rules (phase 18) =====
const ruleIn = z.object({
  name: z.string().trim().min(1).max(100),
  trigger: z.enum(['negative_review', 'new_lead', 'rank_drop', 'failed_post']),
  condition: z.object({ maxRating: z.number().int().min(1).max(5).optional(), minDrop: z.number().int().min(1).max(100).optional() }).default({}),
  action: z.enum(['notify', 'whatsapp_owner', 'draft_review_reply', 'whatsapp_lead']),
  action_config: z.object({ title: z.string().max(120).optional(), body: z.string().max(500).optional(), message: z.string().max(800).optional() }).default({}),
  enabled: z.boolean().default(true),
}).strict().refine((r) => !(r.action === 'draft_review_reply' && r.trigger !== 'negative_review'), { message: 'AI reply drafts only work with the negative-review trigger.' })
  .refine((r) => !(r.action === 'whatsapp_lead' && r.trigger !== 'new_lead'), { message: 'Lead WhatsApp only works with the new-lead trigger.' });

crm.get('/automations', wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: rules } = await db().from('automation_rules').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  const { data: runs } = await db().from('automation_runs').select('*, automation_rules(name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(50);
  res.json({ rules: rules ?? [], runs: runs ?? [] });
}));
crm.post('/automations', validate(ruleIn), wrap(async (req, res) => {
  const { data, error } = await db().from('automation_rules').insert({ ...req.body, user_id: req.user!.id }).select().single();
  if (error) throw new ApiError(400, 'VALIDATION', 'Could not save rule.');
  res.status(201).json({ rule: data });
}));
crm.patch('/automations/:id', validate(z.object({ enabled: z.boolean() })), wrap(async (req, res) => {
  await db().from('automation_rules').update({ enabled: req.body.enabled }).eq('id', req.params.id).eq('user_id', req.user!.id);   // takes effect on the very next event
  res.json({ ok: true });
}));
crm.delete('/automations/:id', wrap(async (req, res) => {
  await db().from('automation_rules').delete().eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));

// ===== super admin (phase 22) =====
export const admin = Router();
admin.use(auth, requireRole('super_admin'));
admin.get('/admin/overview', wrap(async (_req, res) => {
  const c = async (t: string) => (await db().from(t).select('id', { count: 'exact', head: true })).count ?? 0;
  const [users, locations, reviews, leads, aiCalls] = await Promise.all([c('profiles'), c('business_locations'), c('reviews'), c('leads'), c('ai_usage')]);
  const failsQ = await db().from('ai_usage').select('id', { count: 'exact', head: true }).eq('ok', false);
  const { data: jobs } = await db().from('job_runs').select('*').order('started_at', { ascending: false }).limit(30);
  res.json({ counts: { users, locations, reviews, leads, aiCalls }, failedAiCalls: failsQ.count ?? 0, jobs: jobs ?? [] });
}));
admin.get('/admin/users', wrap(async (_req, res) => {
  const { data: profs } = await db().from('profiles').select('id,full_name,email,role,ai_credits,created_at').order('created_at', { ascending: false }).limit(500);
  const { data: subs } = await db().from('subscriptions').select('user_id,plan_id,status,period_end').order('created_at', { ascending: false });
  const { data: locs } = await db().from('business_locations').select('user_id').eq('enabled', true);
  const plan = new Map<string, any>(); for (const s of subs ?? []) if (!plan.has(s.user_id)) plan.set(s.user_id, s);
  const lc = new Map<string, number>(); for (const l of locs ?? []) lc.set(l.user_id, (lc.get(l.user_id) ?? 0) + 1);
  res.json({ users: (profs ?? []).map((p) => ({ ...p, plan: plan.get(p.id)?.plan_id ?? null, locations: lc.get(p.id) ?? 0 })) });
}));
admin.patch('/admin/users/:id', validate(z.object({ role: z.enum(['super_admin', 'owner', 'manager', 'staff', 'client']).optional(), ai_credits: z.number().int().min(0).max(100000).optional(), plan_id: z.string().max(30).optional() }).strict()), wrap(async (req, res) => {
  const me = req.user!.id;
  if (req.params.id === me && req.body.role && req.body.role !== 'super_admin') throw new ApiError(400, 'VALIDATION', 'You cannot remove your own admin role.');
  const { plan_id, ...prof } = req.body;
  if (Object.keys(prof).length) await db().from('profiles').update(prof).eq('id', req.params.id);
  if (plan_id) {
    const { data: p } = await db().from('plans').select('id').eq('id', plan_id).maybeSingle();
    if (!p) throw new ApiError(400, 'VALIDATION', 'Unknown plan.');
    await db().from('subscriptions').insert({ user_id: req.params.id, plan_id });
  }
  await auditLog(me, 'admin.update_user', 'profiles', req.params.id, req.body);   // every admin mutation is logged
  res.json({ ok: true });
}));
admin.get('/admin/audit-logs', wrap(async (_req, res) => {
  const { data } = await db().from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
  res.json({ logs: data ?? [] });
}));
