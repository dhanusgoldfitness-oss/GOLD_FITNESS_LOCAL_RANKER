import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, RefreshCw, Unplug } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, Loc, PageHeader, PageLoading, StatCard, Toggle, useAction, useApi, useToast } from '../components/ui';

const MSG: Record<string, [string, string]> = {
  connected: ['ok', 'Google account connected. Now sync your locations.'],
  denied: ['err', 'Google permission was declined.'],
  invalid_state: ['err', 'The sign-in link expired or was invalid. Please try again.'],
  no_refresh_token: ['err', 'Google did not return offline access. Remove DigiMithra from your Google account permissions and reconnect.'],
  error: ['err', 'Google connection failed. Please try again.'],
};

export default function GoogleBusiness() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const { busy, run } = useAction();
  const st = useApi<{ connection: { status: string; status_detail?: string; google_email?: string; google_name?: string; google_picture?: string; connected_at?: string }; oauthConfigured: boolean }>('/google/status');
  const locs = useApi<{ locations: Loc[] }>('/locations');

  useEffect(() => {
    const g = sp.get('google');
    if (g && MSG[g]) { toast(MSG[g][0] as 'ok' | 'err', MSG[g][1]); st.reload(); locs.reload(); setSp({}, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (st.loading) return <PageLoading />;
  const c = st.data?.connection;
  const status = c?.status ?? 'NOT_CONNECTED';
  const connected = status === 'CONNECTED' || status === 'API_PENDING';

  const connect = () => run('connect', async () => { const { url } = await api<{ url: string }>('/auth/google/url'); window.location.href = url; });
  const disconnect = async () => { if (!confirm('Disconnect Google? Synced data stays; syncing stops until you reconnect.')) return; await run('disc', () => api('/google/disconnect', { method: 'POST', body: {} }), 'Google disconnected'); st.reload(); };
  const sync = () => run('sync', async () => { const r = await api<{ synced: number }>('/locations/sync', { method: 'POST', body: {} }); await locs.reload(); st.reload(); toast('ok', `Synced ${r.synced} location(s).`); });
  const toggle = async (l: Loc, enabled: boolean) => { await run('t' + l.id, () => api(`/locations/${l.id}`, { method: 'PATCH', body: { enabled } })); locs.reload(); };

  const list = locs.data?.locations ?? [];
  return (
    <>
      <PageHeader title="Google Business" subtitle="Connect your Google account and choose which locations DigiMithra manages." actions={
        connected ? <><button className="btn-ghost" onClick={sync} disabled={busy === 'sync'}><RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} />Sync locations</button><button className="btn-danger" onClick={disconnect}><Unplug size={16} />Disconnect</button></> : undefined} />
      {st.error && <ErrorBox error={st.error} onRetry={st.reload} />}

      <div className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {c?.google_picture ? <img src={c.google_picture} alt="" className="h-14 w-14 rounded-full" referrerPolicy="no-referrer" /> : <div className="h-14 w-14 rounded-full bg-gold-500/20" />}
            <div><div className="text-lg font-bold">{c?.google_name ?? 'Google Business Profile'}</div><div className="text-sm text-slate-500">{c?.google_email ?? 'No account linked'}</div>
              <div className="mt-1 flex items-center gap-2"><Badge kind={status} />{c?.connected_at && <span className="text-xs text-slate-500">since {fmtDate(c.connected_at)}</span>}</div></div>
          </div>
          {!connected && <button className="btn-primary" onClick={connect} disabled={busy === 'connect' || !st.data?.oauthConfigured}>{status === 'REAUTH_REQUIRED' ? 'Reconnect Google' : 'Connect with Google'}</button>}
          {status === 'REAUTH_REQUIRED' && <button className="btn-primary" onClick={connect}>Reconnect Google</button>}
        </div>
        {!st.data?.oauthConfigured && <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm">Google OAuth is <b>NOT_CONNECTED</b> on the server. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to the backend environment.</p>}
        {c?.status_detail && <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm">{c.status_detail}</p>}
        {status === 'API_PENDING' && <p className="mt-2 text-sm text-slate-500">Sign-in worked, but Google has not granted Business Profile API access to this project/account yet. This is separate from OAuth — apply for API access in Google Cloud, then sync again.</p>}
      </div>

      {connected && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="Discovered" value={list.length} />
            <StatCard label="Managed by DigiMithra" value={list.filter((l) => l.enabled).length} />
            <StatCard label="Verified" value={list.filter((l) => l.verified).length} icon={<CheckCircle2 size={20} />} />
          </div>
          {locs.loading ? <PageLoading /> : !list.length ? <EmptyState title="No locations yet" text="Click “Sync locations” to import the locations your Google account manages." action={<button className="btn-primary" onClick={sync}>Sync locations</button>} /> : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[640px]"><thead><tr className="border-b border-slate-200/10"><th className="th">Business</th><th className="th">Status</th><th className="th">Last synced</th><th className="th text-right">Managed</th></tr></thead>
                <tbody>{list.map((l) => (
                  <tr key={l.id} className="border-b border-slate-200/10 last:border-0">
                    <td className="td"><div className="font-semibold">{l.title}</div><div className="text-xs text-slate-500">{l.address ?? '—'}</div></td>
                    <td className="td">{l.verified ? <Badge kind="CONNECTED">Verified</Badge> : <Badge kind="API_PENDING">Unverified</Badge>}{l.sync_error && <div className="mt-1 text-xs text-red-400">{l.sync_error}</div>}</td>
                    <td className="td text-xs text-slate-500">{fmtDate(l.last_synced_at)}</td>
                    <td className="td text-right"><Toggle label={`Manage ${l.title}`} checked={l.enabled} onChange={(v) => toggle(l, v)} disabled={busy === 't' + l.id} /></td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </>
      )}
    </>
  );
}
