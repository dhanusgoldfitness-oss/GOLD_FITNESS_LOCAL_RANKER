import { useEffect, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, LocationPicker, NoLocations, PageHeader, PageLoading, useAction, useApi, useLocations } from '../components/ui';

interface Scan { id: string; keyword: string; grid_size: number; radius_km: number; status: string; created_at: string; center_lat: number; center_lng: number }
interface Pt { idx: number; lat: number; lng: number; rank: number | null; status: string; error?: string; checked_at?: string }
const cls = (p: Pt) => p.status === 'failed' ? 'bg-slate-600 text-slate-300' : p.rank == null ? 'bg-red-900/60 text-red-200' : p.rank <= 3 ? 'bg-emerald-500 text-white' : p.rank <= 10 ? 'bg-amber-400 text-ink-950' : p.rank <= 20 ? 'bg-orange-500 text-white' : 'bg-red-500 text-white';

export default function RankChecker() {
  const L = useLocations();
  const hist = useApi<{ scans: Scan[] }>(L.selected ? `/locations/${L.selected}/geo-scans` : null, [L.selected]);
  const { busy, run } = useAction();
  const [f, setF] = useState({ keyword: '', grid_size: 5, radius_km: 3 });
  const [open, setOpen] = useState<{ scan: Scan; points: Pt[] } | null>(null);
  useEffect(() => setOpen(null), [L.selected]);

  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Local Rank Checker" /><NoLocations /></>;
  const scanNow = async () => { const r = await run('scan', () => api<{ scan: Scan; points: Pt[] }>(`/locations/${L.selected}/geo-scans`, { method: 'POST', body: f }), 'Scan complete'); if (r) { setOpen(r); hist.reload(); } };
  const load = async (id: string) => { const r = await run('load', () => api<{ scan: Scan; points: Pt[] }>(`/geo-scans/${id}`)); if (r) setOpen(r); };
  const pts = open ? [...open.points].sort((a, b) => a.idx - b.idx) : [];
  const found = pts.filter((p) => p.rank != null);
  const avg = found.length ? (found.reduce((a, p) => a + (p.rank ?? 0), 0) / found.length).toFixed(1) : null;

  return (
    <>
      <PageHeader title="Geo-Grid Rank Checker" subtitle="See where you rank for a keyword, block by block. Failed points are shown as failed — never guessed." />
      <div className="card mb-6 grid gap-3 md:grid-cols-5">
        <div className="md:col-span-2"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} /></div>
        <div><label className="label">Keyword</label><input className="input" value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} placeholder="gym near me" /></div>
        <div><label className="label">Grid</label><select className="input" value={f.grid_size} onChange={(e) => setF({ ...f, grid_size: Number(e.target.value) })}>{[3, 5, 7].map((n) => <option key={n} value={n}>{n} × {n} ({n * n} points)</option>)}</select></div>
        <div><label className="label">Radius (km)</label><input className="input" type="number" min="0.5" max="25" step="0.5" value={f.radius_km} onChange={(e) => setF({ ...f, radius_km: Number(e.target.value) })} /></div>
        <div className="md:col-span-5"><button className="btn-primary" onClick={scanNow} disabled={busy === 'scan' || f.keyword.trim().length < 2}><MapIcon size={16} />{busy === 'scan' ? `Scanning ${f.grid_size * f.grid_size} points…` : 'Run scan'}</button></div>
      </div>
      {open && (
        <div className="card mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="font-bold">“{open.scan.keyword}” · {open.scan.grid_size}×{open.scan.grid_size} · {open.scan.radius_km} km</div><div className="text-xs text-slate-500">{fmtDate(open.scan.created_at)} · centre {open.scan.center_lat.toFixed(4)}, {open.scan.center_lng.toFixed(4)}</div></div><div className="flex gap-2"><Badge kind={open.scan.status === 'done' ? 'CONNECTED' : open.scan.status === 'partial' ? 'API_PENDING' : 'ERROR'}>{open.scan.status}</Badge>{avg && <Badge>avg rank {avg}</Badge>}<Badge>{found.length}/{pts.length} found</Badge></div></div>
          <div className="mx-auto grid max-w-lg gap-1.5" style={{ gridTemplateColumns: `repeat(${open.scan.grid_size}, minmax(0,1fr))` }}>
            {pts.map((p) => <div key={p.idx} title={`${p.lat}, ${p.lng}${p.error ? ' — ' + p.error : ''}`} className={`flex aspect-square items-center justify-center rounded-xl text-sm font-bold ${cls(p)}`}>{p.status === 'failed' ? '!' : p.rank ?? '–'}</div>)}
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs"><span><i className="mr-1 inline-block h-3 w-3 rounded bg-emerald-500" />1–3</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-amber-400" />4–10</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-orange-500" />11–20</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-red-900" />not in top 20</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-slate-600" />check failed</span></div>
        </div>
      )}
      <h2 className="mb-2 font-bold">Scan history</h2>
      {hist.loading ? <PageLoading /> : hist.error ? <ErrorBox error={hist.error} onRetry={hist.reload} /> : !hist.data?.scans.length ? <EmptyState title="No scans yet" text="Run your first scan above." /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[520px]"><tbody>{hist.data.scans.map((s) => (
          <tr key={s.id} className="border-b border-slate-200/10 last:border-0"><td className="td font-semibold">{s.keyword}</td><td className="td">{s.grid_size}×{s.grid_size}, {s.radius_km} km</td><td className="td text-xs">{fmtDate(s.created_at)}</td><td className="td"><Badge kind={s.status === 'done' ? 'CONNECTED' : s.status === 'partial' ? 'API_PENDING' : 'ERROR'}>{s.status}</Badge></td><td className="td text-right"><button className="btn-ghost px-2 py-1" onClick={() => load(s.id)}>Open</button></td></tr>))}</tbody></table></div>
      )}
    </>
  );
}
