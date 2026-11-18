import { useState } from 'react';
import { Check, Copy, ExternalLink, Send, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { askConfirm } from '../lib/confirm';
import { useAuth } from '../lib/auth';
import { Badge, EmptyState, ErrorBox, LocationPicker, NoLocations, PageHeader, PageLoading, useAction, useApi, useLocations, useToast } from '../components/ui';

interface P { id: string; topic: string; platform: 'instagram' | 'facebook' | 'x' | 'whatsapp'; caption: string; hashtags: string[]; status: 'draft' | 'posted'; image_url: string | null; publish_error: string | null }
const ALL = ['instagram', 'facebook', 'x', 'whatsapp'] as const;
const text = (p: P) => (p.caption + (p.hashtags.length ? '\n\n' + p.hashtags.map((h) => '#' + h).join(' ') : '')).trim();
const share = (p: P) => {
  const t = encodeURIComponent(text(p));
  return p.platform === 'x' ? `https://twitter.com/intent/tweet?text=${t}` : p.platform === 'whatsapp' ? `https://wa.me/?text=${t}` : p.platform === 'facebook' ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}&quote=${t}` : null;
};

export default function Social() {
  const { profile, refreshProfile } = useAuth();
  const L = useLocations();
  const toast = useToast();
  const d = useApi<{ posts: P[] }>('/social');
  const mods = useApi<{ instagram?: { status: string }; facebook?: { status: string } }>('/modules/status');
  const [img, setImg] = useState<Record<string, string>>({});
  const live = (pl: string) => (pl === 'instagram' ? mods.data?.instagram?.status === 'CONNECTED' : pl === 'facebook' ? mods.data?.facebook?.status === 'CONNECTED' : false);
  const { busy, run } = useAction();
  const [topic, setTopic] = useState('');
  const [plats, setPlats] = useState<string[]>([...ALL]);
  const [edit, setEdit] = useState<Record<string, string>>({});

  if (L.loading) return <PageLoading />;
  const gen = async () => { const r = await run('gen', () => api('/social/generate', { method: 'POST', body: { topic, platforms: plats, ...(L.selected && { location_id: L.selected }) } }), 'Drafts created'); if (r) { setTopic(''); d.reload(); refreshProfile(); } };
  const copy = async (p: P) => { await navigator.clipboard.writeText(text(p)); toast('ok', 'Copied'); };
  const save = async (p: P) => { await run('s' + p.id, () => api(`/social/${p.id}`, { method: 'PATCH', body: { caption: edit[p.id] } }), 'Saved'); setEdit(({ [p.id]: _, ...r }) => r); d.reload(); };
  const posted = async (p: P) => { await run('p' + p.id, () => api(`/social/${p.id}`, { method: 'PATCH', body: { status: p.status === 'posted' ? 'draft' : 'posted' } })); d.reload(); };
  const publish = async (p: P) => {
    if (!(await askConfirm(`Post this to your ${p.platform === 'instagram' ? 'Instagram account' : 'Facebook Page'} now?`, 'Yes, post it'))) return;
    const image_url = (img[p.id] ?? p.image_url ?? '').trim();
    await run('u' + p.id, () => api(`/social/${p.id}/publish`, { method: 'POST', body: image_url ? { image_url } : {} }), 'Published');
    d.reload();
  };
  const del = async (p: P) => { if (!(await askConfirm('Delete this draft?'))) return; await run('x' + p.id, () => api(`/social/${p.id}`, { method: 'DELETE' })); d.reload(); };

  return (
    <>
      <PageHeader title="Social Post" subtitle="AI-written drafts for each platform. Copy or open the platform to post, or publish straight to Instagram and Facebook once they are connected on the server." actions={<Badge>{profile?.ai_credits ?? 0} credits left</Badge>} />
      <div className="card mb-6">
        {L.enabled.length > 0 ? <div className="mb-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} /></div> : <NoLocations />}
        <label className="label" htmlFor="st">What is the post about?</label>
        <textarea id="st" className="input min-h-[70px]" maxLength={400} placeholder="e.g. New 6am strength batch starting Monday" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-2">{ALL.map((p) => <button key={p} className={plats.includes(p) ? 'btn-primary px-3 py-1 capitalize' : 'btn-ghost px-3 py-1 capitalize'} onClick={() => setPlats((s) => s.includes(p) ? s.filter((x) => x !== p) : [...s, p])}>{p}</button>)}
          <button className="btn-primary ml-auto" onClick={gen} disabled={busy === 'gen' || topic.trim().length < 3 || !plats.length}><Sparkles size={16} />{busy === 'gen' ? 'Writing…' : 'Generate (1 credit)'}</button></div>
      </div>
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !d.data?.posts.length ? <EmptyState title="No drafts yet" text="Generate drafts above. Review and edit them before posting." /> : (
        <div className="grid gap-4 md:grid-cols-2">{d.data.posts.map((p) => (
          <div key={p.id} className="card">
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-bold capitalize">{p.platform}</span><Badge kind={p.status === 'posted' ? 'CONNECTED' : undefined}>{p.status}</Badge></div>
            <textarea className="input min-h-[110px]" value={edit[p.id] ?? p.caption} maxLength={1000} onChange={(e) => setEdit((s) => ({ ...s, [p.id]: e.target.value }))} aria-label="Caption" />
            {!!p.hashtags.length && <p className="mt-1 text-xs text-gold-500">{p.hashtags.map((h) => '#' + h).join(' ')}</p>}
            <p className="mt-1 text-[11px] text-slate-500">Topic: {p.topic}</p>
            {(p.platform === 'instagram' || p.platform === 'facebook') && p.status !== 'posted' && (live(p.platform)
              ? <input className="input mt-2" type="url" placeholder={p.platform === 'instagram' ? 'Public image link (required, JPEG or PNG)' : 'Public image link (optional)'} value={img[p.id] ?? p.image_url ?? ''} onChange={(e) => setImg((m) => ({ ...m, [p.id]: e.target.value }))} aria-label="Image link" />
              : <p className="mt-2 text-[11px] text-slate-500">Direct publishing is not connected for {p.platform} yet. Copy the text instead.</p>)}
            {p.publish_error && p.status !== 'posted' && <p className="mt-1 text-xs text-red-400">{p.publish_error}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {edit[p.id] !== undefined && edit[p.id] !== p.caption && <button className="btn-primary px-2 py-1" onClick={() => save(p)}>Save edit</button>}
              {p.status !== 'posted' && live(p.platform) && <button className="btn-primary px-2 py-1" disabled={busy === 'u' + p.id} onClick={() => publish(p)}><Send size={14} />{busy === 'u' + p.id ? 'Posting…' : 'Publish'}</button>}
              <button className="btn-ghost px-2 py-1" onClick={() => copy(p)}><Copy size={14} />Copy</button>
              {share(p) && <a className="btn-ghost px-2 py-1" href={share(p)!} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open</a>}
              <button className="btn-ghost px-2 py-1" onClick={() => posted(p)}><Check size={14} />{p.status === 'posted' ? 'Mark as draft' : 'Mark posted'}</button>
              <button className="ml-auto text-red-400" aria-label="Delete" onClick={() => del(p)}><Trash2 size={14} /></button></div>
          </div>))}</div>
      )}
    </>
  );
}
