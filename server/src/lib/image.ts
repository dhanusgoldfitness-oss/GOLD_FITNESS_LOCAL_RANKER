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
  try { const j: any = await r.json(); return String(j?.error?.message ?? '').split('\n')[0].slice(0, 220); } catch { return ''; }
}

/** Tries the classic generateContent call, then the newer Interactions API. Google's real error is surfaced. */
export async function generateImage(prompt: string): Promise<{ data: string; mime: string }> {
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
  throw new ApiError(502, 'API_PENDING' as any, `Image generation failed with ${config.GEMINI_IMAGE_MODEL} (${lastStatus}). ${lastWhy} Check the model name in GEMINI_IMAGE_MODEL and that your Gemini plan includes image generation.`.trim());
}
