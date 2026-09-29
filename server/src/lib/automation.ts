import { db } from './supabase.js';
import { sendText } from './whatsapp.js';
import { gemini } from './gemini.js';

export type Trigger = 'negative_review' | 'new_lead' | 'rank_drop' | 'failed_post';

/** Evaluate all enabled rules for a user against an event. `eventKey` must be stable per event (idempotency). */
export async function fireEvent(userId: string, trigger: Trigger, eventKey: string, payload: Record<string, any>) {
  const { data: rules } = await db().from('automation_rules').select('*').eq('user_id', userId).eq('trigger', trigger).eq('enabled', true);
  for (const rule of rules ?? []) {
    if (!matches(rule.condition ?? {}, payload)) continue;
    // claim the (rule,event) pair first: a duplicate event hits the unique constraint and is skipped
    const claim = await db().from('automation_runs').insert({ user_id: userId, rule_id: rule.id, event_key: eventKey, ok: false });
    if (claim.error) continue;
    try {
      await runAction(userId, rule, payload);
      await db().from('automation_runs').update({ ok: true }).eq('rule_id', rule.id).eq('event_key', eventKey);
    } catch (e) {
      await db().from('automation_runs').update({ ok: false, error: e instanceof Error ? e.message : 'failed' }).eq('rule_id', rule.id).eq('event_key', eventKey);
    }
  }
}

function matches(cond: Record<string, any>, p: Record<string, any>) {
  if (cond.maxRating != null && !(p.rating != null && p.rating <= cond.maxRating)) return false;
  if (cond.minDrop != null && !(p.drop != null && p.drop >= cond.minDrop)) return false;
  return true;
}

const render = (tpl: string, p: Record<string, any>) => tpl.replace(/\{(\w+)\}/g, (_m, k) => String(p[k] ?? ''));

async function runAction(userId: string, rule: any, p: Record<string, any>) {
  const cfg = rule.action_config ?? {};
  switch (rule.action) {
    case 'notify':
      await db().from('notifications').upsert({ user_id: userId, kind: 'automation', title: render(cfg.title ?? rule.name, p), body: render(cfg.body ?? '', p), dedupe_key: `auto-${rule.id}-${p.eventKey ?? Date.now()}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
      break;
    case 'whatsapp_owner': {
      const { data: prof } = await db().from('profiles').select('phone').eq('id', userId).single();
      if (!prof?.phone) throw new Error('Your profile has no phone number');
      await sendText(userId, prof.phone, render(cfg.message ?? `Automation "${rule.name}" fired.`, p));
      break;
    }
    case 'whatsapp_lead':
      if (!p.phone) throw new Error('Lead has no phone number');
      await sendText(userId, p.phone, render(cfg.message ?? 'Hi {name}, thanks for your enquiry at Dhanus Gold Fitness! We will call you shortly.', p));
      break;
    case 'draft_review_reply': {   // creates a DRAFT only — a human still publishes
      if (!p.reviewId) throw new Error('No review in event');
      const { data: rv } = await db().from('reviews').select('*').eq('id', p.reviewId).eq('user_id', userId).single();
      if (!rv || rv.reply_status === 'published') return;
      const text = await gemini(`Write a short, sincere, professional owner reply (2-3 sentences, plain text) to this ${rv.rating}-star Google review: "${(rv.comment ?? '').slice(0, 800)}". Apologise, invite them to contact us directly, promise nothing specific.`);
      await db().from('reviews').update({ reply_text: text.trim(), reply_status: 'draft' }).eq('id', rv.id);
      break;
    }
  }
}
