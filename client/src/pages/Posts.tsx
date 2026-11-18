import { useState } from 'react';
import { CalendarClock, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
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
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState({ weeks: 4, weekday: 1, time: '10:00', post_type: 'standard', topics: '' });
  const DEFAULT_TOPICS = ['A helpful tip related to our services', 'Spotlight one of our services and what makes it special', 'Invite new customers to visit us this week', 'Share a friendly update and thank our customers'];
  const makePlan = async () => {
    const topics = plan.topics.split('\n').map((t) => t.trim()).filter((t) => t.length >= 3);
    const pool = topics.length ? topics : DEFAULT_TOPICS;
    const [hh, mm] = plan.time.split(':').map(Number);
    const first = new Date(); first.setHours(hh || 0, mm || 0, 0, 0);
    first.setDate(first.getDate() + ((plan.weekday - first.getDay() + 7) % 7));
    if (first.getTime() < Date.now() + 5 * 60_000) first.setDate(first.getDate() + 7);
    const slots = Array.from({ length: plan.weeks }, (_, i) => { const d = new Date(first); d.setDate(d.getDate() + 7 * i); return { scheduled_at: d.toISOString(), topic: pool[i % pool.length] }; });
    const r = await run('plan', () => api<{ created: number; errors: string[] }>('/posts/plan', { method: 'POST', body: { location_id: L.selected, post_type: plan.post_type, slots } }));
    if (r) { setPlanOpen(false); ps.reload(); if (r.errors.length) alert(`${r.created} scheduled. ${r.errors[0]}`); }
  };

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
      <PageHeader title="Google Posts" subtitle="Create, schedule and publish posts to your Business Profile." actions={<div className="flex gap-2"><button className="btn-ghost" onClick={() => setPlanOpen(true)}><CalendarClock size={16} />Plan weekly posts</button><button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Add post</button></div>} />
      <div className="mb-4 flex flex-wrap items-end gap-3"><LocationPicker enabled={L.enabled} selected={L.selected} setSelected={L.setSelected} />
        <div className="flex gap-1">{['all', 'standard', 'offer', 'event'].map((t) => <button key={t} className={filter === t ? 'btn-primary' : 'btn-ghost'} onClick={() => setFilter(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div></div>
      <p className="mb-4 rounded-lg bg-slate-500/10 p-3 text-xs">Scheduled posts are published automatically by the background scheduler within about a minute of their time. Use “Plan weekly posts” to keep a steady posting rhythm, which Google rewards.</p>
      {ps.loading ? <PageLoading /> : ps.error ? <ErrorBox error={ps.error} onRetry={ps.reload} /> : !posts.length ? <EmptyState title="No posts yet" text="Create your first post — AI can draft it for you." /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[720px]"><thead><tr className="border-b border-slate-200/10"><th className="th">Post</th><th className="th">Type</th><th className="th">Status</th><th className="th">Date</th><th className="th" /></tr></thead>
          <tbody>{posts.map((p) => (
            <tr key={p.id} className="border-b border-slate-200/10 last:border-0">
              <td className="td max-w-md"><div className="font-semibold">{p.title || 'Untitled'}</div><div className="line-clamp-2 text-xs text-slate-500">{p.body}</div>{p.publish_error && <div className="text-xs text-red-400">{p.publish_error}</div>}</td>
              <td className="td"><Badge>{p.post_type}</Badge></td><td className="td"><Badge kind={kindOf(p.status)}>{p.status}</Badge></td><td className="td text-xs">{fmtDate(p.scheduled_at ?? p.created_at)}</td>
              <td className="td text-right whitespace-nowrap">{p.status !== 'published' && <><button className="btn-ghost mr-1 px-2 py-1" onClick={() => publish(p)} disabled={busy === 'p' + p.id}><Send size={14} />Publish</button><button className="btn-ghost px-2 py-1 text-red-400" aria-label="Delete post" onClick={() => del(p)}><Trash2 size={14} /></button></>}</td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="Plan weekly posts">
        <p className="mb-3 text-sm text-slate-500">AI drafts one post per week and schedules it. Each draft uses 1 credit. You can edit or delete any scheduled post in the list afterwards.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">How many weeks</label><select className="input" value={plan.weeks} onChange={(e) => setPlan({ ...plan, weeks: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'week' : 'weeks'}</option>)}</select></div>
          <div><label className="label">Post type</label><select className="input" value={plan.post_type} onChange={(e) => setPlan({ ...plan, post_type: e.target.value })}><option value="standard">Update</option><option value="offer">Offer</option><option value="event">Event</option></select></div>
          <div><label className="label">Day of week</label><select className="input" value={plan.weekday} onChange={(e) => setPlan({ ...plan, weekday: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
          <div><label className="label">Time</label><input className="input" type="time" value={plan.time} onChange={(e) => setPlan({ ...plan, time: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label">Topics (optional, one per line)</label><textarea className="input min-h-[90px]" placeholder={'New batch starts Monday\nMeet our trainers\nFree trial week'} value={plan.topics} onChange={(e) => setPlan({ ...plan, topics: e.target.value })} /><div className="text-xs text-slate-500">Leave empty and AI picks general topics. Topics repeat in order if you give fewer than the number of weeks.</div></div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setPlanOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy === 'plan'} onClick={makePlan}>{busy === 'plan' ? 'Planning…' : `Schedule ${plan.weeks} ${plan.weeks === 1 ? 'post' : 'posts'}`}</button></div>
      </Modal>
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
