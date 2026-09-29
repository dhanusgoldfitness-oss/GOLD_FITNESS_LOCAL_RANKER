import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function key(): Buffer {
  if (!config.TOKEN_ENC_KEY || !/^[0-9a-f]{64}$/i.test(config.TOKEN_ENC_KEY)) {
    throw new Error('TOKEN_ENC_KEY missing or invalid (need 64 hex chars)');
  }
  return Buffer.from(config.TOKEN_ENC_KEY, 'hex');
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Signed, expiring OAuth state (CSRF protection). */
function stateSecret() {
  if (!config.OAUTH_STATE_SECRET) throw new Error('OAUTH_STATE_SECRET missing');
  return config.OAUTH_STATE_SECRET;
}
export function signState(userId: string, ttlMs = 10 * 60_000): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + ttlMs, n: randomBytes(8).toString('hex') })).toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyState(state: string): string | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.e > Date.now() ? (p.u as string) : null;
  } catch { return null; }
}
