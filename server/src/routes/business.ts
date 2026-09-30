import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { audit, db } from '../lib/supabase.js';
import { gemini } from '../lib/gemini.js';
import * as G from '../lib/google.js';
import { ownLocation, spendCredit } from './gbp.js';
import { notify } from './core.js';
import { fireEvent } from '../lib/automation.js';
import { configured } from '../config.js';

export const business = Router();
business.use(auth);

/** Small CRUD factory. Every query is scoped to the authenticated user; `user_id` can never be supplied by the client. */
function crud(path: string, table: string, schema: z.ZodObject<any>, orderCol = 'created_at') {
  const partial = schema.partial().strict();
  business.get(`/${path}`, wrap(async (req, res) => {
    const { data } = await db().from(table).select('*').eq('user_id', req.user!.id).order(orderCol, { ascending: false });
    res.json({ items: data ?? [] });
  }));
  business.post(`/${path}`, validate(schema.strict()), wrap(async (req, res) => {
    const { data, error } = await db().from(table).insert({ ...req.body, user_id: req.user!.id }).select().single();
    if (error) throw new ApiError(error.code === '23505' ? 409 : 400, 'VALIDATION', error.code === '23505' ? 'That already exists.' : 'Could not save.');
    await audit(req.user!.id, `${table}.create`, table, data.id);
    res.status(201).json({ item: data });
  }));
  business.patch(`/${path}/:id`, validate(partial), wrap(async (req, res) => {
    const { data, error } = await db().from(table).update(req.body).eq('id', req.params.id).eq('user_id', req.user!.id).select().maybeSingle();
    if (error) throw new ApiError(400, 'VALIDATION', 'Could not update.');
    if (!data) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    res.json({ item: data });
  }));
  business.delete(`/${path}/:id`, wrap(async (req, res) => {
    await db().from(table).delete().eq('id', req.params.id).eq('user_id', req.user!.id);
    await audit(req.user!.id, `${table}.delete`, table, req.params.id);
    res.json({ ok: true });
  }));
}

const optStr = z.string().trim().max(200).optional().nullable();
crud('customers', 'customers', z.object({ name: z.string().trim().min(1).max(120), phone: optStr, email: z.string().email().max(200).optional().nullable().or(z.literal('')), status: z.enum(['active', 'inactive']).optional() }));
crud('categories', 'service_categories', z.object({ name: z.string().trim().min(1).max(80) }));
crud('services', 'services', z.object({ name: z.string().trim().min(1).max(120), category: optStr, price: z.coerce.number().min(0).max(1e7), unit: optStr, status: z.enum(['active', 'inactive']).optional() }));
crud('expenses', 'expenses', z.object({ expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().trim().min(1).max(160), category: optStr, method: optStr, amount: z.coerce.number().positive().max(1e9) }), 'expense_date');

// ---- invoices ----
const item = z.object({ name: z.string().trim().min(1).max(160), qty: z.coerce.number().positive().max(1e5), price: z.coerce.number().min(0).max(1e7) });
const invoiceIn = z.object({
  customer_id: z.string().uuid().nullable().optional(), invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), items: z.array(item).min(1).max(100),
  status: z.enum(['draft', 'sent', 'partially_paid', 'paid', 'cancelled']).default('draft'), paid: z.coerce.number().min(0).default(0),
}).strict();
const totalOf = (items: z.infer<typeof item>[]) => Math.round(items.reduce((a, i) => a + i.qty * i.price, 0) * 100) / 100;

business.get('/invoices', wrap(async (req, res) => {
  const { data } = await db().from('invoices').select('*, customers(name)').eq('user_id', req.user!.id).order('created_at', { ascending: false });
  const rows = data ?? [];
  const live = rows.filter((r) => r.status !== 'cancelled' && r.status !== 'draft');
  res.json({
    items: rows,
    summary: { outstanding: live.reduce((a, r) => a + (Number(r.total) - Number(r.paid)), 0), paidThisMonth: live.filter((r) => r.invoice_date.slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((a, r) => a + Number(r.paid), 0), drafts: rows.filter((r) => r.status === 'draft').length },
  });
}));
business.post('/invoices', validate(invoiceIn), wrap(async (req, res) => {
  const uid = req.user!.id;
  // atomic-enough number allocation: bump counter, retry on unique clash
  const { data: bs } = await db().from('billing_settings').select('*').eq('user_id', uid).maybeSingle();
  const prefix = bs?.invoice_prefix ?? 'INV';
  let n = bs?.next_number ?? 1;
  for (let attempt = 0; attempt < 5; attempt++, n++) {
    const number = `${prefix}-${String(n).padStart(4, '0')}`;
    const b = req.body as z.infer<typeof invoiceIn>;
    const total = totalOf(b.items);
    const { data, error } = await db().from('invoices').insert({ ...b, user_id: uid, number, total, paid: Math.min(b.paid, total) }).select().single();
    if (!error) {
      await db().from('billing_settings').upsert({ user_id: uid, next_number: n + 1, invoice_prefix: prefix }, { onConflict: 'user_id' });
      await audit(uid, 'invoices.create', 'invoices', data.id);
      return res.status(201).json({ item: data });
    }
    if (error.code !== '23505') throw new ApiError(400, 'VALIDATION', 'Could not save invoice.');
  }
  throw new ApiError(409, 'VALIDATION', 'Could not allocate an invoice number. Try again.');
}));
business.patch('/invoices/:id', validate(invoiceIn.partial()), wrap(async (req, res) => {
  const upd: any = { ...req.body };
  if (upd.items) upd.total = totalOf(upd.items);
  const { data } = await db().from('invoices').update(upd).eq('id', req.params.id).eq('user_id', req.user!.id).select().maybeSingle();
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found.');
  res.json({ item: data });
}));
business.delete('/invoices/:id', wrap(async (req, res) => {
  await db().from('invoices').delete().eq('id', req.params.id).eq('user_id', req.user!.id).eq('status', 'draft');
  res.json({ ok: true });
}));

// ---- billing settings ----
const bsSchema = z.object({
  business_type: optStr, business_name: optStr, phone: optStr, email: optStr, address: z.string().max(400).optional().nullable(),
  gstin: z.string().trim().max(20).optional().nullable(), state: optStr, invoice_prefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/).optional(), round_total: z.boolean().optional(),
}).strict();
business.get('/billing-settings', wrap(async (req, res) => {
  const { data } = await db().from('billing_settings').select('*').eq('user_id', req.user!.id).maybeSingle();
  res.json({ settings: data ?? { invoice_prefix: 'INV', next_number: 1, round_total: false } });
}));
business.put('/billing-settings', validate(bsSchema), wrap(async (req, res) => {
  const { data, error } = await db().from('billing_settings').upsert({ ...req.body, user_id: req.user!.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().single();
  if (error) throw new ApiError(400, 'VALIDATION', 'Could not save settings.');
  res.json({ settings: data });
}));

// ---- Tally export (invoices as Sales vouchers, Tally XML import format) ----
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
business.get('/tally-export', validate(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), company: z.string().max(120).optional() }), 'query'), wrap(async (req, res) => {
  const { from, to, company } = req.query as any;
  const { data } = await db().from('invoices').select('*, customers(name)').eq('user_id', req.user!.id).gte('invoice_date', from).lte('invoice_date', to).in('status', ['sent', 'partially_paid', 'paid']).order('invoice_date');
  const rows = data ?? [];
  const v = rows.map((r) => {
    const party = esc(r.customers?.name ?? 'Cash');
    const d = r.invoice_date.replace(/-/g, '');
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>${d}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(r.number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>` +
      `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${r.total}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
      `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${r.total}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company ?? '')}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${v}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  if (req.query.preview === '1') return res.json({ invoices: rows.length });
  res.setHeader('content-type', 'application/xml');
  res.setHeader('content-disposition', `attachment; filename="dgf-tally-${from}_${to}.xml"`);
  res.send(xml);
}));

// ---- Google Posts (drafts local; publish via Google Local Posts API) ----
const postIn = z.object({
  location_id: z.string().uuid(), post_type: z.enum(['standard', 'offer', 'event']).default('standard'),
  title: z.string().trim().max(58).optional().nullable(), body: z.string().trim().min(1).max(1500),
  image_url: z.string().url().max(500).optional().nullable(), scheduled_at: z.string().datetime().optional().nullable(),
}).strict();
business.get('/posts', wrap(async (req, res) => {
  const { data } = await db().from('content_posts').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(200);
  res.json({ posts: data ?? [] });
}));
business.post('/posts', validate(postIn), wrap(async (req, res) => {
  await ownLocation(req.user!.id, req.body.location_id);
  const status = req.body.scheduled_at ? 'scheduled' : 'draft';
  const { data } = await db().from('content_posts').insert({ ...req.body, status, user_id: req.user!.id }).select().single();
  res.status(201).json({ post: data });
}));
business.patch('/posts/:id', validate(postIn.partial().omit({ location_id: true })), wrap(async (req, res) => {
  const { data } = await db().from('content_posts').update(req.body).eq('id', req.params.id).eq('user_id', req.user!.id).neq('status', 'published').select().maybeSingle();
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Post not found or already published.');
  res.json({ post: data });
}));
business.delete('/posts/:id', wrap(async (req, res) => {
  await db().from('content_posts').delete().eq('id', req.params.id).eq('user_id', req.user!.id).neq('status', 'published');
  res.json({ ok: true });
}));
business.post('/posts/generate', validate(z.object({ location_id: z.string().uuid(), topic: z.string().trim().min(3).max(300), post_type: z.enum(['standard', 'offer', 'event']).default('standard') })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.body.location_id);
  const settle = await spendCredit(uid, 'post_generate');
  try {
    const text = await gemini(`Write a Google Business Profile ${req.body.post_type} post (max 900 chars, 1 emoji max, clear call to action) for "${loc.title}" in ${loc.city ?? 'the local area'}. Topic: ${req.body.topic}. Do not invent prices, dates or offers not in the topic. Output only the post text.`);
    await settle(true);
    res.json({ text: text.trim().slice(0, 1500) });
  } catch (e) { await settle(false); throw e; }
}));
export async function publishPost(uid: string, p: any) {
  const loc = await ownLocation(uid, p.location_id);
  try {
    const body: any = { languageCode: 'en', summary: p.body, topicType: p.post_type === 'offer' ? 'OFFER' : p.post_type === 'event' ? 'EVENT' : 'STANDARD' };
    if (p.image_url) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: p.image_url }];
    const r: any = await G.gsend(uid, 'POST', `https://mybusiness.googleapis.com/v4/${loc.google_account_id}/${loc.google_location_id}/localPosts`, body, 'Publish post');
    await db().from('content_posts').update({ status: 'published', external_ref: r.name ?? null, publish_error: null }).eq('id', p.id);
    return r.name as string | undefined;
  } catch (e) {
    await db().from('content_posts').update({ status: 'failed', publish_error: e instanceof Error ? e.message : 'Failed' }).eq('id', p.id);
    await notify(uid, 'failed_post', 'A Google post failed to publish', e instanceof Error ? e.message : 'Failed', `post-fail-${p.id}`);
    await fireEvent(uid, 'failed_post', `post-${p.id}`, { title: p.title ?? 'Post', eventKey: p.id }).catch(() => {});
    throw e;
  }
}
business.post('/posts/:id/publish', wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: p } = await db().from('content_posts').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!p || !p.location_id) throw new ApiError(404, 'NOT_FOUND', 'Post not found.');
  if (p.status === 'published') throw new ApiError(409, 'VALIDATION', 'Already published.');
  res.json({ ok: true, external_ref: await publishPost(uid, p) });
}));

// ---- module readiness: real status from server config, no fake data ----
business.get('/modules/status', wrap(async (_req, res) => {
  const st = (ok: boolean, need: string) => ({ status: ok ? 'CONNECTED' : 'NOT_CONNECTED', phase: '', note: ok ? 'Ready.' : need });
  res.json({
    ai_mode: st(configured.text, 'Set ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY on the server.'),
    ai_video: st(configured.gemini, 'Set GEMINI_API_KEY (plan with Veo access) on the server.'),
    maps: st(configured.maps, 'Set GOOGLE_MAPS_API_KEY (Places API New) on the server to enable rank checks and competitors.'),
    whatsapp: st(configured.whatsapp, 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID on the server.'),
    gemini: st(configured.gemini, 'Set GEMINI_API_KEY on the server.'),
  });
}));
