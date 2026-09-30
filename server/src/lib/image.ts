import { config, configured } from '../config.js';
import { ApiError } from './errors.js';

const GL = 'https://generativelanguage.googleapis.com/v1beta';
const headers = () => ({ 'content-type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY! });

/** First long base64-looking string stored under a "data"-like key anywhere in the response. */
function findImage(node: any): { data: string; mime: string } | null {
  if (!node || typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && v.length > 1000 && /^(data|bytesBase64Encoded)$/.test(k)) {
      return { data: v, mime: String(node.mimeType ?? node.mime_type ?? 'image/png') };
    }
    if (v && typeof v === 'object') { const r = findImage(v); if (r) return r; }
  }
  return null;
}

async function post(url: string, body: unknown) {
  try { return await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) }); }
  catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Gemini.'); }
}
async function reason(r: Response) {
  try {
    const t = await r.text();
    try { const j: any = JSON.parse(t); return String(j?.error?.message ?? j?.message ?? t).split('\n')[0].slice(0, 260); }
    catch { return t.slice(0, 260); }
  } catch { return ''; }
}

/** Image-capable models this API key can actually call (from Google's ListModels). */
async function discoverImageModels(): Promise<string[]> {
  try {
    const r = await fetch(`${GL}/models?pageSize=200`, { headers: headers() });
    if (!r.ok) return [];
    const j: any = await r.json();
    return (j.models ?? [])
      .filter((m: any) => /image/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''));
  } catch { return []; }
}

async function openaiImage(prompt: string): Promise<{ data: string; mime: string }> {
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: config.OPENAI_IMAGE_MODEL, prompt, size: '1024x1024', n: 1 }),
    });
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach OpenAI.'); }
  if (!r.ok) {
    const why = await reason(r);
    console.error('[openai image]', r.status, why);
    if (r.status === 401) throw new ApiError(502, 'UPSTREAM', 'OpenAI rejected the API key (OPENAI_API_KEY).');
    if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', `OpenAI quota or rate limit reached. ${why} Add credit at platform.openai.com → Billing.`.trim());
    throw new ApiError(502, 'API_PENDING' as any, `OpenAI image generation failed with ${config.OPENAI_IMAGE_MODEL} (${r.status}). ${why} (gpt-image-1 may need organization verification in OpenAI settings.)`.trim());
  }
  const j: any = await r.json().catch(() => null);
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new ApiError(502, 'UPSTREAM', 'OpenAI returned no image.');
  return { data: b64, mime: 'image/png' };
}

/** Tries the classic generateContent call, then the newer Interactions API. Google's real error is surfaced. */
export async function generateImage(prompt: string): Promise<{ data: string; mime: string }> {
  const pv = config.AI_IMAGE_PROVIDER;
  if (pv === 'openai' || (pv === 'auto' && configured.openai)) {
    if (!configured.openai) throw new ApiError(503, 'NOT_CONNECTED', 'OPENAI_API_KEY is not set on the server.');
    return openaiImage(prompt);
  }
  if (!configured.gemini) throw new ApiError(503, 'NOT_CONNECTED', 'Gemini API key is not configured on the server.');
  const attempts: { name: string; run: () => Promise<Response> }[] = [
    { name: 'generateContent', run: () => post(`${GL}/models/${config.GEMINI_IMAGE_MODEL}:generateContent`, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }) },
    { name: 'generateContent+text', run: () => post(`${GL}/models/${config.GEMINI_IMAGE_MODEL}:generateContent`, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }) },
    { name: 'interactions', run: () => post(`${GL}/interactions`, { model: config.GEMINI_IMAGE_MODEL, input: [{ type: 'text', text: prompt }], response_format: { type: 'image', mime_type: 'image/png' } }) },
  ];
  let lastStatus = 0, lastWhy = '';
  for (const a of attempts) {
    const r = await a.run();
    if (r.status === 429) throw new ApiError(429, 'RATE_LIMITED', `Gemini image quota exceeded for ${config.GEMINI_IMAGE_MODEL}. ${await reason(r)}`.trim());
    if (r.ok) {
      const img = findImage(await r.json().catch(() => null));
      if (img) return img;
      lastStatus = 200; lastWhy = 'The model returned no image.';
      continue;
    }
    lastStatus = r.status; lastWhy = await reason(r);
    console.error(`[image ${a.name}] ${r.status} ${lastWhy}`);
    if (r.status === 401 || r.status === 403) break;
  }
  // Configured model failed: try image models this key can really use.
  const found = (await discoverImageModels()).filter((m) => m !== config.GEMINI_IMAGE_MODEL);
  for (const m of found.slice(0, 3)) {
    const r = await post(`${GL}/models/${m}:generateContent`, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
    if (r.ok) { const img = findImage(await r.json().catch(() => null)); if (img) { console.warn(`[image] fell back to ${m}; set GEMINI_IMAGE_MODEL=${m}`); return img; } }
    else console.error(`[image ${m}] ${r.status} ${await reason(r)}`);
  }
  const hint = found.length ? ` Models your key lists: ${found.slice(0, 5).join(', ')}.` : ' Your key lists no image-capable models (enable billing in Google AI Studio).';
  throw new ApiError(502, 'API_PENDING' as any, `Image generation failed with ${config.GEMINI_IMAGE_MODEL} (${lastStatus}). ${lastWhy || 'No reason given by Google.'}${hint}`.trim());
}
