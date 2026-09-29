import { config, configured } from '../config.js';
import { ApiError, fromUpstream } from './errors.js';
import { db } from './supabase.js';
import { decrypt } from './crypto.js';

export const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/business.manage'];

export function authUrl(state: string): string {
  if (!configured.google) throw new ApiError(503, 'NOT_CONNECTED', 'Google OAuth is not configured on the server.');
  const p = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!, redirect_uri: config.GOOGLE_REDIRECT_URI, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  let r: Response;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID!, client_secret: config.GOOGLE_CLIENT_SECRET!, ...params }),
    });
  } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Google. Check network and retry.'); }
  const text = await r.text();
  if (!r.ok) {
    if (text.includes('invalid_grant')) throw new ApiError(401, 'REAUTH_REQUIRED', 'Google authorization was revoked or expired. Reconnect.');
    throw fromUpstream(r.status, text, 'Google token exchange');
  }
  return JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: config.GOOGLE_REDIRECT_URI });

const tokenCache = new Map<string, { token: string; exp: number }>();

/** Get a valid access token for a user (refreshing with the encrypted refresh token). */
export async function accessTokenFor(userId: string): Promise<string> {
  const hit = tokenCache.get(userId);
  if (hit && hit.exp > Date.now() + 30_000) return hit.token;
  const { data } = await db().from('google_connections').select('refresh_token_enc,status').eq('user_id', userId).maybeSingle();
  if (!data?.refresh_token_enc) throw new ApiError(409, 'NOT_CONNECTED', 'Google account is not connected.');
  try {
    const t = await tokenRequest({ refresh_token: decrypt(data.refresh_token_enc), grant_type: 'refresh_token' });
    tokenCache.set(userId, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') {
      await db().from('google_connections').update({ status: 'REAUTH_REQUIRED', status_detail: e.message, last_checked_at: new Date().toISOString() }).eq('user_id', userId);
    }
    throw e;
  }
}

export function clearTokenCache(userId: string) { tokenCache.delete(userId); }

export async function gget<T>(userId: string, url: string, what: string): Promise<T> {
  const token = await accessTokenFor(userId);
  let r: Response;
  try { r = await fetch(url, { headers: { authorization: `Bearer ${token}` } }); }
  catch { throw new ApiError(503, 'OFFLINE', `${what}: could not reach Google.`); }
  const text = await r.text();
  if (!r.ok) throw fromUpstream(r.status, text, what);
  return JSON.parse(text) as T;
}

export async function gsend<T>(userId: string, method: 'PUT' | 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown, what: string): Promise<T> {
  const token = await accessTokenFor(userId);
  let r: Response;
  try { r = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new ApiError(503, 'OFFLINE', `${what}: could not reach Google.`); }
  const text = await r.text();
  if (!r.ok) throw fromUpstream(r.status, text, what);
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- Business Profile endpoints ----
const ACCT = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
export const LOCATION_READ_MASK = 'name,title,storeCode,storefrontAddress,phoneNumbers,websiteUri,categories,regularHours,profile,metadata,serviceItems';

export const listAccounts = (u: string) => gget<{ accounts?: any[] }>(u, `${ACCT}/accounts?pageSize=20`, 'List accounts');
export const listLocations = (u: string, account: string) =>
  gget<{ locations?: any[]; nextPageToken?: string }>(u, `${INFO}/${account}/locations?readMask=${LOCATION_READ_MASK}&pageSize=100`, 'List locations');
export const getLocation = (u: string, locationName: string) =>
  gget<any>(u, `${INFO}/${locationName}?readMask=${LOCATION_READ_MASK}`, 'Get location');
export const listReviews = (u: string, account: string, location: string, pageToken?: string) =>
  gget<{ reviews?: any[]; nextPageToken?: string; totalReviewCount?: number }>(
    u, `${V4}/${account}/${location}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`, 'List reviews');
export const putReply = (u: string, account: string, location: string, reviewId: string, comment: string) =>
  gsend(u, 'PUT', `${V4}/${account}/${location}/reviews/${reviewId}/reply`, { comment }, 'Publish reply');
export const deleteReply = (u: string, account: string, location: string, reviewId: string) =>
  gsend(u, 'DELETE', `${V4}/${account}/${location}/reviews/${reviewId}/reply`, undefined, 'Delete reply');
export const patchLocation = (u: string, locationName: string, updateMask: string, body: unknown) =>
  gsend(u, 'PATCH', `${INFO}/${locationName}?updateMask=${updateMask}`, body, 'Update location');
