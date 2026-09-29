import { config, configured } from '../config.js';
import { ApiError } from './errors.js';
import { db } from './supabase.js';

/** Normalise to E.164 digits (India default when 10 digits). */
export function normalizePhone(p: string): string | null {
  const d = p.replace(/[^\d]/g, '');
  if (d.length === 10) return '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Send a WhatsApp text via Cloud API. Free-form text only delivers inside the 24h customer-service window;
 *  outside it Meta requires an approved template (use sendTemplate). Provider errors are stored, never hidden. */
export async function sendText(userId: string, to: string, body: string) {
  const num = normalizePhone(to);
  if (!num) throw new ApiError(400, 'VALIDATION', 'Invalid phone number.');
  const { data: row } = await db().from('whatsapp_messages').insert({ user_id: userId, direction: 'out', to_number: num, body, status: 'queued' }).select().single();
  if (!configured.whatsapp) {
    await db().from('whatsapp_messages').update({ status: 'failed', error: 'NOT_CONNECTED: WhatsApp Cloud API credentials missing' }).eq('id', row!.id);
    throw new ApiError(503, 'NOT_CONNECTED', 'WhatsApp Cloud API is not configured on the server.');
  }
  let r: Response;
  try {
    r = await fetch(`https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: body.slice(0, 4000) } }),
    });
  } catch {
    await db().from('whatsapp_messages').update({ status: 'failed', error: 'OFFLINE' }).eq('id', row!.id);
    throw new ApiError(503, 'OFFLINE', 'Could not reach WhatsApp.');
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? `HTTP ${r.status}`;
    await db().from('whatsapp_messages').update({ status: 'failed', error: msg }).eq('id', row!.id);
    throw new ApiError(r.status === 401 ? 401 : 502, r.status === 401 ? 'REAUTH_REQUIRED' : 'UPSTREAM', `WhatsApp: ${msg}`);
  }
  await db().from('whatsapp_messages').update({ status: 'sent', provider_id: j?.messages?.[0]?.id ?? null }).eq('id', row!.id);
  return { id: row!.id };
}
