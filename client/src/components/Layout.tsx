import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, ChevronDown, CreditCard, FileText, Gauge, Gem, Image as ImageIcon, LayoutDashboard, LogOut, Map, Menu, MessageSquare,
  Moon, Package, Receipt, Search, Settings, Share2, Sparkles, Star, Sun, Tags, Target, Trophy, TrendingUp, Users, Video, Wallet, Wand2, X, FileBarChart, Building2, Send, Key,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, STATUS_LABEL } from '../lib/api';
import { Badge, fmtDate, useApi } from './ui';

interface NavItem { to: string; label: string; icon: JSX.Element }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Account', items: [
    { to: '/plan', label: 'Manage Plan', icon: <Gem size={16} /> },
    { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> } ] },
  { group: 'Google', items: [
    { to: '/google-business', label: 'Google Business', icon: <Building2 size={16} /> },
    { to: '/optimization', label: 'One-Click Optimization', icon: <Wand2 size={16} /> },
    { to: '/audit', label: 'Google Audit', icon: <Gauge size={16} /> },
    { to: '/posts', label: 'Google Posts', icon: <Send size={16} /> },
    { to: '/reviews', label: 'Reviews', icon: <Star size={16} /> },
    { to: '/photos', label: 'Photos & Videos', icon: <ImageIcon size={16} /> } ] },
  { group: 'Content & AI', items: [
    { to: '/ai-mode', label: 'AI Mode', icon: <Sparkles size={16} /> },
    { to: '/ai-images', label: 'AI Images', icon: <ImageIcon size={16} /> },
    { to: '/ai-video', label: 'AI Video', icon: <Video size={16} /> },
    { to: '/social', label: 'Social Post', icon: <Share2 size={16} /> } ] },
  { group: 'Insights', items: [
    { to: '/rank-checker', label: 'Local Rank Checker', icon: <Map size={16} /> },
    { to: '/keywords', label: 'Keyword Suggestion', icon: <Key size={16} /> },
    { to: '/competitors', label: 'Competitor Analysis', icon: <Trophy size={16} /> },
    { to: '/reports', label: 'Reports', icon: <FileBarChart size={16} /> } ] },
  { group: 'Billing', items: [
    { to: '/invoices', label: 'Invoices', icon: <Receipt size={16} /> },
    { to: '/customers', label: 'Customers', icon: <Users size={16} /> },
    { to: '/services', label: 'Services', icon: <Package size={16} /> },
    { to: '/categories', label: 'Categories', icon: <Tags size={16} /> },
    { to: '/expenses', label: 'Expenses', icon: <Wallet size={16} /> },
    { to: '/tally-export', label: 'Tally Export', icon: <FileText size={16} /> },
    { to: '/billing-settings', label: 'Billing Settings', icon: <CreditCard size={16} /> } ] },
  { group: 'Configuration', items: [{ to: '/settings', label: 'Settings', icon: <Settings size={16} /> }] },
];

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <div className="leading-tight"><div className="text-sm font-extrabold tracking-wide">DGF <span className="text-gold-500">Local Ranker</span></div><div className="text-[10px] text-slate-500">Dhanus Gold Fitness</div></div>
    </div>
  );
}

function useTheme() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('dgf.theme') !== 'light'; } catch { return true; } });
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem('dgf.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ } }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}
export function ThemeInit() { useTheme(); return null; }

export default function Layout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [bell, setBell] = useState(false);
  const google = useApi<{ connection: { status: string; status_detail?: string; google_email?: string } }>('/google/status', [loc.pathname]);
  const notes = useApi<{ notifications: { id: string; title: string; body?: string; read: boolean; created_at: string }[]; unread: number }>('/notifications', [loc.pathname]);

  useEffect(() => setOpen(false), [loc.pathname]);
  const filtered = useMemo(() => NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length), [q]);
  const gs = google.data?.connection.status ?? 'NOT_CONNECTED';

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white dark:border-ink-700 dark:bg-ink-900">
      <div className="flex items-center justify-between p-4"><Logo /><button className="lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <div className="px-3 pb-2"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-8" placeholder="Search menu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search menu" /></div></div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {filtered.map((g) => (
          <div key={g.group} className="mt-3">
            <button className="flex w-full items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500" onClick={() => setCollapsed((c) => ({ ...c, [g.group]: !c[g.group] }))}>
              {g.group}<ChevronDown size={12} className={collapsed[g.group] ? '-rotate-90' : ''} />
            </button>
            {!collapsed[g.group] && g.items.map((i) => (
              <NavLink key={i.to} to={i.to} className={({ isActive }) => `mt-0.5 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-gold-500/15 font-semibold text-gold-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-700'}`}>{i.icon}{i.label}</NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-ink-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 font-bold text-ink-950">{(profile?.full_name ?? '?')[0]?.toUpperCase()}</div>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{profile?.full_name}</div><div className="truncate text-xs text-slate-500">{profile?.email}</div></div>
        <button aria-label="Sign out" title="Sign out" className="rounded-lg p-2 hover:bg-red-500/15 hover:text-red-500" onClick={async () => { await signOut(); nav('/login'); }}><LogOut size={16} /></button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">{sidebar}</div>
      {open && <div className="fixed inset-0 z-40 flex lg:hidden"><div className="h-full">{sidebar}</div><div className="flex-1 bg-black/60" onClick={() => setOpen(false)} /></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-ink-700 dark:bg-ink-900/80">
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={22} /></button>
          <div className="flex-1" />
          <button onClick={() => nav('/google-business')} title={google.data?.connection.status_detail ?? ''} className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-ink-600">
            <span className={`h-2 w-2 rounded-full ${gs === 'CONNECTED' ? 'bg-emerald-500' : gs === 'NOT_CONNECTED' ? 'bg-slate-400' : 'bg-amber-500'}`} />
            {gs === 'CONNECTED' ? 'Connected with Google' : `Google: ${STATUS_LABEL[gs] ?? gs}`}
          </button>
          <div className="relative">
            <button aria-label="Notifications" className="relative rounded-lg p-2 hover:bg-slate-500/15" onClick={() => setBell((b) => !b)}>
              <Bell size={18} />{!!notes.data?.unread && <span className="absolute right-1 top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{notes.data.unread}</span>}
            </button>
            {bell && (
              <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-ink-700 dark:bg-ink-800">
                <div className="flex items-center justify-between px-2 py-1"><span className="text-sm font-bold">Notifications</span>
                  <button className="text-xs text-gold-500" onClick={async () => { await api('/notifications/read-all', { method: 'POST', body: {} }); notes.reload(); }}>Mark all read</button></div>
                <div className="max-h-80 overflow-y-auto">
                  {!notes.data?.notifications.length && <p className="p-4 text-center text-sm text-slate-500">You're all caught up.</p>}
                  {notes.data?.notifications.map((n) => (
                    <button key={n.id} className={`block w-full rounded-xl p-2 text-left hover:bg-slate-500/10 ${n.read ? 'opacity-60' : ''}`} onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'POST', body: {} }); notes.reload(); }}>
                      <div className="text-sm font-semibold">{n.title}</div>{n.body && <div className="text-xs text-slate-500">{n.body}</div>}<div className="text-[10px] text-slate-400">{fmtDate(n.created_at)}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button aria-label="Toggle theme" className="rounded-lg p-2 hover:bg-slate-500/15" onClick={toggle}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6"><Outlet /><footer className="mt-10 pb-4 text-center text-xs text-slate-500">© {new Date().getFullYear()} Dhanus Gold Fitness. All rights reserved. DGF Local Ranker.</footer></main>
      </div>
    </div>
  );
}
export { Badge, TrendingUp, MessageSquare };
