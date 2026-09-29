import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader, Spinner, useAction, useLocations } from '../components/ui';

interface Msg { role: 'user' | 'assistant'; text: string }
const IDEAS = ['What should I fix first on my profile?', 'How are my keyword rankings?', 'Do I have unanswered reviews?'];

export default function AiMode() {
  const L = useLocations();
  const { busy, run } = useAction();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', text: t.trim() }];
    setMsgs(next); setText('');
    const r = await run('chat', () => api<{ reply: string }>('/assistant/chat', { method: 'POST', body: { location_id: L.selected || undefined, messages: next.slice(-12) } }));
    setMsgs(r ? [...next, { role: 'assistant', text: r.reply }] : next);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <>
      <PageHeader title="AI Mode" subtitle="Ask about your own profile, rankings and reviews. Answers use your saved data only (1 credit per message)." />
      <div className="card flex h-[65vh] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {!msgs.length && <div className="py-10 text-center text-sm text-slate-500"><p className="mb-3">Try asking:</p><div className="flex flex-wrap justify-center gap-2">{IDEAS.map((i) => <button key={i} className="btn-ghost px-3 py-1" onClick={() => send(i)}>{i}</button>)}</div></div>}
          {msgs.map((m, i) => <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-gold-500 text-ink-950' : 'bg-slate-500/10'}`}>{m.text}</div>)}
          {busy === 'chat' && <div className="text-gold-500"><Spinner /></div>}
          <div ref={end} />
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input className="input" value={text} maxLength={2000} placeholder="Ask anything about your local SEO…" onChange={(e) => setText(e.target.value)} aria-label="Message" />
          <button className="btn-primary" disabled={!text.trim() || busy === 'chat'} aria-label="Send"><Send size={16} /></button>
        </form>
      </div>
    </>
  );
}
