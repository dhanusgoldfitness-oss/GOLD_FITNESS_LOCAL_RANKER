import { Link } from 'react-router-dom';
import { Building2, MapPin, Sparkles, Star } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Badge, ErrorBox, Loc, PageHeader, PageLoading, ScoreRing, StatCard, useApi } from '../components/ui';

export default function Dashboard() {
  const { profile } = useAuth();
  const g = useApi<{ connection: { status: string; google_email?: string } }>('/google/status');
  const l = useApi<{ locations: Loc[] }>('/locations');
  const r = useApi<{ stats: { total: number; replied: number; pending: number; avg: number | null } }>('/reviews?pageSize=1');
  const firstId = l.data?.locations.find((x) => x.enabled)?.id;
  const a = useApi<{ audits: { score: number; created_at: string }[] }>(firstId ? `/locations/${firstId}/audits` : null, [firstId]);

  if (l.loading || g.loading) return <PageLoading />;
  const status = g.data?.connection.status ?? 'NOT_CONNECTED';
  const enabled = l.data?.locations.filter((x) => x.enabled) ?? [];
  const score = a.data?.audits[0]?.score;
  const hour = new Date().getHours();

  return (
    <>
      <div className="mb-6 rounded-2xl bg-gradient-to-r from-gold-600 to-gold-400 p-6 text-ink-950">
        <h1 className="text-2xl font-extrabold">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, {profile?.full_name?.split(' ')[0]}!</h1>
        <p className="mt-1 text-sm font-medium opacity-80">{new Date().toLocaleDateString(undefined, { dateStyle: 'full' })} · Google: <Badge kind={status} /></p>
      </div>
      {g.error && <ErrorBox error={g.error} onRetry={g.reload} />}
      {status !== 'CONNECTED' && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-500/40">
          <div><div className="font-semibold">{status === 'REAUTH_REQUIRED' ? 'Reconnect your Google account' : status === 'API_PENDING' ? 'Google Business Profile API access is pending' : 'Connect your Google Business Profile'}</div>
            <p className="text-sm text-slate-500">Dashboard numbers stay empty until real data is synced. Nothing here is sample data.</p></div>
          <Link to="/google-business" className="btn-primary">Open Google Business</Link>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Business locations" value={enabled.length} hint={`${l.data?.locations.length ?? 0} discovered`} icon={<MapPin size={20} />} />
        <StatCard label="Total reviews" value={r.data?.stats.total ?? '—'} hint={r.data?.stats.avg ? `Avg rating ${r.data.stats.avg} / 5` : 'Sync reviews to see rating'} icon={<Star size={20} />} />
        <StatCard label="Awaiting reply" value={r.data?.stats.pending ?? '—'} hint={r.data ? `${r.data.stats.replied} replied` : undefined} icon={<Building2 size={20} />} />
        <StatCard label="AI credits" value={profile?.ai_credits ?? '—'} hint={(profile?.ai_credits ?? 0) < 3 ? 'Running low' : 'Available'} icon={<Sparkles size={20} />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Profile audit</h2><Link className="text-sm text-gold-500" to="/audit">Full audit →</Link></div>
          {score == null ? <p className="text-sm text-slate-500">{firstId ? 'No audit yet. Run one from the Google Audit page.' : 'Select a location to run your first audit.'}</p>
            : <div className="flex items-center gap-6"><ScoreRing score={score} /><p className="text-sm text-slate-500">Latest DGF completeness score for {enabled[0]?.title}. This is DGF's own score, not a Google metric.</p></div>}
        </div>
        <div className="card">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Locations</h2><Link className="text-sm text-gold-500" to="/google-business">Manage →</Link></div>
          {!enabled.length ? <p className="text-sm text-slate-500">No locations selected yet.</p> : enabled.map((x) => <div key={x.id} className="flex items-center justify-between border-b border-slate-200/10 py-2 text-sm last:border-0"><span>{x.title}</span>{x.verified ? <Badge kind="CONNECTED">Verified</Badge> : <Badge kind="API_PENDING">Unverified</Badge>}</div>)}
        </div>
      </div>
    </>
  );
}
