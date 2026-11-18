import { config } from '../config.js';
import { ApiError } from './errors.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

async function graph<T = any>(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: config.META_ACCESS_TOKEN! });
  let r: Response;
  try {
    r = method === 'GET'
      ? await fetch(`${GRAPH}${path}?${body}`, { signal: AbortSignal.timeout(30_000) })
      : await fetch(`${GRAPH}${path}`, { method: 'POST', body, signal: AbortSignal.timeout(60_000) });
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Meta.'); }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j?.error?.code; const msg = String(j?.error?.error_user_msg ?? j?.error?.message ?? `HTTP ${r.status}`).slice(0, 300);
    console.error('[meta]', path, r.status, code, msg);
    if (code === 190) throw new ApiError(401, 'REAUTH_REQUIRED', 'Meta rejected the access token (expired or revoked). Create a new long-lived token and set META_ACCESS_TOKEN.');
    throw new ApiError(502, 'UPSTREAM', `Meta: ${msg}`);
  }
  return j as T;
}

/** Instagram Business/Creator account: create a media container (public JPEG/PNG URL required), wait until ready, publish. */
export async function publishInstagram(caption: string, imageUrl: string): Promise<string> {
  const igId = config.INSTAGRAM_USER_ID!;
  const c = await graph<{ id: string }>('POST', `/${igId}/media`, { image_url: imageUrl, caption: caption.slice(0, 2200) });
  for (let i = 0; i < 15; i++) {
    const st = await graph<{ status_code?: string }>('GET', `/${c.id}`, { fields: 'status_code' });
    if (st.status_code === 'FINISHED' || !st.status_code) break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new ApiError(502, 'UPSTREAM', 'Instagram could not process the image. Use a public JPEG or PNG link.');
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  const p = await graph<{ id: string }>('POST', `/${igId}/media_publish`, { creation_id: c.id });
  return p.id;
}

/** Facebook Page: photo post when an image URL is given, otherwise a text post. */
export async function publishFacebook(message: string, imageUrl?: string | null): Promise<string> {
  const pageId = config.FACEBOOK_PAGE_ID!;
  const r = imageUrl
    ? await graph<{ id?: string; post_id?: string }>('POST', `/${pageId}/photos`, { url: imageUrl, caption: message.slice(0, 5000), published: 'true' })
    : await graph<{ id?: string }>('POST', `/${pageId}/feed`, { message: message.slice(0, 5000) });
  return String((r as any).post_id ?? r.id ?? '');
}
