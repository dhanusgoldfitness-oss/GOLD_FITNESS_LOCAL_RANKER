import { useState } from 'react';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, Modal, PageHeader, PageLoading, StatCard, Tabs, useAction, useApi } from '../components/ui';

const ST = ['new', 'contacted', 'interested', 'trial_booked', 'visited', 'joined', 'lost'] as const;
const NAME: Record<string, string> = { new: 'New', contacted: 'Contacted', interested: 'Interested', trial_booked: 'Trial booked', visited: 'Visited', joined: 'Joined', lost: 'Lost' };
interface Lead { id: string; name: string; phone: string | null; source: string; interest: string | null; assigned_to: string | null; status: string; next_follow_up: string | null; created_at: string }
type View = 'board' | 'list';

export default function Leads() {
  const d = useApi<{ leads: Lead[]; stats: { total: number; joined: number; conversionPct: number | null; dueFollowUps: number; bySource: Record<string, { total: number; joined: number }> } }>('/leads');
  const { busy, run } = useAction();
  const [view, setView] = useState<View>('board');
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', source: 'walk_in', interest: '', assigned_to: '', next_follow_up: '' });
  const [open, setOpen] = useState<string | null>(null);
  const det = useApi<{ lead: Lead; notes: { id: string; body: string; created_at: string }[]; activities: { id: string; kind: string; detail: string | null; created_at: string }[] }>(open ? `/leads/${open}` : null, [open]);
  const [note, setNote] = useState(''); const [msg, setMsg] = useState('');

  const save = async () => {
    const body: any = { name: f.name, source: f.source }; for (const k of ['phone', 'interest', 'assigned_to', 'next_follow_up'] as const) if (f[k]) body[k] = f[k];
    if (await run('add', () => api('/leads', { method: 'POST', body }), 'Lead added')) { setAdd(false); setF({ ...f, name: '', phone: '', interest: '', assigned_to: '', next_follow_up: '' }); d.reload(); }
  };
  const move = async (l: Lead, status: string) => { await run('m' + l.id, () => api(`/leads/${l.id}`, { method: 'PATCH', body: { status } })); d.reload(); if (open === l.id) det.reload(); };
  const del = async (l: Lead) => { if (!confirm(`Delete ${l.name}?`)) return; await run('x' + l.id, () => api(`/leads/${l.id}`, { method: 'DELETE' })); setOpen(null); d.reload(); };
  const addNote = async () => { if (await run('note', () => api(`/leads/${open}/notes`, { method: 'POST', body: { body: note } }))) { setNote(''); det.reload(); } };
  const sendWa = async () => { if (await run('wa', () => api(`/leads/${open}/whatsapp`, { method: 'POST', body: { message: msg } }), 'WhatsApp sent')) { setMsg(''); det.reload(); } };
  const today = new Date().toISOString().slice(0, 10);

  if (d.loading) return <PageLoading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  const s = d.data!.stats; const leads = d.data!.leads;
  const Card = ({ l }: { l: Lead }) => (
    <div className="rounded-xl border border-slate-200/10 bg-slate-500/5 p-3 text-sm"><button className="text-left font-semibold hover:text-gold-500" onClick={() => setOpen(l.id)}>{l.name}</button>
      <div className="text-xs text-slate-500">{l.phone ?? 'no phone'} · {l.source.replace('_', ' ')}</div>
      {l.next_follow_up && <div className={`mt-1 text-xs ${l.next_follow_up <= today ? 'font-bold text-red-400' : 'text-slate-500'}`}>Follow up {l.next_follow_up}</div>}
      <select className="input mt-2 py-1 text-xs" aria-label={`Move ${l.name}`} value={l.status} onChange={(e) => move(l, e.target.value)}>{ST.map((x) => <option key={x} value={x}>{NAME[x]}</option>)}</select></div>
  );
  return (
    <>
      <PageHeader title="Lead CRM" subtitle="Turn enquiries into members." actions={<button className="btn-primary" onClick={() => setAdd(true)}><Plus size={16} />Add lead</button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Total leads" value={s.total} /><StatCard label="Joined" value={s.joined} /><StatCard label="Conversion" value={s.conversionPct == null ? 'N/A' : `${s.conversionPct}%`} /><StatCard label="Follow-ups due" value={s.dueFollowUps} /></div>
      <Tabs<View> value={view} onChange={setView} tabs={[{ id: 'board', label: 'Pipeline' }, { id: 'list', label: 'List & sources' }]} />
      {!leads.length ? <EmptyState title="No leads yet" text="Add enquiries manually, or connect WhatsApp to capture them automatically." action={<button className="btn-primary" onClick={() => setAdd(true)}>Add lead</button>} /> : view === 'board' ? (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-4 xl:grid-cols-7">{ST.map((st) => (
          <div key={st} className="min-w-[180px]"><div className="mb-2 flex justify-between text-xs font-bold uppercase text-slate-500"><span>{NAME[st]}</span><span>{leads.filter((l) => l.status === st).length}</span></div><div className="space-y-2">{leads.filter((l) => l.status === st).map((l) => <Card key={l.id} l={l} />)}</div></div>))}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3"><div className="card overflow-x-auto p-0 lg:col-span-2"><table className="w-full min-w-[520px]"><tbody>{leads.map((l) => <tr key={l.id} className="border-b border-slate-200/10 last:border-0"><td className="td"><button className="font-semibold hover:text-gold-500" onClick={() => setOpen(l.id)}>{l.name}</button><div className="text-xs text-slate-500">{l.phone}</div></td><td className="td text-xs">{l.source}</td><td className="td"><Badge kind={l.status === 'joined' ? 'CONNECTED' : l.status === 'lost' ? 'ERROR' : 'NOT_CONNECTED'}>{NAME[l.status]}</Badge></td><td className="td text-xs">{l.next_follow_up ?? '—'}</td></tr>)}</tbody></table></div>
          <div className="card"><h3 className="mb-2 font-bold">Conversion by source</h3>{Object.entries(s.bySource).map(([k, v]) => <div key={k} className="flex justify-between border-b border-slate-200/10 py-1 text-sm last:border-0"><span>{k.replace('_', ' ')}</span><span>{v.joined}/{v.total} ({v.total ? Math.round((v.joined / v.total) * 100) : 0}%)</span></div>)}</div></div>
      )}
      <Modal open={add} onClose={() => setAdd(false)} title="Add lead">
        <div className="space-y-3"><div><label className="label">Name *</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">Source</label><select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{['manual', 'walk_in', 'website', 'whatsapp', 'google', 'referral'].map((x) => <option key={x}>{x}</option>)}</select></div><div><label className="label">Follow-up</label><input className="input" type="date" value={f.next_follow_up} onChange={(e) => setF({ ...f, next_follow_up: e.target.value })} /></div></div>
          <div><label className="label">Interested in</label><input className="input" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} placeholder="Strength, MMA, weight loss…" /></div>
          <div><label className="label">Assigned to</label><input className="input" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} /></div></div>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setAdd(false)}>Cancel</button><button className="btn-primary" disabled={!f.name.trim() || busy === 'add'} onClick={save}>Save lead</button></div>
      </Modal>
      <Modal open={!!open} onClose={() => setOpen(null)} title={det.data?.lead.name ?? 'Lead'} wide>
        {det.loading || !det.data ? <PageLoading /> : <div className="grid gap-5 md:grid-cols-2">
          <div><div className="mb-3 space-y-1 text-sm"><div>{det.data.lead.phone ?? 'No phone'} · {det.data.lead.source}</div><div>Interest: {det.data.lead.interest ?? '—'} · Owner: {det.data.lead.assigned_to ?? '—'}</div><div>Follow-up: {det.data.lead.next_follow_up ?? '—'}</div></div>
            <label className="label">Status</label><select className="input mb-4" value={det.data.lead.status} onChange={(e) => move(det.data!.lead, e.target.value)}>{ST.map((x) => <option key={x} value={x}>{NAME[x]}</option>)}</select>
            <label className="label">Add note</label><textarea className="input mb-2" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-ghost mb-4" disabled={!note.trim()} onClick={addNote}>Save note</button>
            {det.data.lead.phone && <><label className="label">WhatsApp message</label><textarea className="input mb-2" value={msg} onChange={(e) => setMsg(e.target.value)} /><button className="btn-primary" disabled={!msg.trim() || busy === 'wa'} onClick={sendWa}><MessageCircle size={14} />Send on WhatsApp</button></>}
            <div className="mt-4"><button className="text-sm text-red-400" onClick={() => del(det.data!.lead)}><Trash2 size={14} className="inline" /> Delete lead</button></div></div>
          <div><h3 className="mb-2 font-bold">Notes</h3>{det.data.notes.map((n) => <div key={n.id} className="mb-2 rounded-lg bg-slate-500/10 p-2 text-sm">{n.body}<div className="text-[10px] text-slate-500">{fmtDate(n.created_at)}</div></div>)}{!det.data.notes.length && <p className="text-sm text-slate-500">No notes.</p>}
            <h3 className="mb-2 mt-4 font-bold">Activity</h3>{det.data.activities.map((a) => <div key={a.id} className="text-xs text-slate-500">{fmtDate(a.created_at)} — {a.kind}: {a.detail}</div>)}</div></div>}
      </Modal>
    </>
  );
}
