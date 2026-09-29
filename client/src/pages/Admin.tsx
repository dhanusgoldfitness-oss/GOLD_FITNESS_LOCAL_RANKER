import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, ErrorBox, fmtDate, PageHeader, PageLoading, StatCard, Tabs, useAction, useApi } from '../components/ui';
import { useState } from 'react';

type Tab = 'overview' | 'users' | 'logs';
export default function Admin() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const ov = useApi<{ counts: Record<string, number>; failedAiCalls: number; jobs: { id: string; job: string; window_key: string; status: string; detail: string | null; started_at: string }[] }>(profile?.role === 'super_admin' ? '/admin/overview' : null);
  const us = useApi<{ users: { id: string; full_name: string; email: string; role: string; ai_credits: number; plan: string | null; locations: number }[] }>(profile?.role === 'super_admin' && tab === 'users' ? '/admin/users' : null, [tab]);
  const lg = useApi<{ logs: { id: string; action: string; entity: string; user_id: string; created_at: string }[] }>(profile?.role === 'super_admin' && tab === 'logs' ? '/admin/audit-logs' : null, [tab]);
  const { run } = useAction();
  if (!profile) return <PageLoading />;
  if (profile.role !== 'super_admin') return <Navigate to="/dashboard" replace />;
  const patch = async (id: string, body: object) => { await run('u' + id, () => api(`/admin/users/${id}`, { method: 'PATCH', body }), 'Updated'); us.reload(); };
  return (
    <>
      <PageHeader title="Admin" subtitle="Operate the platform. Every change here is written to the audit log." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview & jobs' }, { id: 'users', label: 'Users' }, { id: 'logs', label: 'Audit log' }]} />
      {tab === 'overview' && (ov.loading ? <PageLoading /> : ov.error ? <ErrorBox error={ov.error} onRetry={ov.reload} /> : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">{Object.entries(ov.data!.counts).map(([k, v]) => <StatCard key={k} label={k} value={v} />)}<StatCard label="failed AI calls" value={ov.data!.failedAiCalls} /></div>
        <h2 className="mb-2 font-bold">Background jobs</h2><div className="card overflow-x-auto p-0"><table className="w-full min-w-[560px]"><tbody>{ov.data!.jobs.map((j) => <tr key={j.id} className="border-b border-slate-200/10 last:border-0"><td className="td font-semibold">{j.job}</td><td className="td text-xs">{j.window_key}</td><td className="td"><Badge kind={j.status === 'ok' ? 'CONNECTED' : j.status === 'failed' ? 'ERROR' : 'CONNECTING'}>{j.status}</Badge></td><td className="td text-xs text-slate-500">{j.detail}</td><td className="td text-xs">{fmtDate(j.started_at)}</td></tr>)}{!ov.data!.jobs.length && <tr><td className="td text-center text-slate-500">No jobs have run yet.</td></tr>}</tbody></table></div></>)}
      {tab === 'users' && (us.loading ? <PageLoading /> : us.error ? <ErrorBox error={us.error} onRetry={us.reload} /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[720px]"><thead><tr className="border-b border-slate-200/10"><th className="th">User</th><th className="th">Role</th><th className="th">Plan</th><th className="th">Locations</th><th className="th">Credits</th></tr></thead><tbody>{us.data!.users.map((u) => (
          <tr key={u.id} className="border-b border-slate-200/10 last:border-0"><td className="td"><div className="font-semibold">{u.full_name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
            <td className="td"><select className="input py-1" aria-label="Role" value={u.role} disabled={u.id === profile.id} onChange={(e) => patch(u.id, { role: e.target.value })}>{['super_admin', 'owner', 'manager', 'staff', 'client'].map((r) => <option key={r}>{r}</option>)}</select></td>
            <td className="td"><select className="input py-1" aria-label="Plan" value={u.plan ?? ''} onChange={(e) => e.target.value && patch(u.id, { plan_id: e.target.value })}><option value="">—</option>{['trial', 'growth', 'pro'].map((p) => <option key={p}>{p}</option>)}</select></td>
            <td className="td">{u.locations}</td>
            <td className="td"><input className="input w-24 py-1" type="number" min="0" defaultValue={u.ai_credits} aria-label="Credits" onBlur={(e) => Number(e.target.value) !== u.ai_credits && patch(u.id, { ai_credits: Number(e.target.value) })} /></td></tr>))}</tbody></table></div>))}
      {tab === 'logs' && (lg.loading ? <PageLoading /> : lg.error ? <ErrorBox error={lg.error} onRetry={lg.reload} /> : <div className="card overflow-x-auto p-0"><table className="w-full min-w-[520px]"><tbody>{lg.data!.logs.map((l) => <tr key={l.id} className="border-b border-slate-200/10 last:border-0"><td className="td font-semibold">{l.action}</td><td className="td text-xs">{l.entity}</td><td className="td text-xs text-slate-500">{l.user_id?.slice(0, 8)}</td><td className="td text-xs">{fmtDate(l.created_at)}</td></tr>)}</tbody></table></div>)}
    </>
  );
}
