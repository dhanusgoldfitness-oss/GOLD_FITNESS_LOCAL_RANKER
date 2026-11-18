import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquarePlus, Search, Send } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, PageHeader, PageLoading, useAction, useApi } from '../components/ui';

interface Conv { number: string; name: string | null; last_body: string; last_at: string; last_direction: string; unread: number }
interface Msg { id: string; direction: 'in' | 'out'; body: string; status: string; error: string | null; created_at: string }
interface Thread { number: string; name: string | null; lead_id: string | null; messages: Msg[]; window_open: boolean; window_ends_at: string | null }
interface Tpl { name: string; language: string; category: string; body: string; params: number }

const QUICK = [
  'Thanks for contacting us! How can we help you today?',
  'Could you please share your name and what you are looking for?',
  'We will get back to you shortly.',
  'Thank you! Please let us know if you need anything else.',
];
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? 'Today' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const pretty = (n: string) => (n.length === 12 && n.startsWith('91') ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : `+${n}`);
const tick = (m: Msg) => (m.status === 'failed' ? '!' : m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : m.status === 'sent' ? '✓' : '…');

export default function WhatsApp() {
  const st = useApi<{ status: string; note: string; webhookSecret: boolean }>('/whatsapp/status');
  const { busy, run } = useAction();
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [convErr, setConvErr] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [q, setQ] = useState('');
  const [newNum, setNewNum] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [tpls, setTpls] = useState<{ list: Tpl[]; note: string | null } | null>(null);
  const [tplName, setTplName] = useState(''); const [tplLang, setTplLang] = useState('en_US'); const [tplParams, setTplParams] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    try { const r = await api<{ conversations: Conv[] }>('/whatsapp/conversations'); setConvs(r.conversations); setConvErr(null); } catch (e) { setConvErr(e); }
  }, []);
  const loadThread = useCallback(async (n: string) => {
    try { const r = await api<Thread>(`/whatsapp/thread/${n}`); setThread((cur) => (cur && cur.number !== r.number ? cur : r)); } catch { /* keep showing what we have */ }
  }, []);

  useEffect(() => { loadConvs(); const t = setInterval(loadConvs, 15000); return () => clearInterval(t); }, [loadConvs]);
  useEffect(() => {
    if (!sel) { setThread(null); return; }
    setThread(null); loadThread(sel);
    const t = setInterval(() => loadThread(sel), 8000);
    return () => clearInterval(t);
  }, [sel, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length, sel]);
  useEffect(() => {
    if (thread && !thread.window_open && !tpls) api<{ templates: Tpl[]; note: string | null }>('/whatsapp/templates').then((r) => setTpls({ list: r.templates, note: r.note })).catch(() => setTpls({ list: [], note: null }));
  }, [thread, tpls]);

  if (st.loading) return <PageLoading />;

  const open = (n: string) => { setSel(n); setNewNum(null); setText(''); setTplName(''); setTplParams([]); };
  const startNew = () => {
    const d = (newNum ?? '').replace(/\D/g, '');
    const n = d.length === 10 ? '91' + d : d;
    if (n.length < 11 || n.length > 15) return;
    open(n);
  };
  const afterSend = async () => { await loadThread(sel!); await loadConvs(); };
  const send = async (body = text) => {
    if (!body.trim() || !sel) return;
    const r = await run('send', () => api('/whatsapp/send', { method: 'POST', body: { to: sel, message: body.trim() } }));
    if (r) setText('');
    await afterSend();
  };
  const pickTpl = (name: string) => {
    setTplName(name);
    const t = tpls?.list.find((x) => x.name === name);
    if (t) { setTplLang(t.language); setTplParams(Array.from({ length: t.params }, () => '')); }
  };
  const sendTpl = async () => {
    if (!tplName.trim() || !sel) return;
    const r = await run('tpl', () => api('/whatsapp/send-template', { method: 'POST', body: { to: sel, name: tplName.trim(), language: tplLang.trim() || 'en_US', params: tplParams.map((p) => p.trim()).filter(Boolean) } }), 'Template sent');
    if (r) { setTplParams((p) => p.map(() => '')); }
    await afterSend();
  };

  const list = (convs ?? []).filter((c) => !q.trim() || (c.name ?? '').toLowerCase().includes(q.toLowerCase()) || c.number.includes(q.replace(/\D/g, '') || '§'));
  const selConv = convs?.find((c) => c.number === sel);
  const chosenTpl = tpls?.list.find((x) => x.name === tplName);

  return (
    <>
      <PageHeader title="WhatsApp Inbox" subtitle="Read and reply to customer messages in one place." />
      {st.error ? <ErrorBox error={st.error} onRetry={st.reload} /> : (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><Badge kind={st.data!.status} /><span className="text-slate-500">{st.data!.note}</span>
          {!st.data!.webhookSecret && <span className="text-amber-500">Incoming messages need WHATSAPP_APP_SECRET and the webhook URL <code>/api/webhooks/whatsapp</code> set in Meta.</span>}</div>
      )}
      <div className="grid h-[calc(100vh-15rem)] min-h-[460px] gap-4 md:grid-cols-[320px_1fr]">
        {/* conversations */}
        <div className={`card flex min-h-0 flex-col p-0 ${sel ? 'hidden md:flex' : 'flex'}`}>
          <div className="space-y-2 border-b border-slate-200/10 p-3">
            <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-8" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" /></div>
            {newNum === null
              ? <button className="btn-ghost w-full justify-center" onClick={() => setNewNum('')}><MessageSquarePlus size={16} />New chat</button>
              : <div className="flex gap-2"><input className="input" inputMode="tel" autoFocus placeholder="98450 12345" value={newNum} onChange={(e) => setNewNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startNew()} /><button className="btn-primary px-3" onClick={startNew}>Go</button></div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {convErr ? <div className="p-3"><ErrorBox error={convErr} onRetry={loadConvs} /></div>
              : convs === null ? <PageLoading />
              : !list.length ? <div className="p-6 text-center text-sm text-slate-500">{convs.length ? 'No chats match.' : 'No conversations yet. Messages sent to your WhatsApp number appear here, or start a New chat.'}</div>
              : list.map((c) => (
                <button key={c.number} onClick={() => open(c.number)} className={`flex w-full items-center gap-3 border-b border-slate-200/10 px-3 py-3 text-left hover:bg-slate-500/10 ${sel === c.number ? 'bg-gold-500/10' : ''}`}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-500 font-bold text-ink-950">{(c.name ?? '#')[0].toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{c.name ?? pretty(c.number)}</span><span className="shrink-0 text-[10px] text-slate-500">{dayLabel(c.last_at) === 'Today' ? hhmm(c.last_at) : dayLabel(c.last_at)}</span></div>
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-500">{c.last_direction === 'out' ? 'You: ' : ''}{c.last_body}</span>{c.unread > 0 && <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}</div>
                  </div>
                </button>))}
          </div>
        </div>

        {/* chat */}
        <div className={`card flex min-h-0 flex-col p-0 ${sel ? 'flex' : 'hidden md:flex'}`}>
          {!sel ? <div className="m-auto p-6"><EmptyState title="Select a chat" text="Pick a conversation on the left, or start a New chat with a phone number." /></div> : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200/10 p-3">
                <button className="md:hidden" aria-label="Back to chats" onClick={() => setSel(null)}><ArrowLeft size={20} /></button>
                <div className="min-w-0 flex-1"><div className="truncate font-bold">{thread?.name ?? selConv?.name ?? pretty(sel)}</div><div className="text-xs text-slate-500">{pretty(sel)}</div></div>
                {thread && (thread.window_open
                  ? <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-500">Reply window open until {hhmm(thread.window_ends_at!)}</span>
                  : <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-500">24h window closed: use a template</span>)}
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
                {!thread ? <PageLoading /> : !thread.messages.length ? <p className="p-6 text-center text-sm text-slate-500">No messages yet. Send a template to start the conversation.</p>
                  : thread.messages.map((m, i) => {
                    const prev = thread.messages[i - 1];
                    const mine = m.direction === 'out';
                    return (
                      <div key={m.id}>
                        {(!prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)) && <div className="my-2 text-center text-[11px] text-slate-500">{dayLabel(m.created_at)}</div>}
                        <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-gold-500/20' : 'bg-slate-500/15'}`}>
                            {m.body}
                            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">{hhmm(m.created_at)}{mine && <span className={m.status === 'read' ? 'text-sky-400' : m.status === 'failed' ? 'font-bold text-red-400' : ''}>{tick(m)}</span>}</div>
                            {m.status === 'failed' && m.error && <div className="text-[11px] text-red-400">{m.error}</div>}
                          </div>
                        </div>
                      </div>);
                  })}
                <div ref={endRef} />
              </div>
              {thread && (
                <div className="border-t border-slate-200/10 p-3">
                  {thread.window_open ? (
                    <>
                      <div className="mb-2 flex flex-wrap gap-1">{QUICK.map((qr) => <button key={qr} className="btn-ghost px-2 py-1 text-xs" onClick={() => setText(qr)}>{qr.length > 34 ? qr.slice(0, 32) + '…' : qr}</button>)}</div>
                      <div className="flex gap-2">
                        <textarea className="input min-h-[44px] flex-1" rows={2} maxLength={1000} placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message" />
                        <button className="btn-primary self-end" disabled={!text.trim() || busy === 'send'} onClick={() => send()}><Send size={16} />Send</button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500">WhatsApp only allows free text within 24 hours of the customer's last message. Send an approved template to start or restart the chat.</p>
                      <div className="grid gap-2 md:grid-cols-[1fr_110px]">
                        {tpls?.list.length
                          ? <select className="input" value={tplName} onChange={(e) => pickTpl(e.target.value)} aria-label="Template"><option value="">Choose a template…</option>{tpls.list.map((t) => <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>)}</select>
                          : <input className="input" placeholder="Template name, e.g. hello_world" value={tplName} onChange={(e) => setTplName(e.target.value.trim())} aria-label="Template name" />}
                        <input className="input" placeholder="en_US" value={tplLang} onChange={(e) => setTplLang(e.target.value)} aria-label="Language code" />
                      </div>
                      {chosenTpl && <div className="rounded-lg bg-slate-500/10 p-2 text-xs">{chosenTpl.body}</div>}
                      {tplParams.map((p, i) => <input key={i} className="input" placeholder={`Value for {{${i + 1}}}`} value={p} onChange={(e) => setTplParams(tplParams.map((x, j) => (j === i ? e.target.value : x)))} />)}
                      {!tpls?.list.length && tpls?.note && <p className="text-[11px] text-slate-500">{tpls.note}</p>}
                      <button className="btn-primary" disabled={!tplName.trim() || busy === 'tpl'} onClick={sendTpl}><Send size={16} />{busy === 'tpl' ? 'Sending…' : 'Send template'}</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
