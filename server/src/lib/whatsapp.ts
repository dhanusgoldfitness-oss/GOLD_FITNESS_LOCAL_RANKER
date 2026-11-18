import { config, configured } from '../config.js';
import { ApiError } from './errors.js';
import { db } from './supabase.js';

/** Normalise to E.164 digits (India default when 10 digits). */
export function normalizePhone(p: string): string | null {
  const d = p.replace(/[^\d]/g, '');
  if (d.length === 10) return '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Shared Cloud API sender. Every attempt is logged in whatsapp_messages; provider errors are stored, never hidden.
 *  Free-form text only delivers inside the 24h customer-service window; outside it Meta requires an approved template. */
async function deliver(userId: string, to: string, payloads: Record<string, unknown> | Record<string, unknown>[], logBody: string) {
  const attempts = Array.isArray(payloads) ? payloads : [payloads];
  const num = normalizePhone(to);
  if (!num) throw new ApiError(400, 'VALIDATION', 'Invalid phone number.');
  const { data: row } = await db().from('whatsapp_messages').insert({ user_id: userId, direction: 'out', to_number: num, body: logBody, status: 'queued' }).select().single();
  if (!configured.whatsapp) {
    await db().from('whatsapp_messages').update({ status: 'failed', error: 'NOT_CONNECTED: WhatsApp Cloud API credentials missing' }).eq('id', row!.id);
    throw new ApiError(503, 'NOT_CONNECTED', 'WhatsApp Cloud API is not configured on the server.');
  }
  let r!: Response; let j: any = {};
  for (let i = 0; i < attempts.length; i++) {
    try {
      r = await fetch(`https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: num, ...attempts[i] }),
      });
    } catch {
      await db().from('whatsapp_messages').update({ status: 'failed', error: 'OFFLINE' }).eq('id', row!.id);
      throw new ApiError(503, 'OFFLINE', 'Could not reach WhatsApp.');
    }
    j = await r.json().catch(() => ({}));
    if (r.ok || j?.error?.code !== 132001 || i === attempts.length - 1) break;   // 132001 = template/language pair not found: try the next language code
  }
  if (!r.ok) {
    const raw = String(j?.error?.message ?? `HTTP ${r.status}`);
    const outside = j?.error?.code === 131047 || /re-engage|24 hour/i.test(raw);
    const missing = j?.error?.code === 132001;
    const msg = outside ? 'Outside the 24-hour reply window. Send an approved template instead.'
      : missing ? 'Template not found. Check the exact template name and language code in WhatsApp Manager (e.g. en or en_US).' : raw;
    await db().from('whatsapp_messages').update({ status: 'failed', error: msg }).eq('id', row!.id);
    if (outside || missing) throw new ApiError(400, 'VALIDATION', msg);
    throw new ApiError(r.status === 401 ? 401 : 502, r.status === 401 ? 'REAUTH_REQUIRED' : 'UPSTREAM', `WhatsApp: ${msg}`);
  }
  await db().from('whatsapp_messages').update({ status: 'sent', provider_id: j?.messages?.[0]?.id ?? null }).eq('id', row!.id);
  return { id: row!.id };
}

export const sendText = (userId: string, to: string, body: string) =>
  deliver(userId, to, { type: 'text', text: { body: body.slice(0, 4000) } }, body);

/** Approved template; body placeholders {{1}}, {{2}}... are filled from `params` in order. Works outside the 24h window. */
export const sendTemplate = (userId: string, to: string, name: string, language: string, params: string[] = []) => {
  // A template exists per language code; "en" and "en_US" are different. Try the requested one first, then the other English variants.
  const langs = [language, ...(/^en/i.test(language) ? ['en_US', 'en', 'en_GB'] : [])].filter((l, i, a) => a.indexOf(l) === i);
  const payload = (code: string) => ({
    type: 'template',
    template: { name, language: { code }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text.slice(0, 1000) })) }] } : {}) },
  });
  return deliver(userId, to, langs.map(payload), `[Template: ${name}]${params.length ? ' ' + params.join(' | ') : ''}`);
};
