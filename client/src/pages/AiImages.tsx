import { useState } from 'react';
import { Check, ImageIcon, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, EmptyState, ErrorBox, PageHeader, PageLoading, useAction, useApi, useLocations } from '../components/ui';

interface Media { id: string; prompt: string; status: 'draft' | 'approved'; url: string | null }
export default function AiImages() {
  const { profile, refreshProfile } = useAuth();
  const L = useLocations();
  const d = useApi<{ items: Media[] }>('/ai-images');
  const { busy, run } = useAction();
  const [prompt, setPrompt] = useState('');
  const gen = async () => { const r = await run('gen', () => api('/ai-images', { method: 'POST', body: { prompt, ...(L.selected && { location_id: L.selected }) } }), 'Image saved'); if (r) { setPrompt(''); d.reload(); refreshProfile(); } };
  const approve = async (m: Media) => { await run('a' + m.id, () => api(`/ai-images/${m.id}`, { method: 'PATCH', body: { status: m.status === 'approved' ? 'draft' : 'approved' } })); d.reload(); };
  const del = async (m: Media) => { if (!confirm('Delete this image?')) return; await run('x' + m.id, () => api(`/ai-images/${m.id}`, { method: 'DELETE' })); d.reload(); };
  return (
    <>
      <PageHeader title="AI Image Generator" subtitle="Describe the visual — keep it short. 1 credit per image; a failed generation costs nothing." actions={<Badge>{profile?.ai_credits ?? 0} credits left</Badge>} />
      <div className="card mb-6"><label className="label" htmlFor="pr">Image prompt</label><textarea id="pr" className="input min-h-[80px]" maxLength={600} placeholder="e.g. Energetic morning strength class in a modern gym, warm gold lighting" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button className="btn-primary mt-3" onClick={gen} disabled={busy === 'gen' || prompt.trim().length < 3}><ImageIcon size={16} />{busy === 'gen' ? 'Generating…' : 'Generate (1 credit)'}</button></div>
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !d.data?.items.length ? <EmptyState title="No images yet" text="Generated images are stored privately and need your approval before you use them in posts." /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{d.data.items.map((m) => (
          <div key={m.id} className="card p-2"><div className="aspect-square overflow-hidden rounded-xl bg-slate-500/20">{m.url && <img src={m.url} alt={m.prompt} className="h-full w-full object-cover" loading="lazy" />}</div>
            <p className="mt-2 line-clamp-2 text-xs text-slate-500">{m.prompt}</p>
            <div className="mt-2 flex items-center justify-between"><button className={m.status === 'approved' ? 'btn-primary px-2 py-1' : 'btn-ghost px-2 py-1'} onClick={() => approve(m)}><Check size={14} />{m.status === 'approved' ? 'Approved' : 'Approve'}</button>{m.url && m.status === 'approved' && <button className="text-xs text-gold-500" onClick={() => navigator.clipboard.writeText(m.url!)}>Copy link</button>}<button className="text-red-400" aria-label="Delete" onClick={() => del(m)}><Trash2 size={14} /></button></div></div>))}</div>
      )}
    </>
  );
}
