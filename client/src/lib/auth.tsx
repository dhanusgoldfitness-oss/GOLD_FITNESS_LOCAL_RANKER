import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, supabase } from './api';

export interface Profile {
  id: string; full_name: string | null; email: string | null; phone: string | null; role: string; ai_credits: number;
  notif_whatsapp: boolean; notif_review_alerts: boolean; notif_email: boolean; auto_reply: boolean; reply_tone: string;
}
interface Ctx { session: Session | null; profile: Profile | null; loading: boolean; refreshProfile: () => Promise<void>; signOut: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try { setProfile((await api<{ profile: Profile }>('/me')).profile); } catch { setProfile(null); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) refreshProfile(); else setProfile(null); }, [session, refreshProfile]);

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); };
  return <AuthCtx.Provider value={{ session, profile, loading, refreshProfile, signOut }}>{children}</AuthCtx.Provider>;
}
