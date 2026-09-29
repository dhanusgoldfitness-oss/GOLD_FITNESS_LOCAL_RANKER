import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, X } from 'lucide-react';
import { api, ApiError, STATUS_LABEL } from '../lib/api';

// ---------- toast ----------
type Toast = { id: number; kind: 'ok' | 'err'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ${t.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}<span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- data hook ----------
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true); setError(null);
    try { const d = await api<T>(path); if (my === seq.current) setData(d); }
    catch (e) { if (my === seq.current) setError(e as ApiError); }
    finally { if (my === seq.current) setLoading(false); }
  }, [path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, loading, reload: load, setData };
}

/** Run an action with loading state + toast on error. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy(key);
    try { const r = await fn(); if (okMsg) toast('ok', okMsg); return r; }
    catch (e) { toast('err', (e as Error).message); return undefined; }
    finally { setBusy(null); }
  }, [toast]);
  return { busy, run };
}

// ---------- primitives ----------
export const Spinner = ({ className = '' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} size={18} />;
export const PageLoading = () => <div className="flex justify-center py-20 text-gold-500"><Spinner className="h-8 w-8" /></div>;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="card flex items-start justify-between">
      <div><div className="label">{label}</div><div className="text-3xl font-bold">{value}</div>{hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}</div>
      {icon && <div className="rounded-xl bg-gold-500/15 p-2 text-gold-500">{icon}</div>}
    </div>
  );
}

const badgeCls: Record<string, string> = {
  CONNECTED: 'bg-emerald-500/15 text-emerald-500', NOT_CONNECTED: 'bg-slate-500/15 text-slate-400', CONNECTING: 'bg-sky-500/15 text-sky-400',
  API_PENDING: 'bg-amber-500/15 text-amber-500', REAUTH_REQUIRED: 'bg-orange-500/15 text-orange-500', ERROR: 'bg-red-500/15 text-red-500', OFFLINE: 'bg-red-500/15 text-red-500',
  positive: 'bg-emerald-500/15 text-emerald-500', neutral: 'bg-slate-500/15 text-slate-400', negative: 'bg-red-500/15 text-red-500',
  high: 'bg-red-500/15 text-red-500', medium: 'bg-amber-500/15 text-amber-500', low: 'bg-sky-500/15 text-sky-400',
};
export const Badge = ({ kind, children }: { kind?: string; children?: ReactNode }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls[kind ?? ''] ?? 'bg-slate-500/15 text-slate-400'}`}>{children ?? STATUS_LABEL[kind ?? ''] ?? kind}</span>
);

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="card flex flex-col items-center py-12 text-center"><Inbox className="mb-3 text-slate-400" size={32} /><div className="font-semibold">{title}</div>{text && <p className="mt-1 max-w-md text-sm text-slate-500">{text}</p>}{action && <div className="mt-4">{action}</div>}</div>;
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const code = (error as ApiError).code;
  const tone = code === 'REAUTH_REQUIRED' || code === 'API_PENDING' ? 'border-amber-500/40 bg-amber-500/10' : 'border-red-500/40 bg-red-500/10';
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm ${tone}`} role="alert">
      <div className="flex items-start gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div>{code && <Badge kind={code} />} <span className="ml-1">{error.message}</span></div></div>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card max-h-[90vh] w-full overflow-y-auto ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-slate-500/20"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-ink-700" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${t.id === value ? 'border-gold-500 text-gold-500' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>{t.label}</button>
      ))}
    </div>
  );
}

export const Toggle = ({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-gold-500' : 'bg-slate-400/40'} disabled:opacity-50`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
);

export const ScoreRing = ({ score, size = 140 }: { score: number; size?: number }) => {
  const r = size / 2 - 10, c = 2 * Math.PI * r, color = score >= 80 ? '#10b981' : score >= 50 ? '#84bd00' : '#ef4444';
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" className="text-slate-500/20" strokeWidth="10" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-extrabold">{score}%</span><span className="text-[10px] uppercase text-slate-500">DigiMithra score</span></div>
    </div>
  );
};

export interface Loc { id: string; title: string; address: string | null; city: string | null; phone: string | null; website: string | null; primary_category: string | null; verified: boolean; enabled: boolean; last_synced_at: string | null; sync_error: string | null }

/** Location dropdown (enabled locations only); persists last choice per session. */
export function useLocations() {
  const { data, error, loading, reload } = useApi<{ locations: Loc[] }>('/locations');
  const enabled = (data?.locations ?? []).filter((l) => l.enabled);
  const [selected, setSelected] = useState<string>(() => sessionStorage.getItem('dgf.loc') ?? '');
  useEffect(() => {
    if (!enabled.length) return;
    if (!enabled.some((l) => l.id === selected)) setSelected(enabled[0].id);
  }, [enabled.map((l) => l.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selected) sessionStorage.setItem('dgf.loc', selected); }, [selected]);
  return { all: data?.locations ?? [], enabled, selected, setSelected, loc: enabled.find((l) => l.id === selected), loading, error, reload };
}

export function LocationPicker({ enabled, selected, setSelected }: { enabled: Loc[]; selected: string; setSelected: (id: string) => void }) {
  return (
    <div className="min-w-[240px] flex-1">
      <label className="label" htmlFor="locpick">Business location</label>
      <select id="locpick" className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
        {enabled.map((l) => <option key={l.id} value={l.id}>{l.title}{l.city ? ` — ${l.city}` : ''}</option>)}
      </select>
    </div>
  );
}

export const NoLocations = () => (
  <EmptyState title="No locations selected" text="Connect your Google account and choose the business locations to manage." action={<a className="btn-primary" href="/google-business">Go to Google Business</a>} />
);

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
