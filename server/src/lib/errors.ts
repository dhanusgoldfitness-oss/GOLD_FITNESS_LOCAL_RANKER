export type ApiCode =
  | 'NOT_CONNECTED' | 'API_PENDING' | 'REAUTH_REQUIRED' | 'OFFLINE'
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'RATE_LIMITED' | 'LIMIT_REACHED' | 'UPSTREAM' | 'INTERNAL';

export class ApiError extends Error {
  constructor(public status: number, public code: ApiCode, message: string) { super(message); }
}

/** Normalise Google / network failures so 401/403/429/network are distinguishable in the UI. */
export function fromUpstream(status: number, body: string, what: string): ApiError {
  if (status === 401) return new ApiError(401, 'REAUTH_REQUIRED', `${what}: Google session expired. Reconnect your Google account.`);
  if (status === 403) return new ApiError(403, 'API_PENDING', `${what}: access denied. The Business Profile API may not be approved/enabled for this project or account.`);
  if (status === 429) return new ApiError(429, 'RATE_LIMITED', `${what}: Google quota exceeded. Try again later.`);
  return new ApiError(502, 'UPSTREAM', `${what}: upstream error (${status}). ${body.slice(0, 160)}`);
}
