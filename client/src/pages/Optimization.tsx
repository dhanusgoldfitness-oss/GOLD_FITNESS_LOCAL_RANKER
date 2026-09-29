import { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, LocationPicker, NoLocations, PageHeader, PageLoading, useAction, useApi, useLocations } from '../components/ui';

interface Sug { id: string; kind: 'description' | 'categories' | 'services' | 'content'; payload: any; status: 'draft' | 'approved' | 'rejected' | 'applied'; created_at: string }

export default function Optimization() {
  const L = useLocations();
  const sg = useApi<{ suggestions: Sug[] }>(L.selected ? `/locations/${L.selected}/ai/suggestions` : null, [L.selected]);
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Record<string, string>>({});

  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="One-Click Optimization" /><NoLocations /></>;

  const gen = async () => { await run('gen', () => api(`/locations/${L.selected}/ai/optimize`, { method: 'POST', body: {} }), 'Suggestions ready — review them below.'); sg.reload(); };
  const decide = async (s: Sug, status: 'approved' | 'rejected') => {
    const body: any = { status };
    if (edit[s.id] !== undefined) body.payload = s.kind === 'description' ? { text: edit[s.id] } : { items: edit[s.id].split('\n').map((x) => x.trim()).filter(Boolean) };
    await run('d' + s.id, () => api(`/ai/suggestions/${s.id}`, { method: 'PATCH', body }), status === 'approved' ? 'Approved' : 'Rejected'); sg.reload();
  };
  const apply = async (s: Sug) => {
    if (!confirm('This will update your live Google Business Profile description. Continue?')) return;
    await run('a' + s.id, () => api(`/ai/suggestions/${s.id}/apply`, { method: 'POST', body: {} }), 'Applied to Google'); sg.reload();
  };
  const text = (s: Sug) => (s.kind === 'description' ? s.payload.text : (s.payload.items ?? []).join('\n'));

  return (
    <>
      <PageHeader title="One-Click AI Optimization" subtitle="AI recommends — you decide. Nothing is written to Google until you approve and apply it." />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <button className="btn-primary" onClick={gen} disabled={busy === 'gen'}><Sparkles size={16} />{busy === 'gen' ? 'Generating…' : 'Generate suggestions (1 credit)'}</button>
      </div>
      {sg.loading ? <PageLoading /> : sg.error ? <ErrorBox error={sg.error} onRetry={sg.reload} /> : !sg.data?.suggestions.length ? <EmptyState title="No suggestions yet" text="Generate AI suggestions based on your current profile data." /> : (
        <div className="space-y-4">
          {sg.data.suggestions.map((s) => (
            <div key={s.id} className="card">
              <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><h3 className="font-bold capitalize">{s.kind}</h3><Badge kind={s.status === 'applied' ? 'CONNECTED' : s.status === 'rejected' ? 'ERROR' : s.status === 'approved' ? 'CONNECTING' : 'NOT_CONNECTED'}>{s.status}</Badge></div><span className="text-xs text-slate-500">{fmtDate(s.created_at)}</span></div>
              <textarea className="input min-h-[110px]" disabled={s.status === 'applied' || s.status === 'rejected'} value={edit[s.id] ?? text(s)} onChange={(e) => setEdit({ ...edit, [s.id]: e.target.value })} aria-label={`${s.kind} suggestion`} />
              {s.kind === 'description' && <div className="mt-1 text-xs text-slate-500">{(edit[s.id] ?? text(s)).length}/750 characters</div>}
              {s.status === 'draft' && <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={() => decide(s, 'approved')} disabled={busy === 'd' + s.id}><Check size={16} />Approve</button><button className="btn-ghost" onClick={() => decide(s, 'rejected')}><X size={16} />Reject</button></div>}
              {s.status === 'approved' && (s.kind === 'description'
                ? <div className="mt-3"><button className="btn-primary" onClick={() => apply(s)} disabled={busy === 'a' + s.id}>Apply to Google</button></div>
                : <p className="mt-3 text-sm text-slate-500">Approved. Categories and services are applied manually in Google for now — copy the list above.</p>)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
