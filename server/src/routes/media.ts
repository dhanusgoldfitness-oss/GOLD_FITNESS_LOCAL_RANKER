import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { ApiError } from '../lib/errors.js';
import { db } from '../lib/supabase.js';
import { config, configured } from '../config.js';
import { geminiJson } from '../lib/gemini.js';
import { ownLocation, spendCredit } from './gbp.js';

export const media = Router();
media.use(auth);

const VIDEO_COST = 5;
const GL = 'https://generativelanguage.googleapis.com/v1beta';
const key = () => ({ 'x-goog-api-key': config.GEMINI_API_KEY! });
const signed = async (path: string | null) => path ? (await db().storage.from('dgf-media').createSignedUrl(path, 3600)).data?.signedUrl ?? null : null;

// ================= AI video (Veo via Gemini API; long-running, polled by the client) =================
media.post('/ai-videos', validate(z.object({ prompt: z.string().trim().min(5).max(600), location_id: z.string().uuid().optional() }).strict()), wrap(async (req, res) => {
  const uid = req.user!.id;
  if (!configured.gemini) throw new ApiError(503, 'NOT_CONNECTED', 'Gemini API key is not configured on the server.');
  if (req.body.location_id) await ownLocation(uid, req.body.location_id);
  const { data: p } = await db().from('profiles').select('ai_credits').eq('id', uid).single();
  if ((p?.ai_credits ?? 0) < VIDEO_COST) throw new ApiError(402 as any, 'LIMIT_REACHED', `A video costs ${VIDEO_COST} credits.`);
  let r: Response;
  try {
    r = await fetch(`${GL}/models/${config.GEMINI_VIDEO_MODEL}:predictLongRunning`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...key() },
      body: JSON.stringify({ instances: [{ prompt: `Short promotional video for a fitness gym. ${req.body.prompt}. No on-screen text, no logos.` }] }),
    });
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Gemini.'); }
  if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Gemini quota exceeded.');
  if (!r.ok) throw new ApiError(502, 'API_PENDING' as any, `Video model unavailable (${r.status}). Video generation needs a Gemini plan with Veo access.`);
  const j: any = await r.json();
  if (!j?.name) throw new ApiError(502, 'UPSTREAM', 'Gemini did not start the video job.');
  const { data } = await db().from('ai_videos').insert({ user_id: uid, location_id: req.body.location_id ?? null, prompt: req.body.prompt, operation_name: j.name }).select().single();
  res.status(202).json({ video: data });
}));

media.get('/ai-videos', wrap(async (req, res) => {
  const { data } = await db().from('ai_videos').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(30);
  res.json({ items: await Promise.all((data ?? []).map(async (v) => ({ ...v, operation_name: undefined, url: v.status === 'ready' ? await signed(v.storage_path) : null }))), cost: VIDEO_COST });
}));

/** Ask Gemini whether the job finished; on success store the mp4 and charge credits exactly once. */
media.post('/ai-videos/:id/refresh', wrap(async (req, res) => {
  const uid = req.user!.id;
  const { data: v } = await db().from('ai_videos').select('*').eq('id', req.params.id).eq('user_id', uid).maybeSingle();
  if (!v) throw new ApiError(404, 'NOT_FOUND', 'Video not found.');
  if (v.status !== 'processing') { res.json({ status: v.status, url: await signed(v.storage_path), error: v.error }); return; }
  if (Date.now() - new Date(v.created_at).getTime() > 30 * 60_000) {
    await db().from('ai_videos').update({ status: 'failed', error: 'Timed out after 30 minutes. No credits were used.' }).eq('id', v.id).eq('status', 'processing');
    res.json({ status: 'failed', error: 'Timed out after 30 minutes. No credits were used.' }); return;
  }
  let r: Response;
  try { r = await fetch(`${GL}/${v.operation_name}`, { headers: key() }); } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Gemini.'); }
  if (!r.ok) throw new ApiError(502, 'UPSTREAM', `Gemini status check failed (${r.status}).`);
  const op: any = await r.json();
  if (!op.done) { res.json({ status: 'processing' }); return; }
  const fail = async (msg: string) => { await db().from('ai_videos').update({ status: 'failed', error: msg }).eq('id', v.id).eq('status', 'processing'); res.json({ status: 'failed', error: msg }); };
  if (op.error) return fail(String(op.error.message ?? 'Generation failed').slice(0, 300));
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) return fail('The model returned no video (it may have been blocked by safety filters). No credits were used.');
  const dl = await fetch(uri, { headers: key() });
  if (!dl.ok) return fail(`Could not download the video (${dl.status}). No credits were used.`);
  const path = `${uid}/${Date.now()}.mp4`;
  const up = await db().storage.from('dgf-media').upload(path, Buffer.from(await dl.arrayBuffer()), { contentType: 'video/mp4' });
  if (up.error) return fail('Could not store the video. No credits were used.');
  // claim the transition so concurrent polls charge once
  const { data: claimed } = await db().from('ai_videos').update({ status: 'ready', storage_path: path, error: null }).eq('id', v.id).eq('status', 'processing').select('id');
  if (claimed?.length) { const settle = await spendCredit(uid, 'ai_video', VIDEO_COST).catch(() => null); await settle?.(true); }
  else await db().storage.from('dgf-media').remove([path]);
  res.json({ status: 'ready', url: await signed(path) });
}));

media.patch('/ai-videos/:id', validate(z.object({ approved: z.boolean() }).strict()), wrap(async (req, res) => {
  await db().from('ai_videos').update({ approved: req.body.approved }).eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));
media.delete('/ai-videos/:id', wrap(async (req, res) => {
  const { data } = await db().from('ai_videos').select('storage_path').eq('id', req.params.id).eq('user_id', req.user!.id).maybeSingle();
  if (data?.storage_path) await db().storage.from('dgf-media').remove([data.storage_path]);
  await db().from('ai_videos').delete().eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));

// ================= Social post drafts (copy / share; direct publishing needs each platform's API) =================
const PLATFORMS = ['instagram', 'facebook', 'x', 'whatsapp'] as const;
media.post('/social/generate', validate(z.object({
  topic: z.string().trim().min(3).max(400), location_id: z.string().uuid().optional(),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(4).default([...PLATFORMS]),
}).strict()), wrap(async (req, res) => {
  const uid = req.user!.id;
  const loc = req.body.location_id ? await ownLocation(uid, req.body.location_id) : null;
  const settle = await spendCredit(uid, 'social');
  try {
    const plats: string[] = req.body.platforms;
    const out = await geminiJson<Record<string, { caption: string; hashtags: string[] }>>(
      `Write social media posts for a fitness gym${loc ? ` named "${loc.title}"${loc.city ? ` in ${loc.city}` : ''}` : ''}. Topic: ${req.body.topic}\n` +
      `Do not invent offers, prices, results or claims. Platforms: ${plats.join(', ')}. Rules: instagram up to 300 chars + 8 hashtags; facebook up to 400 chars + 3 hashtags; x up to 240 chars + 2 hashtags; whatsapp status up to 200 chars, no hashtags.\n` +
      `Return JSON keyed by platform: {"<platform>": {"caption": string, "hashtags": string[] (without #)}}`);
    const rows = plats.filter((p) => out[p]?.caption).map((p) => ({
      user_id: uid, location_id: req.body.location_id ?? null, topic: req.body.topic, platform: p,
      caption: String(out[p].caption).slice(0, 1000), hashtags: (out[p].hashtags ?? []).map((h) => String(h).replace(/^#/, '').slice(0, 40)).slice(0, 10),
    }));
    if (!rows.length) throw new ApiError(502, 'UPSTREAM', 'The model returned no usable posts. Please retry.');
    const { data } = await db().from('social_posts').insert(rows).select();
    await settle(true);
    res.status(201).json({ posts: data });
  } catch (e) { await settle(false); throw e; }
}));
media.get('/social', wrap(async (req, res) => {
  const { data } = await db().from('social_posts').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(100);
  res.json({ posts: data ?? [] });
}));
media.patch('/social/:id', validate(z.object({ caption: z.string().trim().min(1).max(1000).optional(), status: z.enum(['draft', 'posted']).optional() }).strict()), wrap(async (req, res) => {
  await db().from('social_posts').update(req.body).eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));
media.delete('/social/:id', wrap(async (req, res) => {
  await db().from('social_posts').delete().eq('id', req.params.id).eq('user_id', req.user!.id);
  res.json({ ok: true });
}));
