import { useEffect, useState } from 'react';
import { Check, Trash2, Video } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, EmptyState, ErrorBox, PageHeader, PageLoading, Spinner, useAction, useApi, useLocations } from '../components/ui';

interface V { id: string; prompt: string; status: 'processing' | 'ready' | 'failed'; approved: boolean; error: string | null; url: string | null; created_at: string }

export default function AiVideo() {
  const { profile, refreshProfile } = useAuth();
  const L = useLocations();
  const d = useApi<{ items: V[]; cost: number }>('/ai-videos');
  const { busy, run } = useAction();
  const [prompt, setPrompt] = useState('');
  const cost = d.data?.cost ?? 5;
  const processing = (d.data?.items ?? []).filter((v) => v.status === 'processing').map((v) => v.id).join(',');

  // poll unfinished jobs every 10s until they resolve
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(async () => {
      let changed = false;
      for (const id of processing.split(',')) { try { const r = await api<{ status: string }>(`/ai-videos/${id}/refresh`, { method: 'POST', body: {} }); if (r.status !== 'processing') changed = true; } catch { /* keep polling */ } }
      if (changed) { d.reload(); refreshProfile(); }
    }, 10000);
    return () => clearInterval(t);
  }, [processing]);   // eslint-disable-line react-hooks/exhaustive-deps

  const gen = async () => { const r = await run('gen', () => api('/ai-videos', { method: 'POST', body: { prompt, ...(L.selected && { location_id: L.selected }) } }), 'Video started — this takes a few minutes'); if (r) { setPrompt(''); d.reload(); } };
  const approve = async (v: V) => { await run('a' + v.id, () => api(`/ai-videos/${v.id}`, { method: 'PATCH', body: { approved: !v.approved } })); d.reload(); };
  const del = async (v: V) => { if (!confirm('Delete this video?')) return; await run('x' + v.id, () => api(`/ai-videos/${v.id}`, { method: 'DELETE' })); d.reload(); };

  return (
    <>
      <PageHeader title="AI Video" subtitle={`Short promo clips generated with Google Veo. ${cost} credits, charged only when the video is ready.`} actions={<Badge>{profile?.ai_credits ?? 0} credits left</Badge>} />
      <div className="card mb-6"><label className="label" htmlFor="vp">Describe the video</label>
        <textarea id="vp" className="input min-h-[80px]" maxLength={600} placeholder="e.g. Slow-motion barbell lift in a bright gym, members cheering, warm gold tones" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button className="btn-primary mt-3" onClick={gen} disabled={busy === 'gen' || prompt.trim().length < 5}><Video size={16} />{busy === 'gen' ? 'Starting…' : `Generate (${cost} credits)`}</button></div>
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !d.data?.items.length ? <EmptyState title="No videos yet" text="Videos are stored privately and need your approval before you use them." /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{d.data.items.map((v) => (
          <div key={v.id} className="card p-2">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-slate-500/20">
              {v.status === 'ready' && v.url ? <video src={v.url} controls preload="metadata" className="h-full w-full" /> : v.status === 'processing' ? <div className="text-center text-sm text-slate-500"><Spinner className="mx-auto mb-2 text-gold-500" />Generating…</div> : <p className="p-3 text-center text-xs text-red-400">{v.error ?? 'Failed'}</p>}
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-slate-500">{v.prompt}</p>
            <div className="mt-2 flex items-center justify-between">
              {v.status === 'ready' ? <button className={v.approved ? 'btn-primary px-2 py-1' : 'btn-ghost px-2 py-1'} onClick={() => approve(v)}><Check size={14} />{v.approved ? 'Approved' : 'Approve'}</button> : <Badge kind={v.status === 'failed' ? 'ERROR' : undefined}>{v.status}</Badge>}
              {v.url && v.approved && <a className="text-xs text-gold-500" href={v.url} download>Download</a>}
              <button className="text-red-400" aria-label="Delete" onClick={() => del(v)}><Trash2 size={14} /></button></div>
          </div>))}</div>
      )}
    </>
  );
}
