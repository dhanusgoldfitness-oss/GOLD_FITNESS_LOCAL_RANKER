import { useState } from 'react';
import { ArrowDown, ArrowUp, Minus, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, LocationPicker, Modal, NoLocations, PageHeader, PageLoading, Toggle, useAction, useApi, useLocations } from '../components/ui';

interface Hist { rank: number | null; status: string; checked_at: string }
interface KW { id: string; keyword: string; active: boolean; current: Hist | null; previous: Hist | null; change: number | null; history: Hist[] }

export default function Keywords() {
  const L = useLocations();
  const d = useApi<{ keywords: KW[]; limit: number; provider: string }>(L.selected ? `/locations/${L.selected}/keywords` : null, [L.selected]);
  const { busy, run } = useAction();
  const [kw, setKw] = useState('');
  const [sugg, setSugg] = useState<string[]>([]);
  const [chart, setChart] = useState<KW | null>(null);

  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Keyword Suggestion" /><NoLocations /></>;
  const add = async (k: string) => { if (await run('add', () => api(`/locations/${L.selected}/keywords`, { method: 'POST', body: { keyword: k } }), 'Keyword added')) { setKw(''); setSugg((s) => s.filter((x) => x !== k)); d.reload(); } };
  const suggest = async () => { const r = await run('sug', () => api<{ keywords: string[] }>(`/locations/${L.selected}/keywords/suggest`, { method: 'POST', body: {} })); if (r) setSugg(r.keywords); };
  const check = async () => { await run('check', () => api(`/locations/${L.selected}/keywords/check`, { method: 'POST', body: {} }), 'Rank check complete'); d.reload(); };
  const toggle = async (k: KW, active: boolean) => { await run('t' + k.id, () => api(`/keywords/${k.id}`, { method: 'PATCH', body: { active } })); d.reload(); };
  const del = async (k: KW) => { if (!confirm(`Delete "${k.keyword}" and its rank history?`)) return; await run('x' + k.id, () => api(`/keywords/${k.id}`, { method: 'DELETE' })); d.reload(); };
  const list = d.data?.keywords ?? [];

  return (
    <>
      <PageHeader title="Keyword Tracking" subtitle="Track where your gym ranks in Google Maps for the searches that matter. Every check is saved — history is never overwritten." actions={<button className="btn-primary" onClick={check} disabled={busy === 'check' || !list.length}><Play size={16} />{busy === 'check' ? 'Checking…' : 'Check ranks now'}</button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <div className="min-w-[240px] flex-1"><label className="label">Add keyword ({list.length}/{d.data?.limit ?? '…'})</label><div className="flex gap-2"><input className="input" value={kw} placeholder="e.g. gym near me" onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && kw.trim().length > 1 && add(kw.trim())} /><button className="btn-primary" disabled={kw.trim().length < 2 || busy === 'add'} onClick={() => add(kw.trim())}><Plus size={16} />Add</button></div></div>
        <button className="btn-ghost" onClick={suggest} disabled={busy === 'sug'}><Sparkles size={16} />{busy === 'sug' ? 'Thinking…' : 'AI suggestions (1 credit)'}</button></div>
      {d.data?.provider === 'NOT_CONNECTED' && <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm"><Badge kind="NOT_CONNECTED" /> Rank provider (Google Maps Platform key) is not configured — you can manage keywords, but checks will report this status instead of fake ranks.</p>}
      {!!sugg.length && <div className="card mb-4"><div className="mb-2 text-sm font-semibold">Suggested (AI ideas, not measured search volume)</div><div className="flex flex-wrap gap-2">{sugg.map((s) => <button key={s} className="btn-ghost px-3 py-1" onClick={() => add(s)}><Plus size={12} />{s}</button>)}</div></div>}
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !list.length ? <EmptyState title="No keywords yet" text="Add the searches your members would use, e.g. “gym in Kengeri”." /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[640px]"><thead><tr className="border-b border-slate-200/10"><th className="th">Keyword</th><th className="th">Rank</th><th className="th">Change</th><th className="th">Last check</th><th className="th">Active</th><th className="th" /></tr></thead>
          <tbody>{list.map((k) => (
            <tr key={k.id} className="border-b border-slate-200/10 last:border-0">
              <td className="td font-semibold"><button className="hover:text-gold-500" onClick={() => setChart(k)}>{k.keyword}</button></td>
              <td className="td">{k.current ? (k.current.rank ? <span className="text-lg font-bold">#{k.current.rank}</span> : <Badge kind="NOT_CONNECTED">Not in top 20</Badge>) : <span className="text-slate-500">Not checked</span>}</td>
              <td className="td">{k.change == null ? <Minus size={14} className="text-slate-500" /> : k.change > 0 ? <span className="inline-flex items-center text-emerald-500"><ArrowUp size={14} />{k.change}</span> : k.change < 0 ? <span className="inline-flex items-center text-red-500"><ArrowDown size={14} />{-k.change}</span> : <span className="text-slate-500">0</span>}</td>
              <td className="td text-xs text-slate-500">{fmtDate(k.current?.checked_at)}</td>
              <td className="td"><Toggle label={`Track ${k.keyword}`} checked={k.active} onChange={(v) => toggle(k, v)} /></td>
              <td className="td text-right"><button className="text-red-400" aria-label="Delete keyword" onClick={() => del(k)}><Trash2 size={16} /></button></td></tr>))}</tbody></table></div>
      )}
      <Modal open={!!chart} onClose={() => setChart(null)} title={chart ? `Rank history — ${chart.keyword}` : ''} wide>
        {chart && (chart.history.filter((h) => h.rank).length < 2 ? <p className="text-sm text-slate-500">Need at least two successful checks to draw a trend.</p> :
          <div className="h-64"><ResponsiveContainer><LineChart data={chart.history.filter((h) => h.rank).map((h) => ({ d: new Date(h.checked_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), rank: h.rank }))}><XAxis dataKey="d" fontSize={12} /><YAxis reversed domain={[1, 20]} fontSize={12} /><Tooltip /><Line type="monotone" dataKey="rank" stroke="#84bd00" strokeWidth={2} /></LineChart></ResponsiveContainer></div>)}
      </Modal>
    </>
  );
}
