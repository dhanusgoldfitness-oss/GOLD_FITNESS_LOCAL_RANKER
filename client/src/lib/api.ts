import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabaseConfigured = !!(url && anon);
// Anon key only. All privileged work happens on the backend.
export const supabase = createClient(url ?? 'http://localhost', anon ?? 'missing', { auth: { persistSession: true, autoRefreshToken: true } });

export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Cannot reach the DGF server. Check your connection or try again shortly.');
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Download failed.');
    return (await res.blob()) as unknown as T;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export const STATUS_LABEL: Record<string, string> = {
  NOT_CONNECTED: 'Not connected', CONNECTING: 'Connecting…', CONNECTED: 'Connected', API_PENDING: 'API pending',
  REAUTH_REQUIRED: 'Reconnect required', ERROR: 'Error', OFFLINE: 'Offline',
};
