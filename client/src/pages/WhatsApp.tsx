import { useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, PageHeader, PageLoading, useAction, useApi } from '../components/ui';

export default function WhatsApp() {
  const st = useApi<{ status: string; note: string; webhookSecret: boolean }>('/whatsapp/status');
  const ms = useApi<{ messages: { id: string; direction: string; to_number: string | null; from_number: string | null; body: string; status: string; error: string | null; created_at: string }[] }>('/whatsapp/messages');
  const { busy, run } = useAction();
  const [to, setTo] = useState(''); const [msg, setMsg] = useState('');
  const send = async () => { await run('send', () => api('/whatsapp/send', { method: 'POST', body: { to, message: msg } }), 'Message sent'); ms.reload(); setMsg(''); };
  if (st.loading) return <PageLoading />;
  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Gym communication through the WhatsApp Cloud API. Access tokens stay on the server." />
      {st.error ? <ErrorBox error={st.error} onRetry={st.reload} /> : <div className="card mb-6"><div className="flex items-center gap-3"><Badge kind={st.data!.status} /><span className="text-sm">{st.data!.note}</span></div>
        <p className="mt-2 text-xs text-slate-500">Webhook URL: <code>/api/webhooks/whatsapp</code> · signature verification {st.data!.webhookSecret ? 'enabled' : <b>disabled — set WHATSAPP_APP_SECRET (webhook rejects unsigned events)</b>}.</p></div>}
      <div className="card mb-6 grid gap-3 md:grid-cols-4"><div><label className="label">To (phone)</label><input className="input" inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="98450 12345" /></div><div className="md:col-span-3"><label className="label">Message</label><div className="flex gap-2"><input className="input" value={msg} maxLength={1000} onChange={(e) => setMsg(e.target.value)} /><button className="btn-primary" disabled={busy === 'send' || to.replace(/\D/g, '').length < 10 || !msg.trim()} onClick={send}><Send size={16} />Send</button></div></div></div>
      <h2 className="mb-2 font-bold">Message log</h2>
      {ms.loading ? <PageLoading /> : !ms.data?.messages.length ? <EmptyState title="No messages yet" /> : <div className="card overflow-x-auto p-0"><table className="w-full min-w-[560px]"><tbody>{ms.data.messages.map((m) => <tr key={m.id} className="border-b border-slate-200/10 last:border-0"><td className="td text-xs">{m.direction === 'out' ? '→ ' + m.to_number : '← ' + m.from_number}</td><td className="td max-w-xs truncate">{m.body}</td><td className="td"><Badge kind={m.status === 'failed' ? 'ERROR' : m.status === 'read' || m.status === 'delivered' ? 'CONNECTED' : 'NOT_CONNECTED'}>{m.status}</Badge>{m.error && <div className="text-xs text-red-400">{m.error}</div>}</td><td className="td text-xs text-slate-500">{fmtDate(m.created_at)}</td></tr>)}</tbody></table></div>}
    </>
  );
}
