import { useState } from 'react';
import { supabase } from '../lib/api';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, ErrorBox, fmtDate, PageHeader, PageLoading, Tabs, Toggle, useAction, useApi } from '../components/ui';

type Tab = 'profile' | 'notifications' | 'connections' | 'diagnostics' | 'legal' | 'danger';

export default function SettingsPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');
  const { busy, run } = useAction();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [confirmDel, setConfirmDel] = useState('');
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const diag = useApi<{ checkedAt: string; checks: Record<string, { status: string; detail?: string }> }>(tab === 'diagnostics' ? '/diagnostics' : null, [tab]);
  const conn = useApi<{ connection: { status: string; google_email?: string } }>(tab === 'connections' ? '/google/status' : null, [tab]);
  const wa = useApi<{ status: string }>('/whatsapp/status');

  if (!profile) return <PageLoading />;
  const patch = async (b: Record<string, unknown>, msg = 'Saved') => { await run('p', () => api('/me', { method: 'PATCH', body: b }), msg); refreshProfile(); };
  const pref = (k: keyof typeof profile, label: string, hint: string, disabled?: string) => (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/10 p-4"><div><div className="font-semibold">{label}</div><div className="text-xs text-slate-500">{hint}</div>{disabled && <div className="mt-1"><Badge kind="NOT_CONNECTED">{disabled}</Badge></div>}</div>
      <Toggle label={label} checked={!!profile[k]} disabled={!!disabled} onChange={(v) => patch({ [k]: v }, 'Preference saved')} /></div>
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, notifications, connections and diagnostics." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'profile', label: 'Profile' }, { id: 'notifications', label: 'Notifications' }, { id: 'connections', label: 'Connections' }, { id: 'diagnostics', label: 'Diagnostics' }, { id: 'legal', label: 'Legal' }, { id: 'danger', label: 'Danger zone' }]} />

      {tab === 'profile' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card"><h2 className="mb-3 font-bold">Profile information</h2>
            <label className="label">Full name</label><input className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="label">Email</label><input className="input mb-3 opacity-70" value={profile.email ?? ''} disabled />
            <label className="label">Phone</label><input className="input mb-4" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button className="btn-primary" disabled={busy === 'p' || !name.trim()} onClick={() => patch({ full_name: name.trim(), phone: phone.trim() }, 'Profile saved')}>Save changes</button></div>
          <div className="card"><h2 className="mb-3 font-bold">Change password</h2>
            <label className="label">New password</label><input className="input mb-3" type="password" minLength={8} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <label className="label">Confirm</label><input className="input mb-4" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            <button className="btn-primary" disabled={pw.next.length < 8 || pw.next !== pw.confirm || busy === 'pw'} onClick={async () => { await run('pw', async () => { const { error } = await supabase.auth.updateUser({ password: pw.next }); if (error) throw new Error(error.message); }, 'Password updated'); setPw({ next: '', confirm: '' }); }}>Update password</button>
            {pw.confirm && pw.next !== pw.confirm && <p className="mt-2 text-xs text-red-400">Passwords do not match.</p>}</div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="grid gap-3 md:grid-cols-2">
          {pref('notif_review_alerts', 'Review alerts', 'In-app alert when new negative reviews are synced.')}
          {pref('notif_email', 'Email activity notifications', 'Receive activity updates by email.', 'Email delivery not connected')}
          {pref('notif_whatsapp', 'WhatsApp notifications', 'Real-time review alerts on WhatsApp.', 'WhatsApp Cloud API not connected')}
          {pref('auto_reply', 'Auto-draft replies for new reviews', 'AI writes a reply draft for every new review when reviews sync. Nothing is published until you approve it. Uses 1 AI credit per draft.')}
          <div className="card md:col-span-2"><label className="label">AI reply tone</label><select className="input max-w-xs" value={profile.reply_tone} onChange={(e) => patch({ reply_tone: e.target.value }, 'Tone saved')}>{['friendly', 'professional', 'energetic', 'empathetic'].map((t) => <option key={t}>{t}</option>)}</select></div>
        </div>
      )}

      {tab === 'connections' && (
        <div className="card max-w-xl">{conn.loading ? <PageLoading /> : conn.error ? <ErrorBox error={conn.error} onRetry={conn.reload} /> : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-200/10 p-4"><div><div className="font-semibold">Google Business Profile</div><div className="text-xs text-slate-500">{conn.data?.connection.google_email ?? 'Not linked'}</div></div><div className="flex items-center gap-2"><Badge kind={conn.data?.connection.status} /><a className="btn-ghost" href="/google-business">Manage</a></div></div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200/10 p-4"><div><div className="font-semibold">Instagram</div><div className="text-xs text-slate-500">Not built yet — Social Post drafts captions you copy or open manually.</div></div><Badge kind="API_PENDING" /></div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200/10 p-4"><div><div className="font-semibold">WhatsApp Cloud API</div><div className="text-xs text-slate-500">Set on the server; see the WhatsApp page for details.</div></div><Badge kind={wa.data?.status ?? 'NOT_CONNECTED'} /></div>
          </div>)}</div>
      )}

      {tab === 'diagnostics' && (
        <div className="card">{diag.error ? <ErrorBox error={diag.error} onRetry={diag.reload} /> : (diag.loading || !diag.data) ? <PageLoading /> : (
          <>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">System diagnostics</h2><span className="text-xs text-slate-500">Checked {fmtDate(diag.data!.checkedAt)}</span></div>
            <div className="grid gap-3 md:grid-cols-2">{Object.entries(diag.data!.checks).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between rounded-xl border border-slate-200/10 p-3"><div><div className="font-semibold capitalize">{k.replace(/_/g, ' ')}</div>{v.detail && <div className="text-xs text-slate-500">{v.detail}</div>}</div><Badge kind={v.status} /></div>))}</div>
            <button className="btn-ghost mt-4" onClick={diag.reload}>Re-check</button>
          </>)}</div>
      )}

      {tab === 'legal' && (
        <div className="card max-w-3xl space-y-3 text-sm">
          <h2 className="text-lg font-bold">Legal</h2>
          <p><b>DigiMithra</b> helps you manage your own Google Business Profile using official Google APIs and only with your permission. Google refresh tokens are encrypted and never sent to your browser. AI text is always a draft you approve before anything is published.</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
            <a className="btn-ghost" href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>
            <a className="btn-ghost" href="/data-deletion" target="_blank" rel="noreferrer">Data deletion</a>
          </div>
          <p className="text-xs text-slate-500">Questions: dhanusgoldfitness@gmail.com</p>
        </div>
      )}

      {tab === 'danger' && (
        <div className="grid max-w-xl gap-4">
          <div className="card"><h2 className="mb-2 font-bold">This device</h2>
            <p className="mb-3 text-sm text-slate-500">Sign out of DigiMithra on this device.</p>
            <button className="btn-ghost" onClick={signOut}>Sign out</button></div>
          <div className="card"><h2 className="mb-2 font-bold">Download my data</h2>
            <p className="mb-3 text-sm text-slate-500">A JSON file with your profile, locations, reviews, keywords, posts, leads and more.</p>
            <button className="btn-ghost" disabled={busy === 'exp'} onClick={() => run('exp', async () => {
              const d = await api<unknown>('/me/export');
              const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
              const a = document.createElement('a'); a.href = url; a.download = 'digimithra-data.json'; a.click(); URL.revokeObjectURL(url);
            }, 'Data downloaded')}>{busy === 'exp' ? 'Preparing…' : 'Download data (JSON)'}</button></div>
          <div className="card border-red-500/40"><h2 className="mb-2 font-bold text-red-400">Delete my account</h2>
            <p className="mb-3 text-sm">Permanently deletes your account and all data (locations, reviews, keywords, posts, leads, reports). Google is disconnected. This cannot be undone.</p>
            <label className="label" htmlFor="delc">Type your email <b>{profile.email}</b> to confirm</label>
            <input id="delc" className="input mb-3" value={confirmDel} onChange={(e) => setConfirmDel(e.target.value)} autoComplete="off" />
            <button className="btn-danger" disabled={busy === 'del' || confirmDel.trim().toLowerCase() !== (profile.email ?? '').toLowerCase()} onClick={async () => {
              if (!confirm('Delete your account and all data permanently?')) return;
              const r = await run('del', () => api('/me/delete', { method: 'POST', body: { confirm: confirmDel.trim() } }), 'Account deleted');
              if (r) await signOut();
            }}>{busy === 'del' ? 'Deleting…' : 'Delete account permanently'}</button></div>
        </div>
      )}
    </>
  );
}
