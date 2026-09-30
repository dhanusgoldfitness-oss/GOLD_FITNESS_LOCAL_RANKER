import { config, configured } from '../config.js';
import { ApiError } from './errors.js';

export interface GenOptions { json?: boolean; temperature?: number }

/** Claude (Anthropic Messages API), backend only. */
async function claude(prompt: string, opts: GenOptions): Promise<string> {
  const call = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: config.CLAUDE_MODEL, max_tokens: 4096, temperature: opts.temperature ?? 0.6,
      ...(opts.json ? { system: 'Respond with a single valid JSON value only. No markdown fences, no commentary.' } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  let r: Response;
  try {
    r = await call();
    if (r.status === 429 || r.status === 529) { await new Promise((ok) => setTimeout(ok, 4000)); r = await call(); }
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Claude.'); }
  if (r.status === 401 || r.status === 403) throw new ApiError(502, 'UPSTREAM', 'Claude rejected the API key (ANTHROPIC_API_KEY).');
  if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Claude rate limit reached. Wait a minute and retry, or check your Anthropic plan limits.');
  if (!r.ok) {
    let why = ''; try { const j: any = await r.json(); why = String(j?.error?.message ?? '').slice(0, 200); } catch { /* ignore */ }
    console.error('[claude]', r.status, why);
    throw new ApiError(502, 'UPSTREAM', `Claude error (${r.status}) for model ${config.CLAUDE_MODEL}. ${why}`.trim());
  }
  const j: any = await r.json();
  const text = (j?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  if (!text) throw new ApiError(502, 'UPSTREAM', 'Claude returned an empty response.');
  return text;
}

/** Text generation. Uses Claude when ANTHROPIC_API_KEY is set (unless AI_TEXT_PROVIDER=gemini), otherwise Gemini. */
export async function gemini(prompt: string, opts: GenOptions = {}): Promise<string> {
  const useClaude = configured.claude && (config.AI_TEXT_PROVIDER === 'claude' || (config.AI_TEXT_PROVIDER === 'auto'));
  if (useClaude) return claude(prompt, opts);
  return geminiText(prompt, opts);
}

async function geminiText(prompt: string, opts: GenOptions = {}): Promise<string> {
  if (!configured.gemini) throw new ApiError(503, 'NOT_CONNECTED', 'No AI key is configured. Set ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY on the server.');
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
  catch { throw new ApiError(502, 'UPSTREAM', 'The AI returned unparseable output. Please retry.'); }
}
