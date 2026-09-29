import { useState } from 'react';
import { Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, LocationPicker, Modal, NoLocations, PageHeader, PageLoading, useAction, useApi, useLocations } from '../components/ui';

interface Post { id: string; location_id: string | null; post_type: 'standard' | 'offer' | 'event'; title: string | null; body: string; image_url: string | null; status: 'draft' | 'scheduled' | 'published' | 'failed'; scheduled_at: string | null; publish_error: string | null; created_at: string }
const kindOf = (s: string) => (s === 'published' ? 'CONNECTED' : s === 'failed' ? 'ERROR' : s === 'scheduled' ? 'CONNECTING' : 'NOT_CONNECTED');

export default function Posts() {
  const L = useLocations();
  const ps = useApi<{ posts: Post[] }>('/posts');
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ post_type: 'standard', title: '', body: '', image_url: '', scheduled_at: '', topic: '' });
  const [filter, setFilter] = useState('all');

  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Google Posts" /><NoLocations /></>;
  const posts = (ps.data?.posts ?? []).filter((p) => p.location_id === L.selected && (filter === 'all' || p.post_type === filter));

  const gen = async () => { const r = await run('gen', () => api<{ text: string }>('/posts/generate', { method: 'POST', body: { location_id: L.selected, topic: form.topic, post_type: form.post_type } })); if (r) setForm({ ...form, body: r.text }); };
  const save = async () => {
    const body: any = { location_id: L.selected, post_type: form.post_type, body: form.body, ...(form.title && { title: form.title }), ...(form.image_url && { image_url: form.image_url }), ...(form.scheduled_at && { scheduled_at: new Date(form.scheduled_at).toISOString() }) };
    const r = await run('save', () => api('/posts', { method: 'POST', body }), form.scheduled_at ? 'Post scheduled' : 'Draft saved');
    if (r) { setOpen(false); setForm({ ...form, title: '', body: '', image_url: '', scheduled_at: '', topic: '' }); ps.reload(); }
  };
  const publish = async (p: Post) => { if (!confirm('Publish this post to Google now?')) return; await run('p' + p.id, () => api(`/posts/${p.id}/publish`, { method: 'POST', body: {} }), 'Published to Google'); ps.reload(); };
  const del = async (p: Post) => { if (!confirm('Delete this post?')) return; await run('x' + p.id, () => api(`/posts/${p.id}`, { method: 'DELETE' })); ps.reload(); };

  return (
    <>
      <PageHeader title="Google Posts" subtitle="Create, schedule and publish posts to your Business Profile." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Add post</button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <div className="flex gap-1">{['all', 'standard', 'offer', 'event'].map((t) => <button key={t} className={filter === t ? 'btn-primary' : 'btn-ghost'} onClick={() => setFilter(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div></div>
      <p className="mb-4 rounded-lg bg-slate-500/10 p-3 text-xs">Scheduled posts are published by the background scheduler (Phase 24). Until it is enabled, use “Publish now”.</p>
      {ps.loading ? <PageLoading /> : ps.error ? <ErrorBox error={ps.error} onRetry={ps.reload} /> : !posts.length ? <EmptyState title="No posts yet" text="Create your first post — AI can draft it for you." /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[720px]"><thead><tr className="border-b border-slate-200/10"><th className="th">Post</th><th className="th">Type</th><th className="th">Status</th><th className="th">Date</th><th className="th" /></tr></thead>
          <tbody>{posts.map((p) => (
            <tr key={p.id} className="border-b border-slate-200/10 last:border-0">
              <td className="td max-w-md"><div className="font-semibold">{p.title || 'Untitled'}</div><div className="line-clamp-2 text-xs text-slate-500">{p.body}</div>{p.publish_error && <div className="text-xs text-red-400">{p.publish_error}</div>}</td>
              <td className="td"><Badge>{p.post_type}</Badge></td><td className="td"><Badge kind={kindOf(p.status)}>{p.status}</Badge></td><td className="td text-xs">{fmtDate(p.scheduled_at ?? p.created_at)}</td>
              <td className="td text-right whitespace-nowrap">{p.status !== 'published' && <><button className="btn-ghost mr-1 px-2 py-1" onClick={() => publish(p)} disabled={busy === 'p' + p.id}><Send size={14} />Publish</button><button className="btn-ghost px-2 py-1 text-red-400" aria-label="Delete post" onClick={() => del(p)}><Trash2 size={14} /></button></>}</td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New post" wide>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">Type</label><select className="input" value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}><option value="standard">Update</option><option value="offer">Offer</option><option value="event">Event</option></select></div>
          <div><label className="label">Title (optional)</label><input className="input" maxLength={58} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label">Topic for AI</label><div className="flex gap-2"><input className="input" placeholder="e.g. New year strength batch starts Monday" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /><button className="btn-ghost shrink-0" disabled={form.topic.trim().length < 3 || busy === 'gen'} onClick={gen}><Sparkles size={14} />{busy === 'gen' ? '…' : 'Generate'}</button></div></div>
          <div className="md:col-span-2"><label className="label">Post text</label><textarea className="input min-h-[120px]" maxLength={1500} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /><div className="text-xs text-slate-500">{form.body.length}/1500</div></div>
          <div><label className="label">Image URL (optional)</label><input className="input" type="url" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></div>
          <div><label className="label">Schedule (optional)</label><input className="input" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={!form.body.trim() || busy === 'save'} onClick={save}>{form.scheduled_at ? 'Schedule' : 'Save draft'}</button></div>
      </Modal>
    </>
  );
}
