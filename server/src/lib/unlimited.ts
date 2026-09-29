import { db } from './supabase.js';

/** Super admins have no plan limits (locations, keywords, geo-grid scans, AI credits). */
export async function isUnlimited(userId: string): Promise<boolean> {
  const { data } = await db().from('profiles').select('role').eq('id', userId).maybeSingle();
  return data?.role === 'super_admin';
}
export const UNLIMITED = 1_000_000;
