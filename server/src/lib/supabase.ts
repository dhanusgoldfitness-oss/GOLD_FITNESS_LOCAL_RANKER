import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config, configured } from '../config.js';
import { ApiError } from './errors.js';

let client: SupabaseClient | null = null;
/** Service-role client. BACKEND ONLY. Every query must be scoped by user_id in code. */
export function db(): SupabaseClient {
  if (!configured.supabase) throw new ApiError(503, 'NOT_CONNECTED', 'Supabase is not configured on the server.');
  client ??= createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  return client;
}

export async function audit(userId: string | null, action: string, entity?: string, entityId?: string, meta?: unknown) {
  try { await db().from('audit_logs').insert({ user_id: userId, action, entity, entity_id: entityId, meta }); } catch { /* never block on audit failure */ }
}
