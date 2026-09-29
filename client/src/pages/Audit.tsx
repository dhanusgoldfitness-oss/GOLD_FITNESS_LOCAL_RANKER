import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Gauge } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, LocationPicker, NoLocations, PageHeader, PageLoading, ScoreRing, useAction, useApi, useLocations } from '../components/ui';

interface AuditRow { id: string; score: number; created_at: string; breakdown: { group: string; earned: number; max: number; pct: number }[]; recommendations: { key: string; label: string; priority: string; pointsLost: number; detail: string; action: string }[] }

export default function Audit() {
  const L = useLocations();
  const hist = useApi<{ audits: AuditRow[] }>(L.selected ? `/locations/${L.selected}/audits` : null, [L.selected]);
  const { busy, run } = useAction();
  const [unknown, setUnknown] = useState<string[]>([]);

  if (L.loading) return <PageLoading />;
  if (L.error) return <ErrorBox error={L.error} onRetry={L.reload} />;
  if (!L.enabled.length) return <><PageHeader title="Google Audit" /><NoLocations /></>;

  const analyze = async () => {
    const r = await run('audit', () => api<{ unknown: string[] }>(`/locations/${L.selected}/audit`, { method: 'POST', body: {} }), 'Audit complete');
    if (r) { setUnknown(r.unknown); hist.reload(); }
  };
  const audits = hist.data?.audits ?? [];
  const cur = audits[0];
  const chart = [...audits].reverse().map((a) => ({ d: new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), score: a.score }));

  return (
    <>
      <PageHeader title="Google Profile Audit" subtitle="DigiMithra's transparent completeness score for your Business Profile (0–100). This is not a Google-provided score." />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <button className="btn-primary" onClick={analyze} disabled={busy === 'audit'}><Gauge size={16} />{busy === 'audit' ? 'Analyzing…' : 'Analyze'}</button>
      </div>
      {hist.loading ? <PageLoading /> : hist.error ? <ErrorBox error={hist.error} onRetry={hist.reload} /> : !cur ? <EmptyState title="No audit yet" text="Click Analyze to score this location. Every run is saved to your history." /> : (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            <div className="card flex flex-col items-center"><ScoreRing score={cur.score} size={170} /><p className="mt-3 text-xs text-slate-500">Last run {fmtDate(cur.created_at)}</p></div>
            <div className="card lg:col-span-2">
              <h2 className="mb-3 font-bold">Score by category</h2>
              {cur.breakdown.map((b) => (
                <div key={b.group} className="mb-3"><div className="mb-1 flex justify-between text-sm"><span>{b.group}</span><span className="font-semibold">{b.earned}/{b.max} pts</span></div>
                  <div className="h-2 rounded-full bg-slate-500/20"><div className="h-2 rounded-full bg-gold-500" style={{ width: `${b.pct}%` }} /></div></div>
              ))}
              {!!unknown.length && <p className="mt-2 rounded-lg bg-slate-500/10 p-2 text-xs">Not scored (data unavailable, excluded — not counted as zero): {unknown.join(', ')}. Sync reviews to include engagement.</p>}
            </div>
          </div>
          <div className="card mb-6">
            <h2 className="mb-1 font-bold">Quick wins</h2><p className="mb-3 text-sm text-slate-500">Highest-impact fixes first — points show what you're losing.</p>
            {!cur.recommendations.length ? <p className="text-sm text-emerald-500">Nothing to fix — full marks on everything we can measure.</p> : cur.recommendations.map((r, i) => (
              <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/10 py-3 last:border-0">
                <div><div className="flex items-center gap-2 font-semibold">{i + 1}. {r.label} <Badge kind={r.priority}>{r.priority}</Badge></div><div className="text-sm text-slate-500">{r.action} <span className="opacity-70">({r.detail})</span></div></div>
                <span className="text-sm font-bold text-red-400">−{r.pointsLost} pts</span>
              </div>))}
          </div>
          {chart.length > 1 && (
            <div className="card"><h2 className="mb-3 font-bold">Audit history</h2>
              <div className="h-56"><ResponsiveContainer><AreaChart data={chart}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="d" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Area type="monotone" dataKey="score" stroke="#84bd00" fill="#84bd0033" /></AreaChart></ResponsiveContainer></div></div>
          )}
        </>
      )}
    </>
  );
}
