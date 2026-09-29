import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, ErrorBox, fmtDate, LocationPicker, NoLocations, PageHeader, PageLoading, StatCard, useAction, useApi, useLocations } from '../components/ui';

const LABEL: Record<string, string> = { impressions: 'Profile views', calls: 'Call clicks', website: 'Website clicks', directions: 'Direction requests' };

export default function Performance() {
  const L = useLocations();
  const [days, setDays] = useState(30);
  const d = useApi<{ cards: { key: string; value: number | null; previous: number | null; changePct: number | null }[]; series: { day: string; impressions: number }[]; lastSynced: string | null }>(L.selected ? `/locations/${L.selected}/performance?days=${days}` : null, [L.selected]);
  const { busy, run } = useAction();
  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Performance" /><NoLocations /></>;
  const sync = async () => { const r = await run('sync', () => api<{ rows: number }>(`/locations/${L.selected}/performance/sync`, { method: 'POST', body: {} })); if (r) d.reload(); };
  const empty = d.data && d.data.cards.every((c) => c.value == null);
  return (
    <>
      <PageHeader title="Performance" subtitle="Google Business Profile performance metrics. Missing data is shown as unavailable, not zero." actions={<button className="btn-primary" onClick={sync} disabled={busy === 'sync'}><RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} />Sync from Google</button>} />
      <div className="mb-6 flex flex-wrap items-end gap-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <div className="flex gap-1">{[[7, '7d'], [30, '30d'], [90, '3m'], [180, '6m'], [365, '1y']].map(([n, l]) => <button key={n} className={days === n ? 'btn-primary' : 'btn-ghost'} onClick={() => setDays(n as number)}>{l}</button>)}</div></div>
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : empty ? <EmptyState title="No performance data yet" text="Click “Sync from Google” to import daily metrics. Google publishes them with a ~2 day delay." /> : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{d.data!.cards.map((c) => (
            <StatCard key={c.key} label={LABEL[c.key]} value={c.value ?? 'N/A'} hint={c.changePct == null ? 'No comparison data' : `${c.changePct > 0 ? '+' : ''}${c.changePct}% vs previous ${days}d`} icon={c.changePct == null ? undefined : c.changePct >= 0 ? <ArrowUp size={20} /> : <ArrowDown size={20} />} />))}</div>
          <div className="card"><div className="mb-3 flex justify-between"><h2 className="font-bold">Profile views per day</h2><span className="text-xs text-slate-500">Last synced {fmtDate(d.data!.lastSynced)}</span></div>
            <div className="h-64"><ResponsiveContainer><AreaChart data={d.data!.series}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="day" fontSize={11} tickFormatter={(x) => x.slice(5)} /><YAxis fontSize={12} /><Tooltip /><Area type="monotone" dataKey="impressions" stroke="#d4a017" fill="#d4a01733" /></AreaChart></ResponsiveContainer></div></div>
        </>
      )}
    </>
  );
}
