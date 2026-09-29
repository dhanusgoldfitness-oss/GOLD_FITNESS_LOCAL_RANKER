import { ErrorBox, fmtDate, PageHeader, PageLoading, StatCard, Badge, useApi } from '../components/ui';

interface Plan { id: string; name: string; price_inr: number; location_limit: number; monthly_credits: number; features: string[] }
interface Sub { id: string; plan_id: string; status: string; period_start: string; period_end: string; plans: Plan }

export default function PlanPage() {
  const p = useApi<{ current: Sub; history: Sub[]; plans: Plan[]; credits: { left: number; used: number }; billing: string }>('/plan');
  if (p.loading) return <PageLoading />;
  if (p.error) return <ErrorBox error={p.error} onRetry={p.reload} />;
  const d = p.data!;
  const days = Math.max(0, Math.ceil((new Date(d.current.period_end).getTime() - Date.now()) / 864e5));
  return (
    <>
      <PageHeader title="Manage Plan" subtitle="Your subscription, credits and limits." />
      <div className="card mb-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex items-center gap-2 text-2xl font-bold">{d.current.plans.name}<Badge kind="CONNECTED">{d.current.status}</Badge></div><div className="text-sm text-slate-500">{fmtDate(d.current.period_start)} → {fmtDate(d.current.period_end)}</div></div><Badge kind={days <= 3 ? 'API_PENDING' : 'NOT_CONNECTED'}>{days} day(s) left</Badge></div></div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label="Credits left" value={d.credits.left} /><StatCard label="Credits used" value={d.credits.used} /><StatCard label="Location limit" value={d.current.plans.location_limit} /></div>
      <h2 className="mb-3 font-bold">Available plans</h2>
      <div className="mb-3 grid gap-4 md:grid-cols-3">{d.plans.map((pl) => (
        <div key={pl.id} className={`card ${pl.id === d.current.plan_id ? 'border-gold-500' : ''}`}><div className="text-lg font-bold">{pl.name}</div><div className="text-2xl font-extrabold">₹{pl.price_inr}<span className="text-sm font-normal text-slate-500">/mo</span></div>
          <ul className="mt-3 space-y-1 text-sm"><li>{pl.location_limit} location(s)</li><li>{pl.monthly_credits} AI credits / month</li>{pl.features.map((f) => <li key={f}>✓ {f}</li>)}</ul></div>))}</div>
      <p className="mb-6 rounded-lg bg-amber-500/10 p-3 text-sm"><Badge kind="API_PENDING" /> {d.billing}</p>
      <div className="card overflow-x-auto p-0"><div className="p-4 font-bold">Subscription history</div><table className="w-full min-w-[520px]"><thead><tr className="border-y border-slate-200/10"><th className="th">Plan</th><th className="th">Start</th><th className="th">End</th><th className="th">Status</th></tr></thead>
        <tbody>{d.history.map((s) => <tr key={s.id} className="border-b border-slate-200/10 last:border-0"><td className="td">{s.plans.name}</td><td className="td">{fmtDate(s.period_start)}</td><td className="td">{fmtDate(s.period_end)}</td><td className="td"><Badge kind="CONNECTED">{s.status}</Badge></td></tr>)}</tbody></table></div>
    </>
  );
}
