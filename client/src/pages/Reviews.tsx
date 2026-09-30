import { useState } from 'react';
import { RefreshCw, Sparkles, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, Loc, NoLocations, PageHeader, PageLoading, StatCard, useAction, useApi, useLocations } from '../components/ui';

interface Review { id: string; location_id: string; reviewer_name: string | null; rating: number; comment: string | null; sentiment: 'positive' | 'neutral' | 'negative'; reply_text: string | null; reply_status: 'none' | 'draft' | 'published'; review_time: string | null; business_locations?: { title: string } }
interface Resp { reviews: Review[]; total: number; page: number; stats: { total: number; replied: number; pending: number; avg: number | null } }

const Stars = ({ n }: { n: number }) => <span className="inline-flex" aria-label={`${n} stars`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={14} className={i <= n ? 'fill-gold-500 text-gold-500' : 'text-slate-500/40'} />)}</span>;

export default function Reviews() {
  const L = useLocations();
  const [f, setF] = useState({ rating: '', status: '', sentiment: '', sort: 'recent', q: '', page: 1 });
  const [qApplied, setQApplied] = useState('');
  const qs = new URLSearchParams({ pageSize: '50', sort: f.sort, page: String(f.page), ...(L.selected && { location_id: L.selected }), ...(f.rating && { rating: f.rating }), ...(f.status && { status: f.status }), ...(f.sentiment && { sentiment: f.sentiment }), ...(qApplied && { q: qApplied }) });
  const rv = useApi<Resp>(L.selected ? `/reviews?${qs}` : null, [L.selected]);
  const { busy, run } = useAction();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [gTotal, setGTotal] = useState<number | null>(null);

  if (L.loading) return <PageLoading />;
  if (!L.enabled.length) return <><PageHeader title="Reviews" /><NoLocations /></>;
  const set = (k: string, v: string) => setF({ ...f, [k]: v, page: k === 'page' ? Number(v) : 1 });

  const sync = async () => { await run('sync', async () => { const r = await api<{ fetched: number; googleTotal: number | null }>(`/locations/${L.selected}/reviews/sync`, { method: 'POST', body: {} }); setGTotal(r.googleTotal); return r; }, 'Reviews synced'); rv.reload(); };
  const ai = async (r: Review) => { const x = await run('ai' + r.id, () => api<{ draft: string; requiresManualReview: boolean }>(`/reviews/${r.id}/ai-reply`, { method: 'POST', body: {} })); if (x) { setDrafts({ ...drafts, [r.id]: x.draft }); setEditing(r.id); rv.reload(); } };
  const save = async (r: Review) => { await run('s' + r.id, () => api(`/reviews/${r.id}/draft`, { method: 'PUT', body: { text: drafts[r.id] } }), 'Draft saved'); rv.reload(); };
  const publish = async (r: Review) => { if (!confirm('Publish this reply publicly on Google?')) return; await run('p' + r.id, () => api(`/reviews/${r.id}/publish`, { method: 'POST', body: { text: drafts[r.id] ?? r.reply_text } }), 'Reply published'); setEditing(null); rv.reload(); };
  const del = async (r: Review) => { if (!confirm('Delete this reply?')) return; await run('x' + r.id, () => api(`/reviews/${r.id}/reply`, { method: 'DELETE' }), 'Reply deleted'); rv.reload(); };

  const s = rv.data?.stats;
  const pages = Math.max(1, Math.ceil((rv.data?.total ?? 0) / 50));
  return (
    <>
      <PageHeader title="Review Management" subtitle="Monitor, reply and manage your Google reviews. Every reply needs your approval before publishing." actions={<button className="btn-primary" onClick={sync} disabled={busy === 'sync'}><RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} />Get reviews</button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total reviews" value={s?.total ?? '—'} /><StatCard label="Replied" value={s?.replied ?? '—'} /><StatCard label="Pending" value={s?.pending ?? '—'} /><StatCard label="Avg rating" value={s?.avg ?? '—'} />
      </div>
      {gTotal !== null && s && (
        <div className={`mb-6 rounded-xl p-3 text-sm ${s.total >= gTotal ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
          Google reports <b>{gTotal}</b> reviews for this location; DigiMithra has <b>{s.total}</b>.{s.total < gTotal ? ' Google may hide some reviews from its API (for example reviews it filtered or has not finished processing). Click “Get reviews” again later.' : ' Everything is synced.'}
        </div>
      )}
      <div className="card mb-6 grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2"><label className="label" htmlFor="rloc">Location</label><select id="rloc" className="input" value={L.selected} onChange={(e) => { L.setSelected(e.target.value); setF({ ...f, page: 1 }); }}>{L.enabled.map((l: Loc) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></div>
        <div><label className="label">Stars</label><select className="input" value={f.rating} onChange={(e) => set('rating', e.target.value)}><option value="">All</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select></div>
        <div><label className="label">Reply</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All</option><option value="unreplied">Unreplied</option><option value="replied">Replied</option></select></div>
        <div><label className="label">Sentiment</label><select className="input" value={f.sentiment} onChange={(e) => set('sentiment', e.target.value)}><option value="">All</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></div>
        <div><label className="label">Sort</label><select className="input" value={f.sort} onChange={(e) => set('sort', e.target.value)}><option value="recent">Most recent</option><option value="oldest">Oldest</option><option value="lowest">Lowest rated</option><option value="highest">Highest rated</option></select></div>
        <div className="md:col-span-5"><input className="input" placeholder="Search review text…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && setQApplied(f.q)} aria-label="Search reviews" /></div>
        <button className="btn-ghost" onClick={() => setQApplied(f.q)}>Search</button>
      </div>
      {rv.loading ? <PageLoading /> : rv.error ? <ErrorBox error={rv.error} onRetry={rv.reload} /> : !rv.data?.reviews.length ? <EmptyState title="No reviews" text="Click “Get reviews” to sync from Google, or adjust your filters." /> : (
        <div className="space-y-4">
          {rv.data.reviews.map((r) => {
            const open = editing === r.id || r.reply_status === 'draft';
            const text = drafts[r.id] ?? r.reply_text ?? '';
            return (
              <div key={r.id} className={`card ${r.sentiment === 'negative' ? 'border-red-500/40' : ''}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/20 font-bold text-gold-500">{(r.reviewer_name ?? '?')[0]}</div><div><div className="font-semibold">{r.reviewer_name ?? 'Anonymous'}</div><div className="flex items-center gap-2"><Stars n={r.rating} /><span className="text-xs text-slate-500">{fmtDate(r.review_time)}</span></div></div></div><div className="flex gap-2"><Badge kind={r.sentiment}>{r.sentiment}</Badge>{r.reply_status === 'published' ? <Badge kind="CONNECTED">Replied</Badge> : <Badge kind="API_PENDING">Needs reply</Badge>}</div></div>
                <p className="text-sm">{r.comment || <em className="text-slate-500">(rating only, no text)</em>}</p>
                {r.reply_status === 'published' && editing !== r.id && (
                  <div className="mt-3 rounded-xl bg-slate-500/10 p-3 text-sm"><div className="mb-1 text-xs font-bold uppercase text-slate-500">Owner reply</div>{r.reply_text}<div className="mt-2 flex gap-3 text-xs"><button className="text-gold-500" onClick={() => { setDrafts({ ...drafts, [r.id]: r.reply_text ?? '' }); setEditing(r.id); }}>Edit</button><button className="text-red-400" onClick={() => del(r)}><Trash2 size={12} className="inline" /> Delete</button><button onClick={() => navigator.clipboard.writeText(r.reply_text ?? '')}>Copy</button></div></div>
                )}
                {(r.reply_status !== 'published' || editing === r.id) && (
                  <div className="mt-3">
                    {r.rating <= 2 && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-400">Low rating — review the wording carefully before publishing. AI drafts are never auto-published.</p>}
                    {open ? <><textarea className="input min-h-[90px]" value={text} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} aria-label="Reply draft" />
                      <div className="mt-2 flex flex-wrap gap-2"><button className="btn-primary" disabled={!text.trim() || busy === 'p' + r.id} onClick={() => publish(r)}>Publish</button><button className="btn-ghost" disabled={!text.trim()} onClick={() => save(r)}>Save draft</button><button className="btn-ghost" onClick={() => ai(r)} disabled={busy === 'ai' + r.id}><Sparkles size={14} />Regenerate</button></div></>
                      : <button className="btn-ghost" onClick={() => ai(r)} disabled={busy === 'ai' + r.id}><Sparkles size={14} />{busy === 'ai' + r.id ? 'Writing…' : 'Generate AI reply (1 credit)'}</button>}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm"><button className="btn-ghost" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button><span>Page {f.page} of {pages}</span><button className="btn-ghost" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></div>
        </div>
      )}
    </>
  );
}
