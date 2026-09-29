import { useState } from 'react';
import { FileText, Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, ErrorBox, fmtDate, LocationPicker, Modal, NoLocations, PageHeader, PageLoading, useAction, useApi, useLocations } from '../components/ui';

const v = (x: unknown) => (x == null ? 'N/A' : String(x));

export default function Reports() {
  const L = useLocations();
  const d = useApi<{ reports: { id: string; title: string; period_start: string; period_end: string; created_at: string }[] }>('/reports');
  const { busy, run } = useAction();
  const [days, setDays] = useState(30);
  const [view, setView] = useState<any | null>(null);
  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Reports" /><NoLocations /></>;
  const gen = async () => { const r = await run('gen', () => api<{ report: any }>('/reports', { method: 'POST', body: { location_id: L.selected, days } }), 'Report generated'); if (r) { d.reload(); setView(r.report); } };
  const open = async (id: string) => { const r = await run('o' + id, () => api<{ report: any }>(`/reports/${id}`)); if (r) setView(r.report); };
  const del = async (id: string) => { if (!confirm('Delete this report?')) return; await run('x' + id, () => api(`/reports/${id}`, { method: 'DELETE' })); d.reload(); };
  const s = view?.snapshot;
  return (
    <>
      <PageHeader title="Reports" subtitle="Reports are frozen when generated — later data never changes a past report. Print to save as PDF." />
      <div className="card mb-6 flex flex-wrap items-end gap-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <div><label className="label">Period</label><select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={30}>Last 30 days</option><option value={90}>Last quarter</option><option value={180}>Last 6 months</option></select></div>
        <button className="btn-primary" onClick={gen} disabled={busy === 'gen'}><FileText size={16} />{busy === 'gen' ? 'Generating…' : 'Generate report'}</button></div>
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !d.data?.reports.length ? <EmptyState title="No reports yet" text="Generate one above." /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[520px]"><tbody>{d.data.reports.map((r) => <tr key={r.id} className="border-b border-slate-200/10 last:border-0"><td className="td font-semibold">{r.title}</td><td className="td text-xs">{r.period_start} → {r.period_end}</td><td className="td text-xs text-slate-500">{fmtDate(r.created_at)}</td><td className="td text-right whitespace-nowrap"><button className="btn-ghost mr-1 px-2 py-1" onClick={() => open(r.id)}>View</button><button className="text-red-400" aria-label="Delete" onClick={() => del(r.id)}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.title ?? ''} wide>
        {s && <div id="report-print" className="space-y-4 text-sm">
          <div className="flex justify-between"><div><div className="text-lg font-bold">{s.business}</div><div className="text-xs text-slate-500">{s.period.start} → {s.period.end} · generated {fmtDate(s.generatedAt)}</div></div><button className="btn-ghost print:hidden" onClick={() => window.print()}><Printer size={14} />Print / PDF</button></div>
          <section><h3 className="font-bold">Profile audit</h3>{s.audit ? <p>DigiMithra score <b>{s.audit.score}/100</b> (run {fmtDate(s.audit.at)}). Top fixes: {s.audit.top.map((t: any) => t.label).join(', ') || 'none'}.</p> : <p className="text-slate-500">No audit run yet.</p>}</section>
          <section><h3 className="font-bold">Reviews</h3><p>New in period: <b>{s.reviews.newInPeriod}</b> · Average of new: <b>{v(s.reviews.avgInPeriod)}</b> · Unanswered now: <b>{s.reviews.unanswered}</b></p></section>
          <section><h3 className="font-bold">Performance</h3>{s.performance ? <p>Profile views <b>{s.performance.impressions}</b> · Calls <b>{s.performance.calls}</b> · Website clicks <b>{s.performance.website}</b> · Directions <b>{s.performance.directions}</b></p> : <p className="text-slate-500">Performance data unavailable (not synced).</p>}</section>
          <section><h3 className="font-bold">Keyword rankings</h3>{s.keywords.length ? <table className="w-full"><tbody>{s.keywords.map((k: any) => <tr key={k.keyword}><td className="py-1">{k.keyword}</td><td>{k.rank ? `#${k.rank}` : k.checked_at ? 'not in top 20' : 'not checked'}</td></tr>)}</tbody></table> : <p className="text-slate-500">No keywords tracked.</p>}</section>
          <section><h3 className="font-bold">Competitors</h3>{s.competitors.length ? <table className="w-full"><tbody>{s.competitors.map((c: any) => <tr key={c.name}><td className="py-1">{c.name}</td><td>{v(c.rating)}★</td><td>{v(c.reviews)} reviews</td></tr>)}</tbody></table> : <p className="text-slate-500">No competitors tracked.</p>}</section>
          <section><h3 className="font-bold">Posts</h3><p>{s.posts.published} published of {s.posts.total} created in period.</p></section>
        </div>}
      </Modal>
    </>
  );
}
