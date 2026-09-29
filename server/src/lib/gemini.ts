import { config, configured } from '../config.js';
import { ApiError } from './errors.js';

export interface GenOptions { json?: boolean; temperature?: number }

/** Call Gemini via REST from the backend only. Returns raw text. */
export async function gemini(prompt: string, opts: GenOptions = {}): Promise<string> {
  if (!configured.gemini) throw new ApiError(503, 'NOT_CONNECTED', 'Gemini API key is not configured on the server.');
  const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: opts.temperature ?? 0.6, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  let r: Response;
  try {
    r = await call();
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 4000)); r = await call(); }   // one short retry for per-minute limits
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Gemini.'); }
  if (r.status === 429) {
    let why = '';
    try { const j: any = await r.json(); why = String(j?.error?.message ?? '').split('\n')[0].slice(0, 200); } catch { /* ignore */ }
    console.error('[gemini 429]', why);
    throw new ApiError(429, 'RATE_LIMITED', `Gemini quota exceeded for model ${config.GEMINI_MODEL}. ${why ? why + ' ' : ''}Wait a minute, enable billing in Google AI Studio, or set GEMINI_MODEL to a model with quota.`);
  }
  if (r.status === 401 || r.status === 403) throw new ApiError(502, 'UPSTREAM', 'Gemini rejected the API key.');
  if (!r.ok) throw new ApiError(502, 'UPSTREAM', `Gemini error (${r.status}).`);
  const j: any = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  if (!text) throw new ApiError(502, 'UPSTREAM', 'Gemini returned an empty response.');
  return text;
}

export async function geminiJson<T>(prompt: string): Promise<T> {
  const text = await gemini(prompt, { json: true, temperature: 0.4 });
  try { return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim()) as T; }
  catch { throw new ApiError(502, 'UPSTREAM', 'Gemini returned unparseable output. Please retry.'); }
}
