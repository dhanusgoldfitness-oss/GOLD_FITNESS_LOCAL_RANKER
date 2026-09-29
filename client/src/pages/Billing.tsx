import { useEffect, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, fmtDate, inr, Modal, PageHeader, PageLoading, StatCard, Toggle, useAction, useApi } from '../components/ui';

interface Item { name: string; qty: number; price: number }
interface Inv { id: string; number: string; customer_id: string | null; invoice_date: string; due_date: string | null; items: Item[]; total: number; paid: number; status: string; customers?: { name: string } | null }
const stKind = (s: string) => (s === 'paid' ? 'CONNECTED' : s === 'cancelled' ? 'ERROR' : s === 'draft' ? 'NOT_CONNECTED' : 'API_PENDING');

export function Invoices() {
  const inv = useApi<{ items: Inv[]; summary: { outstanding: number; paidThisMonth: number; drafts: number } }>('/invoices');
  const cust = useApi<{ items: { id: string; name: string }[] }>('/customers');
  const svc = useApi<{ items: { id: string; name: string; price: number }[] }>('/services');
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ customer_id: string; due_date: string; status: string; items: Item[] }>({ customer_id: '', due_date: '', status: 'draft', items: [{ name: '', qty: 1, price: 0 }] });
  const total = f.items.reduce((a, i) => a + i.qty * i.price, 0);
  const setItem = (i: number, p: Partial<Item>) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const save = async () => {
    const body: any = { status: f.status, items: f.items.filter((i) => i.name.trim()), ...(f.customer_id && { customer_id: f.customer_id }), ...(f.due_date && { due_date: f.due_date }) };
    if (!body.items.length) return;
    const r = await run('save', () => api('/invoices', { method: 'POST', body }), 'Invoice created');
    if (r) { setOpen(false); setF({ customer_id: '', due_date: '', status: 'draft', items: [{ name: '', qty: 1, price: 0 }] }); inv.reload(); }
  };
  const mark = async (i: Inv, status: string) => { await run('m' + i.id, () => api(`/invoices/${i.id}`, { method: 'PATCH', body: status === 'paid' ? { status, paid: i.total } : { status } }), 'Updated'); inv.reload(); };
  const del = async (i: Inv) => { if (!confirm('Delete this draft?')) return; await run('d' + i.id, () => api(`/invoices/${i.id}`, { method: 'DELETE' })); inv.reload(); };

  if (inv.loading) return <PageLoading />;
  if (inv.error) return <ErrorBox error={inv.error} onRetry={inv.reload} />;
  const s = inv.data!.summary;
  return (
    <>
      <PageHeader title="Invoices" subtitle="Create invoices for memberships and services." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New invoice</button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label="Outstanding" value={inr(s.outstanding)} /><StatCard label="Paid this month" value={inr(s.paidThisMonth)} /><StatCard label="Drafts" value={s.drafts} /></div>
      {!inv.data!.items.length ? <EmptyState title="No invoices yet" action={<button className="btn-primary" onClick={() => setOpen(true)}>New invoice</button>} /> : (
        <div className="card overflow-x-auto p-0"><table className="w-full min-w-[720px]"><thead><tr className="border-b border-slate-200/10"><th className="th">Number</th><th className="th">Customer</th><th className="th">Date</th><th className="th">Total</th><th className="th">Due</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>{inv.data!.items.map((i) => (
            <tr key={i.id} className="border-b border-slate-200/10 last:border-0"><td className="td font-semibold">{i.number}</td><td className="td">{i.customers?.name ?? 'Cash'}</td><td className="td">{i.invoice_date}</td><td className="td">{inr(i.total)}</td><td className="td">{inr(i.total - i.paid)}</td><td className="td"><Badge kind={stKind(i.status)}>{i.status.replace('_', ' ')}</Badge></td>
              <td className="td whitespace-nowrap text-right">{i.status === 'draft' && <><button className="btn-ghost mr-1 px-2 py-1" onClick={() => mark(i, 'sent')}>Send</button><button className="btn-ghost px-2 py-1 text-red-400" aria-label="Delete" onClick={() => del(i)}><Trash2 size={14} /></button></>}{(i.status === 'sent' || i.status === 'partially_paid') && <button className="btn-ghost px-2 py-1" onClick={() => mark(i, 'paid')} disabled={busy === 'm' + i.id}>Mark paid</button>}</td></tr>))}</tbody></table></div>
      )}
      <p className="mt-3 text-xs text-slate-500">WhatsApp delivery of invoices is <Badge kind="NOT_CONNECTED" /> until the WhatsApp Cloud API phase.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="New invoice" wide>
        <div className="grid gap-3 md:grid-cols-3">
          <div><label className="label">Customer</label><select className="input" value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="">Walk-in / cash</option>{cust.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label">Due date</label><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
          <div><label className="label">Status</label><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="draft">Draft</option><option value="sent">Sent</option></select></div>
        </div>
        <div className="mt-4 space-y-2">{f.items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select className="input col-span-3" aria-label="Pick service" value="" onChange={(e) => { const s = svc.data?.items.find((x) => x.id === e.target.value); if (s) setItem(i, { name: s.name, price: Number(s.price) }); }}><option value="">Service…</option>{svc.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input className="input col-span-4" placeholder="Description" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
            <input className="input col-span-2" type="number" min="1" aria-label="Qty" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} />
            <input className="input col-span-2" type="number" min="0" step="0.01" aria-label="Price" value={it.price} onChange={(e) => setItem(i, { price: Number(e.target.value) })} />
            <button className="col-span-1 text-red-400" aria-label="Remove line" disabled={f.items.length === 1} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
          </div>))}
          <button className="btn-ghost" onClick={() => setF({ ...f, items: [...f.items, { name: '', qty: 1, price: 0 }] })}><Plus size={14} />Add line</button></div>
        <div className="mt-4 flex items-center justify-between"><div className="text-lg font-bold">Total {inr(total)}</div><div className="flex gap-2"><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy === 'save' || total <= 0}>Create invoice</button></div></div>
      </Modal>
    </>
  );
}

export function TallyExport() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [company, setCompany] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const { busy, run } = useAction();
  const qs = () => new URLSearchParams({ from, to, ...(company && { company }) });
  useEffect(() => { let live = true; api<{ invoices: number }>(`/tally-export?${qs()}&preview=1`).then((r) => live && setCount(r.invoices)).catch(() => live && setCount(null)); return () => { live = false; }; /* eslint-disable-next-line */ }, [from, to]);
  const download = () => run('dl', async () => {
    const blob = await api<Blob>(`/tally-export?${qs()}`, { raw: true });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dgf-tally-${from}_${to}.xml`; a.click(); URL.revokeObjectURL(a.href);
  }, 'Export downloaded');
  return (
    <>
      <PageHeader title="Tally Export" subtitle="Download sent/paid invoices as a Tally XML import file (Gateway of Tally → Import Data)." />
      <div className="card max-w-2xl">
        <div className="grid gap-3 sm:grid-cols-2"><div><label className="label">From</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><label className="label">To</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Tally company name (exactly as in Tally)</label><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div></div>
        <div className="mt-4 rounded-xl bg-slate-500/10 p-4 text-sm">Invoices in this file: <b>{count ?? '…'}</b>. Drafts and cancelled invoices are never exported.</div>
        <button className="btn-primary mt-4" onClick={download} disabled={busy === 'dl' || !count}><Download size={16} />Download XML</button>
        <p className="mt-3 text-xs text-slate-500">Sales vouchers only, posted to ledgers “Sales” and the customer name. GST splits are not included in this version.</p>
      </div>
    </>
  );
}

export function BillingSettings() {
  const d = useApi<{ settings: Record<string, any> }>('/billing-settings');
  const { busy, run } = useAction();
  const [f, setF] = useState<Record<string, any>>({});
  useEffect(() => { if (d.data) setF(d.data.settings); }, [d.data]);
  if (d.loading) return <PageLoading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  const text = (k: string, label: string, type = 'text') => <div key={k}><label className="label">{label}</label><input className="input" type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>;
  const save = () => {
    const keys = ['business_type', 'business_name', 'phone', 'email', 'address', 'gstin', 'state', 'invoice_prefix'];
    const body: Record<string, unknown> = { round_total: !!f.round_total };
    for (const k of keys) if (f[k] !== '' && f[k] != null) body[k] = f[k];
    return run('save', () => api('/billing-settings', { method: 'PUT', body }), 'Settings saved');
  };
  return (
    <>
      <PageHeader title="Billing Settings" subtitle="Your business details appear on every invoice you send." />
      <div className="card max-w-3xl">
        <h2 className="mb-3 font-bold">Your business</h2>
        <div className="grid gap-3 md:grid-cols-2">{text('business_name', 'Business name')}{text('business_type', 'Business type')}{text('phone', 'Phone')}{text('email', 'Email', 'email')}{text('gstin', 'GSTIN')}{text('state', 'State (place of supply)')}<div className="md:col-span-2"><label className="label">Address</label><textarea className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></div></div>
        <h2 className="mb-3 mt-6 font-bold">Invoice defaults</h2>
        <div className="grid gap-3 md:grid-cols-2">{text('invoice_prefix', 'Invoice prefix')}<div><label className="label">Next number</label><div className="input opacity-70">{f.next_number ?? 1}</div></div></div>
        <div className="mt-4 flex items-center gap-3"><Toggle label="Round total" checked={!!f.round_total} onChange={(v) => setF({ ...f, round_total: v })} /><span className="text-sm">Round invoice totals to the nearest rupee</span></div>
        <button className="btn-primary mt-6" onClick={save} disabled={busy === 'save'}>Save settings</button>
      </div>
    </>
  );
}
export { fmtDate };
