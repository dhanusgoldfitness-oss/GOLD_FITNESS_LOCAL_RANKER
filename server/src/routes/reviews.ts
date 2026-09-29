import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { audit, db } from '../lib/supabase.js';
import * as G from '../lib/google.js';
import { gemini, geminiJson } from '../lib/gemini.js';
import { notify } from './core.js';
import { fireEvent } from '../lib/automation.js';
import { ownLocation, spendCredit } from './gbp.js';

export const reviews = Router();
reviews.use(auth);

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const sentimentOf = (rating: number, _c?: string) => (rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative');

export async function syncReviews(uid: string, loc: any) {
  let token: string | undefined, fetched = 0, negatives = 0;
  const newIds: string[] = [];
  do {
    const page = await G.listReviews(uid, loc.google_account_id, loc.google_location_id, token);
    const rows = (page.reviews ?? []).map((r) => {
      const rating = STAR[r.starRating] ?? 0;
      const gid = String(r.reviewId ?? r.name?.split('/').pop());
      return {
        user_id: uid, location_id: loc.id, google_review_id: gid,
        reviewer_name: r.reviewer?.displayName ?? null, rating, comment: r.comment ?? null, sentiment: sentimentOf(rating),
        review_time: r.createTime ?? null,
        ...(r.reviewReply ? { reply_text: r.reviewReply.comment, reply_status: 'published', reply_time: r.reviewReply.updateTime } : {}),
      };
    }).filter((r) => r.rating >= 1);
    if (rows.length) {
      // which of these are brand new? (for negative-review automations — fired once per review)
      const ids = rows.map((r) => r.google_review_id);
      const { data: existing } = await db().from('reviews').select('google_review_id').eq('location_id', loc.id).in('google_review_id', ids);
      const seen = new Set((existing ?? []).map((e) => e.google_review_id));
      // ON CONFLICT (location_id, google_review_id): duplicate sync is safe; local drafts survive because reply fields
      // are only included when Google reports a published reply.
      const { error } = await db().from('reviews').upsert(rows, { onConflict: 'location_id,google_review_id', ignoreDuplicates: false });
      if (error) throw new ApiError(500, 'INTERNAL', 'Could not save reviews.');
      fetched += rows.length;
      for (const r of rows.filter((x) => x.rating <= 2 && !seen.has(x.google_review_id))) {
        negatives++;
        const { data: row } = await db().from('reviews').select('id').eq('location_id', loc.id).eq('google_review_id', r.google_review_id).single();
        await fireEvent(uid, 'negative_review', `review-${r.google_review_id}`, { rating: r.rating, reviewer: r.reviewer_name ?? 'A customer', comment: (r.comment ?? '').slice(0, 200), business: loc.title, reviewId: row?.id, eventKey: r.google_review_id });
      }
      // opt-in: draft (never publish) a reply for each brand-new, unanswered review
      newIds.push(...rows.filter((x) => !seen.has(x.google_review_id) && !(x as any).reply_text).map((x) => x.google_review_id));
    }
    token = page.nextPageToken;
  } while (token && fetched < 1000);
  let drafted = 0;
  if (newIds.length) {
    const { data: prof } = await db().from('profiles').select('auto_reply').eq('id', uid).single();
    if (prof?.auto_reply) {
      // skip reviews an automation already drafted; cap per sync to bound AI usage
      const { data: todo } = await db().from('reviews').select('*').eq('location_id', loc.id).in('google_review_id', newIds).eq('reply_status', 'none').limit(10);
      for (const rv of todo ?? []) {
        try { await generateReplyDraft(uid, rv, loc); drafted++; }
        catch (e) { console.error('[auto-draft]', e instanceof Error ? e.message : e); if (e instanceof ApiError && ['LIMIT_REACHED', 'NOT_CONNECTED'].includes(e.code)) break; }
      }
      if (drafted) await notify(uid, 'reply_drafts', `${drafted} reply draft(s) ready to approve`, `AI drafted replies for new reviews at ${loc.title}. Open Reviews to edit and publish.`, `drafts-${loc.id}-${Date.now()}`);
    }
  }
  await db().from('business_locations').update({ reviews_synced_at: new Date().toISOString() }).eq('id', loc.id);
  if (negatives) await notify(uid, 'negative_review', 'New negative review(s) need attention', `${negatives} new review(s) rated 1–2★ at ${loc.title}.`, `neg-${loc.id}-${new Date().toISOString().slice(0, 10)}`);
  return { fetched, negatives, drafted };
}

reviews.post('/locations/:id/reviews/sync', wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = await ownLocation(uid, req.params.id);
  res.json(await syncReviews(uid, loc));
}));

const listQ = z.object({
  location_id: z.string().uuid().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(['replied', 'unreplied']).optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['recent', 'oldest', 'lowest', 'highest']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(15),
});
reviews.get('/reviews', validate(listQ, 'query'), wrap(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQ>;
  let qb = db().from('reviews').select('*, business_locations(title)', { count: 'exact' }).eq('user_id', req.user!.id);
  if (q.location_id) qb = qb.eq('location_id', q.location_id);
  if (q.rating) qb = qb.eq('rating', q.rating);
  if (q.sentiment) qb = qb.eq('sentiment', q.sentiment);
  if (q.status === 'replied') qb = qb.eq('reply_status', 'published'); else if (q.status === 'unreplied') qb = qb.neq('reply_status', 'published');
  if (q.q) qb = qb.ilike('comment', `%${q.q.replace(/[%,]/g, '')}%`);
  const order = { recent: ['review_time', false], oldest: ['review_time', true], lowest: ['rating', true], highest: ['rating', false] }[q.sort] as [string, boolean];
  const from = (q.page - 1) * q.pageSize;
  const { data, count } = await qb.order(order[0], { ascending: order[1] }).range(from, from + q.pageSize - 1);
  // stats for the same scope
  let sb = db().from('reviews').select('rating,reply_status').eq('user_id', req.user!.id);
  if (q.location_id) sb = sb.eq('location_id', q.location_id);
  const { data: all } = await sb;
  const a = all ?? [];
  res.json({
    reviews: data ?? [], total: count ?? 0, page: q.page,
    stats: {
      total: a.length, replied: a.filter((r) => r.reply_status === 'published').length,
      pending: a.filter((r) => r.reply_status !== 'published').length,
      avg: a.length ? +(a.reduce((s, r) => s + r.rating, 0) / a.length).toFixed(2) : null,
    },
  });
}));

async function ownReview(uid: string, id: string) {
  const { data } = await db().from('reviews').select('*').eq('id', id).eq('user_id', uid).maybeSingle();
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Review not found.');
  return data;
}

/** Writes an AI reply DRAFT for a review (never publishes). Charges 1 credit only on success. */
export async function generateReplyDraft(uid: string, rv: any, loc: any) {
  const { data: prof } = await db().from('profiles').select('reply_tone').eq('id', uid).single();
  const settle = await spendCredit(uid, 'review_reply');
  try {
    const low = rv.rating <= 2;
    const text = await gemini(
      `Write a reply from the owner of "${loc.title}" (${loc.primary_category ?? 'business'}) to this Google review.\n` +
      `Rating: ${rv.rating}/5\nReview: "${(rv.comment ?? '(no text)').slice(0, 1500)}"\nTone: ${prof?.reply_tone ?? 'friendly'}.\n` +
      `Rules: 2-4 sentences, plain text, thank the reviewer${rv.reviewer_name ? ` (first name: ${rv.reviewer_name.split(' ')[0]})` : ''}, ` +
      `${low ? 'apologise sincerely, do not make excuses, invite them to contact the business directly, do not promise compensation.' : 'invite them back.'} ` +
      `Do not invent facts, offers, names of staff or phone numbers. Output only the reply text.`);
    const draft = text.trim().replace(/^["']|["']$/g, '').slice(0, 4000);
    await db().from('reviews').update({ reply_text: draft, reply_status: 'draft' }).eq('id', rv.id);
    await db().from('review_reply_log').insert({ user_id: uid, review_id: rv.id, action: 'ai_generated', body: draft });
    await settle(true);
    return { draft, requiresManualReview: low };
  } catch (e) { await settle(false); throw e; }
}

reviews.post('/reviews/:id/ai-reply', wrap(async (req, res) => {
  const uid = req.user!.id;
  const rv = await ownReview(uid, req.params.id);
  const loc = await ownLocation(uid, rv.location_id);
  res.json(await generateReplyDraft(uid, rv, loc));
}));

reviews.put('/reviews/:id/draft', validate(z.object({ text: z.string().trim().min(1).max(4000) })), wrap(async (req, res) => {
  const rv = await ownReview(req.user!.id, req.params.id);
  if (rv.reply_status === 'published') throw new ApiError(409, 'VALIDATION', 'Already replied. Use edit-published instead.');
  await db().from('reviews').update({ reply_text: req.body.text, reply_status: 'draft' }).eq('id', rv.id);
  await db().from('review_reply_log').insert({ user_id: req.user!.id, review_id: rv.id, action: 'draft_saved', body: req.body.text });
  res.json({ ok: true });
}));

// Publishing ALWAYS requires an explicit human call with the final text.
reviews.post('/reviews/:id/publish', validate(z.object({ text: z.string().trim().min(1).max(4000) })), wrap(async (req, res) => {
  const uid = req.user!.id;
  const rv = await ownReview(uid, req.params.id);
  const loc = await ownLocation(uid, rv.location_id);
  await G.putReply(uid, loc.google_account_id, loc.google_location_id, rv.google_review_id, req.body.text);
  await db().from('reviews').update({ reply_text: req.body.text, reply_status: 'published', reply_time: new Date().toISOString() }).eq('id', rv.id);
  await db().from('review_reply_log').insert({ user_id: uid, review_id: rv.id, action: 'published', body: req.body.text });
  await audit(uid, 'review.reply_publish', 'reviews', rv.id);
  res.json({ ok: true });
}));

reviews.delete('/reviews/:id/reply', wrap(async (req, res) => {
  const uid = req.user!.id;
  const rv = await ownReview(uid, req.params.id);
  if (rv.reply_status === 'published') {
    const loc = await ownLocation(uid, rv.location_id);
    await G.deleteReply(uid, loc.google_account_id, loc.google_location_id, rv.google_review_id);
  }
  await db().from('reviews').update({ reply_text: null, reply_status: 'none', reply_time: null }).eq('id', rv.id);
  await db().from('review_reply_log').insert({ user_id: uid, review_id: rv.id, action: 'deleted' });
  res.json({ ok: true });
}));

export { geminiJson };
