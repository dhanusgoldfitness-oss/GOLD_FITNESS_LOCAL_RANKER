import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarClock, Eye, EyeOff, Lock, Mail, Sparkles, Star } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/Layout';
import { Spinner } from '../components/ui';

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-gold-600 via-gold-500 to-gold-300 p-12 text-ink-950 lg:flex">
        <Logo className="mx-auto mb-8 h-32 w-32 shadow-xl" />
        <h2 className="text-center text-4xl font-extrabold">Boost Your<br />Local Ranking</h2>
        <p className="mt-3 max-w-sm text-center text-sm font-medium opacity-80">Manage your Google Business Profile with AI-powered tools and insights.</p>
        <div className="mt-8 w-full max-w-sm space-y-3">
          {[[Star, 'AI-powered review replies'], [BarChart3, 'Real-time profile audit'], [CalendarClock, 'Post scheduling'], [Sparkles, 'One-click optimization']].map(([I, t]: any) => (
            <div key={t} className="flex items-center gap-3 rounded-xl bg-white/25 px-4 py-3 text-sm font-semibold backdrop-blur"><I size={18} />{t}</div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center bg-slate-50 p-6 dark:bg-ink-950">
        <div className="card w-full max-w-md p-8">
          <div className="mb-6 text-center"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
          {!supabaseConfigured && <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Status: <b>NOT_CONNECTED</b> — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in.</div>}
          {children}
          <p className="mt-6 text-center text-xs text-slate-500">© {new Date().getFullYear()} DigiMithra. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, type = 'text', value, set, icon, autoComplete, required = true, minLength }: { label: string; type?: string; value: string; set: (v: string) => void; icon: React.ReactNode; autoComplete?: string; required?: boolean; minLength?: number }) {
  const [show, setShow] = useState(false);
  const isPw = type === 'password';
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-2.5 text-slate-400">{icon}</span>
        <input className="input pl-9 pr-9" type={isPw && show ? 'text' : type} value={value} onChange={(e) => set(e.target.value)} required={required} minLength={minLength} autoComplete={autoComplete} />
        {isPw && <button type="button" aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-2.5 text-slate-400" onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<string | void>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setOk('');
    try { const m = await fn(); if (m) setOk(m); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return { busy, err, ok, submit };
}
const Msg = ({ err, ok }: { err: string; ok: string }) => <>{err && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{err}</p>}{ok && <p className="mb-3 rounded-lg bg-emerald-500/10 p-2 text-sm text-emerald-500">{ok}</p>}</>;

export function Login() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const f = useSubmit(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message);
    nav('/dashboard');
  });
  if (session) return <Navigate to="/dashboard" replace />;
  return (
    <Shell title="Welcome Back" subtitle="Sign in to boost your business ranking">
      <form onSubmit={f.submit}>
        <Msg err={f.err} ok={f.ok} />
        <Field label="Email address" type="email" value={email} set={setEmail} icon={<Mail size={16} />} autoComplete="email" />
        <Field label="Password" type="password" value={pw} set={setPw} icon={<Lock size={16} />} autoComplete="current-password" />
        <div className="mb-4 text-right text-xs"><Link to="/forgot-password" className="text-gold-500 hover:underline">Forgot password?</Link></div>
        <button className="btn-primary w-full" disabled={f.busy}>{f.busy ? <Spinner /> : <>Sign in <ArrowRight size={16} /></>}</button>
        <p className="mt-4 text-center text-sm">New to DigiMithra? <Link to="/register" className="font-semibold text-gold-500">Sign up</Link></p>
      </form>
    </Shell>
  );
}

export function Register() {
  const { session } = useAuth();
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const f = useSubmit(async () => {
    const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name }, emailRedirectTo: window.location.origin + '/login' } });
    if (error) throw new Error(error.message);
    return data.session ? undefined : 'Account created. Check your email to verify your address, then sign in.';
  });
  if (session) return <Navigate to="/dashboard" replace />;
  return (
    <Shell title="Create your account" subtitle="Start managing your Google Business Profile">
      <form onSubmit={f.submit}>
        <Msg err={f.err} ok={f.ok} />
        <Field label="Full name" value={name} set={setName} icon={<Star size={16} />} autoComplete="name" />
        <Field label="Email address" type="email" value={email} set={setEmail} icon={<Mail size={16} />} autoComplete="email" />
        <Field label="Password (min 8 characters)" type="password" value={pw} set={setPw} icon={<Lock size={16} />} autoComplete="new-password" minLength={8} />
        <button className="btn-primary w-full" disabled={f.busy}>{f.busy ? <Spinner /> : 'Create account'}</button>
        <p className="mt-4 text-center text-sm">Already have an account? <Link to="/login" className="font-semibold text-gold-500">Sign in</Link></p>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const f = useSubmit(async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' });
    if (error) throw new Error(error.message);
    return 'If that email has an account, a reset link is on its way.';
  });
  return (
    <Shell title="Forgot password" subtitle="We'll email you a reset link">
      <form onSubmit={f.submit}>
        <Msg err={f.err} ok={f.ok} />
        <Field label="Email address" type="email" value={email} set={setEmail} icon={<Mail size={16} />} />
        <button className="btn-primary w-full" disabled={f.busy}>{f.busy ? <Spinner /> : 'Send reset link'}</button>
        <p className="mt-4 text-center text-sm"><Link to="/login" className="text-gold-500">Back to sign in</Link></p>
      </form>
    </Shell>
  );
}

export function Reset() {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const f = useSubmit(async () => {
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw new Error(error.message);
    nav('/dashboard');
  });
  return (
    <Shell title="Set a new password" subtitle="Choose a strong password">
      <form onSubmit={f.submit}>
        <Msg err={f.err} ok={f.ok} />
        <Field label="New password" type="password" value={pw} set={setPw} icon={<Lock size={16} />} minLength={8} autoComplete="new-password" />
        <button className="btn-primary w-full" disabled={f.busy}>{f.busy ? <Spinner /> : 'Update password'}</button>
      </form>
    </Shell>
  );
}
