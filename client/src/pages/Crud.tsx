import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, inr, Modal, PageHeader, PageLoading, useAction, useApi } from '../components/ui';

interface Field { key: string; label: string; type?: 'text' | 'number' | 'date' | 'email' | 'select'; options?: string[]; required?: boolean }
interface Col { key: string; label: string; render?: (row: any) => React.ReactNode }

function CrudPage({ title, subtitle, path, singular, fields, cols, initial }: { title: string; subtitle: string; path: string; singular: string; fields: Field[]; cols: Col[]; initial?: Record<string, unknown> }) {
  const d = useApi<{ items: any[] }>(`/${path}`);
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [q, setQ] = useState('');

  const blank = () => Object.fromEntries(fields.map((f) => [f.key, initial?.[f.key] ?? (f.type === 'select' ? f.options![0] : '')]));
  const startNew = () => { setEditId(null); setForm(blank()); setOpen(true); };
  const startEdit = (r: any) => { setEditId(r.id); setForm(Object.fromEntries(fields.map((f) => [f.key, r[f.key] ?? '']))); setOpen(true); };
  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const f of fields) { const v = form[f.key]; if (v === '' || v == null) { if (f.required) return; continue; } body[f.key] = f.type === 'number' ? Number(v) : v; }
    const r = await run('save', () => api(editId ? `/${path}/${editId}` : `/${path}`, { method: editId ? 'PATCH' : 'POST', body }), `${singular} saved`);
    if (r) { setOpen(false); d.reload(); }
  };
  const del = async (id: string) => { if (!confirm(`Delete this ${singular.toLowerCase()}?`)) return; await run('del' + id, () => api(`/${path}/${id}`, { method: 'DELETE' }), 'Deleted'); d.reload(); };

  const rows = (d.data?.items ?? []).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<button className="btn-primary" onClick={startNew}><Plus size={16} />Add {singular.toLowerCase()}</button>} />
      {d.loading ? <PageLoading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !d.data?.items.length ? <EmptyState title={`No ${title.toLowerCase()} yet`} action={<button className="btn-primary" onClick={startNew}>Add {singular.toLowerCase()}</button>} /> : (
        <div className="card p-0">
          <div className="p-3"><input className="input max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr className="border-y border-slate-200/10">{cols.map((c) => <th key={c.key} className="th">{c.label}</th>)}<th className="th" /></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-slate-200/10 last:border-0">{cols.map((c) => <td key={c.key} className="td">{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}
              <td className="td whitespace-nowrap text-right"><button className="btn-ghost mr-1 px-2 py-1" aria-label="Edit" onClick={() => startEdit(r)}><Pencil size={14} /></button><button className="btn-ghost px-2 py-1 text-red-400" aria-label="Delete" onClick={() => del(r.id)} disabled={busy === 'del' + r.id}><Trash2 size={14} /></button></td></tr>)}
              {!rows.length && <tr><td className="td text-center text-slate-500" colSpan={cols.length + 1}>No matches.</td></tr>}</tbody></table></div>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`${editId ? 'Edit' : 'Add'} ${singular.toLowerCase()}`}>
        <div className="space-y-3">{fields.map((f) => (
          <div key={f.key}><label className="label">{f.label}{f.required && ' *'}</label>
            {f.type === 'select' ? <select className="input" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="input" type={f.type ?? 'text'} step={f.type === 'number' ? '0.01' : undefined} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}</div>))}</div>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy === 'save'}>Save</button></div>
      </Modal>
    </>
  );
}

export const Customers = () => <CrudPage title="Customers" subtitle="The people and businesses you invoice." path="customers" singular="Customer"
  fields={[{ key: 'name', label: 'Name', required: true }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] }]}
  cols={[{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'status', label: 'Status', render: (r) => <Badge kind={r.status === 'active' ? 'CONNECTED' : 'NOT_CONNECTED'}>{r.status}</Badge> }]} />;

export const Services = () => <CrudPage title="Services" subtitle="Everything you sell — memberships, training, packages." path="services" singular="Service"
  fields={[{ key: 'name', label: 'Name', required: true }, { key: 'category', label: 'Category' }, { key: 'price', label: 'Price (₹)', type: 'number', required: true }, { key: 'unit', label: 'Unit' }, { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] }]}
  cols={[{ key: 'name', label: 'Name' }, { key: 'category', label: 'Category' }, { key: 'price', label: 'Price', render: (r) => inr(r.price) }, { key: 'unit', label: 'Unit' }, { key: 'status', label: 'Status', render: (r) => <Badge kind={r.status === 'active' ? 'CONNECTED' : 'NOT_CONNECTED'}>{r.status}</Badge> }]} />;

export const Categories = () => <CrudPage title="Categories" subtitle="How your services are grouped." path="categories" singular="Category"
  fields={[{ key: 'name', label: 'Name', required: true }]} cols={[{ key: 'name', label: 'Name' }]} />;

export const Expenses = () => <CrudPage title="Expenses" subtitle="Money going out — rent, equipment, salaries, utilities." path="expenses" singular="Expense"
  initial={{ expense_date: new Date().toISOString().slice(0, 10) }}
  fields={[{ key: 'expense_date', label: 'Date', type: 'date', required: true }, { key: 'title', label: 'Expense', required: true }, { key: 'category', label: 'Category' }, { key: 'method', label: 'Method', type: 'select', options: ['Cash', 'UPI', 'Card', 'Bank transfer'] }, { key: 'amount', label: 'Amount (₹)', type: 'number', required: true }]}
  cols={[{ key: 'expense_date', label: 'Date' }, { key: 'title', label: 'Expense' }, { key: 'category', label: 'Category' }, { key: 'method', label: 'Method' }, { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) }]} />;
