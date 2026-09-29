import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { db } from '../lib/supabase.js';
import { gemini } from '../lib/gemini.js';
import { spendCredit } from './gbp.js';

export const assistant = Router();
assistant.use(auth);

const body = z.object({
  location_id: z.string().uuid().optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) })).min(1).max(20),
}).strict();

/** Only the caller's own, structured data goes into the prompt — never tokens or secrets. */
async function facts(uid: string, locationId?: string) {
  let q = db().from('business_locations').select('id,title,city,primary_category,website,enabled').eq('user_id', uid).eq('enabled', true);
  if (locationId) q = q.eq('id', locationId);
  const { data: locs } = await q.limit(5);
  const out: any[] = [];
  for (const l of locs ?? []) {
    const [{ data: a }, { data: kws }, { data: rv }] = await Promise.all([
      db().from('gbp_audits').select('score,recommendations,created_at').eq('location_id', l.id).order('created_at', { ascending: false }).limit(1),
      db().from('keywords').select('id,keyword').eq('location_id', l.id).eq('active', true).limit(15),
      db().from('reviews').select('rating,reply_status').eq('location_id', l.id).limit(500),
    ]);
    const ids = (kws ?? []).map((k) => k.id);
    const { data: h } = ids.length ? await db().from('keyword_rank_history').select('keyword_id,rank,status,checked_at').in('keyword_id', ids).neq('status', 'failed').order('checked_at', { ascending: false }).limit(200) : { data: [] as any[] };
    const latest = new Map<string, number | null>();
    for (const r of h ?? []) if (!latest.has(r.keyword_id)) latest.set(r.keyword_id, r.rank);
    const rs = rv ?? [];
    out.push({
      name: l.title, city: l.city, category: l.primary_category,
      auditScore: a?.[0]?.score ?? 'not run yet',
      topFixes: (a?.[0]?.recommendations ?? []).slice(0, 5).map((r: any) => r.title ?? r.key),
      keywordRanks: (kws ?? []).map((k) => ({ keyword: k.keyword, rank: latest.has(k.id) ? latest.get(k.id) ?? 'not in top 20' : 'not checked' })),
      reviews: { count: rs.length, avg: rs.length ? +(rs.reduce((s, r) => s + r.rating, 0) / rs.length).toFixed(2) : null, unanswered: rs.filter((r) => r.reply_status === 'none').length },
    });
  }
  return out;
}

assistant.post('/assistant/chat', validate(body), wrap(async (req, res) => {
  const uid = req.user!.id;
  const { messages, location_id } = req.body as z.infer<typeof body>;
  if (messages[messages.length - 1].role !== 'user') { res.status(400).json({ error: { code: 'VALIDATION', message: 'Last message must be from the user.' } }); return; }
  const settle = await spendCredit(uid, 'assistant');
  try {
    const data = await facts(uid, location_id);
    const convo = messages.map((m) => `${m.role === 'user' ? 'Owner' : 'Assistant'}: ${m.text}`).join('\n');
    const reply = await gemini(
      `You are the DigiMithra assistant, a local SEO advisor for gym owners.\n` +
      `Answer ONLY from the business data below plus general local-SEO knowledge. If the data lacks something (e.g. a rank was never checked), say so; never invent numbers. ` +
      `You cannot change anything; suggest which app page to use (Google Audit, One-Click Optimization, Reviews, Keywords, Local Rank Checker, Competitors). Be concise.\n\n` +
      `BUSINESS DATA: ${JSON.stringify(data)}\n\nCONVERSATION:\n${convo}\nAssistant:`, { temperature: 0.5 });
    await settle(true);
    res.json({ reply: reply.trim(), grounded: data.length > 0 });
  } catch (e) { await settle(false); throw e; }
}));
