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

/** OpenAI Chat Completions, backend only. */
async function openai(prompt: string, opts: GenOptions): Promise<string> {
  const call = () => fetch(`${config.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: config.OPENAI_MODEL, temperature: opts.temperature ?? 0.6,
      ...(opts.json && /api\.openai\.com/.test(config.OPENAI_BASE_URL) ? { response_format: { type: 'json_object' } } : {}),
      max_tokens: 4096,
      messages: [
        ...(opts.json ? [{ role: 'system', content: 'Respond with a single valid JSON value only. No markdown fences, no commentary.' }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  let r: Response;
  try {
    r = await call();
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 4000)); r = await call(); }
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach OpenAI.'); }
  if (r.status === 401) throw new ApiError(502, 'UPSTREAM', 'OpenAI rejected the API key (OPENAI_API_KEY).');
  if (!r.ok) {
    let why = ''; try { const j: any = await r.json(); why = String(j?.error?.message ?? '').slice(0, 220); } catch { /* ignore */ }
    console.error('[openai]', r.status, why);
    if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', `OpenAI quota or rate limit reached. ${why} Add credit at platform.openai.com → Billing.`.trim());
    throw new ApiError(502, 'UPSTREAM', `OpenAI error (${r.status}) for model ${config.OPENAI_MODEL}. ${why}`.trim());
  }
  const j: any = await r.json();
  const text = String(j?.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new ApiError(502, 'UPSTREAM', 'OpenAI returned an empty response.');
  return text;
}

/** Text generation. AI_TEXT_PROVIDER=auto tries OpenAI, then Claude, then Gemini (whichever keys are set).
 *  If the chosen provider is temporarily down (5xx / overloaded / unreachable / quota), the next configured one is tried. */
export async function gemini(prompt: string, opts: GenOptions = {}): Promise<string> {
  const p = config.AI_TEXT_PROVIDER;
  const all: [string, boolean, () => Promise<string>][] = [
    ['openai', configured.openai, () => openai(prompt, opts)],
    ['claude', configured.claude, () => claude(prompt, opts)],
    ['gemini', configured.gemini, () => geminiText(prompt, opts)],
  ];
  if (p !== 'auto') {
    const one = all.find((x) => x[0] === p)!;
    if (!one[1]) throw new ApiError(503, 'NOT_CONNECTED', `AI_TEXT_PROVIDER is "${p}" but its API key is not set on the server.`);
    return one[2]();
  }
  const usable = all.filter((x) => x[1]);
  if (!usable.length) throw new ApiError(503, 'NOT_CONNECTED', 'No AI key is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY on the server.');
  let last: unknown;
  for (const [name, , run] of usable) {
    try { return await run(); }
    catch (e) {
      last = e;
      const transient = e instanceof ApiError && (e.status >= 500 || e.code === 'RATE_LIMITED' || e.code === 'OFFLINE' || e.code === 'UPSTREAM');
      console.error(`[ai ${name}] failed${transient ? ', trying next provider' : ''}:`, e instanceof Error ? e.message : e);
      if (!transient) throw e;
    }
  }
  throw last;
}

async function geminiText(prompt: string, opts: GenOptions = {}): Promise<string> {
  if (!configured.gemini) throw new ApiError(503, 'NOT_CONNECTED', 'No AI key is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY on the server.');
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
    if (r.status === 429 || r.status === 503) { await new Promise((ok) => setTimeout(ok, 4000)); r = await call(); }   // one short retry for per-minute limits / momentary overload
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Gemini.'); }
  if (r.status === 429) {
    let why = '';
    try { const j: any = await r.json(); why = String(j?.error?.message ?? '').split('\n')[0].slice(0, 200); } catch { /* ignore */ }
    console.error('[gemini 429]', why);
    throw new ApiError(429, 'RATE_LIMITED', `Gemini quota exceeded for model ${config.GEMINI_MODEL}. ${why ? why + ' ' : ''}Wait a minute, enable billing in Google AI Studio, or set GEMINI_MODEL to a model with quota.`);
  }
  if (r.status === 401 || r.status === 403) throw new ApiError(502, 'UPSTREAM', 'Gemini rejected the API key.');
  if (r.status === 503) throw new ApiError(503, 'UPSTREAM', `Gemini is overloaded right now (503) for model ${config.GEMINI_MODEL}. Try again in a minute, or set GEMINI_MODEL to another model.`);
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
