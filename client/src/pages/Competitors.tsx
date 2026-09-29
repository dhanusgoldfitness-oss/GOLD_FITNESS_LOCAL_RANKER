import { useState } from 'react';
import { Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, LocationPicker, Modal, NoLocations, PageHeader, PageLoading, useAction, useApi, useLocations } from '../components/ui';

interface Snap { rating: number | null; review_count: number | null; primary_type: string | null; captured_at: string }
interface Comp { id: string; name: string; address: string | null; latest: Snap | null }
interface Cand { id: string; name: string; address?: string; rating?: number; reviews?: number }

export default function Competitors() {
  const L = useLocations();
  const d = useApi<{ me: { name: string; reviews: number | null; rating: number | null }; competitors: Comp[]; provider: string }>(L.selected ? `/locations/${L.selected}/competitors` : null, [L.selected]);
  const { busy, run } = useAction();
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [q, setQ] = useState('');
  const [gap, setGap] = useState<{ observed: any; recommendations: { title: string; why: string }[] } | null>(null);

  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Competitor Analysis" /><NoLocations /></>;
  const discover = async () => { const r = await run('disc', () => api<{ candidates: Cand[] }>(`/locations/${L.selected}/competitors/discover`, { method: 'POST', body: q ? { query: q } : {} })); if (r) setCands(r.candidates); };
  const add = async (c: Cand) => { await run('add' + c.id, () => api(`/locations/${L.selected}/competitors`, { method: 'POST', body: { place_id: c.id, name: c.name, address: c.address } }), 'Competitor added'); setCands((x) => x?.filter((y) => y.id !== c.id) ?? null); d.reload(); };
  const refresh = async () => { const r = await run('ref', () => api<{ total: number; ok: number }>(`/locations/${L.selected}/competitors/refresh`, { method: 'POST', body: {} })); if (r) { d.reload(); } };
  const del = async (c: Comp) => { if (!confirm(`Remove ${c.name}?`)) return; await run('x' + c.id, () => api(`/competitors/${c.id}`, { method: 'DELETE' })); d.reload(); };
  const analyze = async () => { const r = await run('gap', () => api<any>(`/locations/${L.selected}/competitors/gap-analysis`, { method: 'POST', body: {} })); if (r) setGap(r); };
  const list = d.data?.competitors ?? [];

  return (
    <>
      <PageHeader title="Competitor Analysis" subtitle="You choose who counts as a competitor. Numbers come from Google Places snapshots and are dated." actions={<><button className="btn-ghost" onClick={refresh} disabled={busy === 'ref' || !list.length}><RefreshCw size={16} className={busy === 'ref' ? 'animate-spin' : ''} />Refresh data</button><button className="btn-primary" onClick={analyze} disabled={busy === 'gap' || !list.length}><Sparkles size={16} />Gap analysis (1 credit)</button></>} />
      <div className="mb-4 flex flex-wrap items-end gap-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <div className="min-w-[220px] flex-1"><label className="label">Find nearby competitors</label><div className="flex gap-2"><input className="input" placeholder="gym (optional)" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn-ghost" onClick={discover} disabled={busy === 'disc'}><Search size={16} />Search</button></div></div></div>
      {d.data?.provider === 'NOT_CONNECTED' && <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm"><Badge kind="NOT_CONNECTED" /> Google Maps Platform key is not configured, so discovery and refresh are unavailable.</p>}
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : (
        <div className="card mb-6 overflow-x-auto p-0"><table className="w-full min-w-[620px]"><thead><tr className="border-b border-slate-200/10"><th className="th">Business</th><th className="th">Rating</th><th className="th">Reviews</th><th className="th">Category</th><th className="th">Captured</th><th className="th" /></tr></thead>
          <tbody>
            <tr className="border-b border-slate-200/10 bg-gold-500/10"><td className="td font-bold">{d.data?.me.name} <Badge kind="CONNECTED">You</Badge></td><td className="td">{d.data?.me.rating ?? '—'}</td><td className="td">{d.data?.me.reviews ?? '—'}</td><td className="td">—</td><td className="td text-xs text-slate-500">from your synced reviews</td><td /></tr>
            {list.map((c) => <tr key={c.id} className="border-b border-slate-200/10 last:border-0"><td className="td"><div className="font-semibold">{c.name}</div><div className="text-xs text-slate-500">{c.address}</div></td><td className="td">{c.latest?.rating ?? <span className="text-slate-500">no data</span>}</td><td className="td">{c.latest?.review_count ?? '—'}</td><td className="td text-xs">{c.latest?.primary_type ?? '—'}</td><td className="td text-xs text-slate-500">{fmtDate(c.latest?.captured_at)}</td><td className="td text-right"><button className="text-red-400" aria-label="Remove" onClick={() => del(c)}><Trash2 size={16} /></button></td></tr>)}
            {!list.length && <tr><td colSpan={6} className="td text-center text-slate-500">No competitors selected yet. Use “Search” to find nearby businesses.</td></tr>}
          </tbody></table></div>
      )}
      {gap && <div className="card"><h2 className="mb-1 font-bold">Gap analysis</h2><p className="mb-3 text-xs text-slate-500">Observed data is measured; the actions below are AI recommendations based only on it.</p>{gap.recommendations.map((r, i) => <div key={i} className="border-b border-slate-200/10 py-2 last:border-0"><div className="font-semibold">{i + 1}. {r.title}</div><div className="text-sm text-slate-500">{r.why}</div></div>)}</div>}
      <Modal open={!!cands} onClose={() => setCands(null)} title="Nearby businesses" wide>
        {!cands?.length ? <EmptyState title="No results" /> : cands.map((c) => <div key={c.id} className="flex items-center justify-between border-b border-slate-200/10 py-2 last:border-0"><div><div className="font-semibold">{c.name}</div><div className="text-xs text-slate-500">{c.address} · {c.rating ?? '—'}★ ({c.reviews ?? '—'})</div></div><button className="btn-ghost px-2 py-1" onClick={() => add(c)} disabled={busy === 'add' + c.id}><Plus size={14} />Track</button></div>)}
      </Modal>
    </>
  );
}
