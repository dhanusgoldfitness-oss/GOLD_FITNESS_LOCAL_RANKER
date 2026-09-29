import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, Modal, PageHeader, PageLoading, Toggle, useAction, useApi } from '../components/ui';

const TRIG: Record<string, string> = { negative_review: 'A negative review arrives', new_lead: 'A new lead is created', rank_drop: 'A keyword rank drops', failed_post: 'A post fails to publish' };
const ACT: Record<string, string> = { notify: 'Send an in-app notification', whatsapp_owner: 'WhatsApp me', draft_review_reply: 'Create an AI reply DRAFT (never auto-published)', whatsapp_lead: 'WhatsApp the lead' };
interface Rule { id: string; name: string; trigger: string; action: string; enabled: boolean; condition: any; action_config: any }
interface Run { id: string; ok: boolean; error: string | null; created_at: string; automation_rules?: { name: string } }

export default function Automations() {
  const d = useApi<{ rules: Rule[]; runs: Run[] }>('/automations');
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', trigger: 'negative_review', action: 'notify', maxRating: 2, minDrop: 3, message: '' });
  const valid = !(f.action === 'draft_review_reply' && f.trigger !== 'negative_review') && !(f.action === 'whatsapp_lead' && f.trigger !== 'new_lead');
  const save = async () => {
    const condition: any = {}; if (f.trigger === 'negative_review') condition.maxRating = f.maxRating; if (f.trigger === 'rank_drop') condition.minDrop = f.minDrop;
    const action_config: any = f.message ? { message: f.message, body: f.message } : {};
    if (await run('save', () => api('/automations', { method: 'POST', body: { name: f.name, trigger: f.trigger, action: f.action, condition, action_config } }), 'Rule created')) { setOpen(false); d.reload(); }
  };
  const addStarter = async () => { const r = await run('starter', () => api<{ added: number }>('/automations/starter', { method: 'POST', body: {} })); if (r) d.reload(); };
  const toggle = async (r: Rule, enabled: boolean) => { await run('t' + r.id, () => api(`/automations/${r.id}`, { method: 'PATCH', body: { enabled } })); d.reload(); };
  const del = async (r: Rule) => { if (!confirm(`Delete "${r.name}"?`)) return; await run('x' + r.id, () => api(`/automations/${r.id}`, { method: 'DELETE' })); d.reload(); };
  if (d.loading) return <PageLoading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  return (
    <>
      <PageHeader title="Automations" subtitle="When something happens, do something — safely. The same event never runs a rule twice." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New rule</button>} />
      {!d.data!.rules.length ? <EmptyState title="No automations yet" text="Example: when a review is 1–2★, notify me and draft an apology reply." action={<button className="btn-primary" disabled={busy === 'starter'} onClick={addStarter}>{busy === 'starter' ? 'Adding…' : 'Add starter automations'}</button>} /> : (
        <div className="mb-6 space-y-3">{d.data!.rules.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold">{r.name}</div><div className="text-sm text-slate-500">When <b>{TRIG[r.trigger]}</b> → {ACT[r.action]}</div></div>
            <div className="flex items-center gap-3"><Toggle label={`Enable ${r.name}`} checked={r.enabled} onChange={(v) => toggle(r, v)} disabled={busy === 't' + r.id} /><button className="text-red-400" aria-label="Delete rule" onClick={() => del(r)}><Trash2 size={16} /></button></div></div>))}</div>
      )}
      <h2 className="mb-2 font-bold">Execution history</h2>
      <div className="card overflow-x-auto p-0"><table className="w-full min-w-[480px]"><tbody>{d.data!.runs.map((r) => <tr key={r.id} className="border-b border-slate-200/10 last:border-0"><td className="td">{r.automation_rules?.name}</td><td className="td"><Badge kind={r.ok ? 'CONNECTED' : 'ERROR'}>{r.ok ? 'ok' : 'failed'}</Badge></td><td className="td text-xs text-red-400">{r.error}</td><td className="td text-xs text-slate-500">{fmtDate(r.created_at)}</td></tr>)}{!d.data!.runs.length && <tr><td className="td text-center text-slate-500">Nothing has run yet.</td></tr>}</tbody></table></div>
      <Modal open={open} onClose={() => setOpen(false)} title="New automation rule">
        <div className="space-y-3"><div><label className="label">Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className="label">When</label><select className="input" value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>{Object.entries(TRIG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {f.trigger === 'negative_review' && <div><label className="label">Rating is at most</label><select className="input" value={f.maxRating} onChange={(e) => setF({ ...f, maxRating: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></div>}
          {f.trigger === 'rank_drop' && <div><label className="label">Drops by at least (places)</label><input className="input" type="number" min="1" value={f.minDrop} onChange={(e) => setF({ ...f, minDrop: Number(e.target.value) })} /></div>}
          <div><label className="label">Then</label><select className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{Object.entries(ACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {['notify', 'whatsapp_owner', 'whatsapp_lead'].includes(f.action) && <div><label className="label">Message (optional — use {'{name}'}, {'{rating}'}, {'{keyword}'})</label><textarea className="input" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>}
          {!valid && <p className="rounded-lg bg-amber-500/10 p-2 text-xs">This action doesn't match the chosen trigger.</p>}</div>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={!f.name.trim() || !valid || busy === 'save'} onClick={save}>Create rule</button></div>
      </Modal>
    </>
  );
}
