import { config, configured } from '../config.js';
import { ApiError } from './errors.js';

/**
 * Perplexity Search API (POST https://api.perplexity.ai/search): ranked web results as structured data,
 * no LLM answer. Request/response shapes follow https://docs.perplexity.ai/api-reference/search-post.
 * Backend only — the key never reaches the browser.
 */
const URL_ = 'https://api.perplexity.ai/search';

export interface WebResult { title: string; url: string; snippet: string; date: string | null; last_updated: string | null }
export interface WebSearchResponse { id: string; results: WebResult[] }

export interface WebSearchInput {
  /** one query, or up to 5 independent queries (billed as one request, rate-limited per query) */
  query: string | string[];
  /** 1–20 (API default 10) */
  max_results?: number;
  /** `fast` is lower-latency and cheaper; `web` is the default */
  search_type?: 'web' | 'fast';
  /** ISO 3166-1 alpha-2, e.g. "IN" */
  country?: string;
  /** ISO 639-1 codes, max 20 */
  search_language_filter?: string[];
  /** max 20; allowlist ("example.com") OR denylist ("-example.com"), never mixed */
  search_domain_filter?: string[];
  search_recency_filter?: 'hour' | 'day' | 'week' | 'month' | 'year';
  /** MM/DD/YYYY */
  search_after_date_filter?: string;
  search_before_date_filter?: string;
  last_updated_after_filter?: string;
  last_updated_before_filter?: string;
}

const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Canonical form used only to detect the same page returned by different queries. */
export function urlKey(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    const path = x.pathname.replace(/\/+$/, '') || '/';
    return `${x.hostname.replace(/^www\./i, '').toLowerCase()}${path}${x.search}`;
  } catch { return u.trim().toLowerCase(); }
}

/** Keeps the first (best-ranked) occurrence of each URL, preserving order. */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((r) => { const k = urlKey(r.url); if (seen.has(k)) return false; seen.add(k); return true; });
}

function validate(i: WebSearchInput) {
  const qs = (Array.isArray(i.query) ? i.query : [i.query]).map((q) => String(q ?? '').trim());
  if (!qs.length || qs.some((q) => !q)) throw new ApiError(400, 'VALIDATION', 'Search query is required.');
  if (qs.length > 5) throw new ApiError(400, 'VALIDATION', 'At most 5 queries per request.');
  if (i.max_results !== undefined && (!Number.isInteger(i.max_results) || i.max_results < 1 || i.max_results > 20))
    throw new ApiError(400, 'VALIDATION', 'max_results must be between 1 and 20.');
  const dom = i.search_domain_filter;
  if (dom) {
    if (dom.length > 20) throw new ApiError(400, 'VALIDATION', 'At most 20 domains in search_domain_filter.');
    const deny = dom.filter((d) => d.startsWith('-')).length;
    if (deny && deny !== dom.length) throw new ApiError(400, 'VALIDATION', 'search_domain_filter must be all allowlist or all denylist ("-domain.com"), not mixed.');
  }
  return Array.isArray(i.query) ? qs : qs[0];
}

function validationMessage(text: string): string {
  try {
    const j: any = JSON.parse(text);
    const d = Array.isArray(j?.detail) ? j.detail.map((e: any) => `${(e.loc ?? []).join('.')}: ${e.msg}`).join('; ') : '';
    return d ? `Perplexity rejected the request (${d.slice(0, 200)}).` : 'Perplexity rejected the request.';
  } catch { return 'Perplexity rejected the request.'; }
}

export async function webSearch(input: WebSearchInput): Promise<WebSearchResponse> {
  if (!configured.perplexity) throw new ApiError(503, 'NOT_CONNECTED', 'PERPLEXITY_API_KEY is not set on the server.');
  const query = validate(input);
  const body = JSON.stringify({ ...input, query });

  let r: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      r = await fetch(URL_, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new ApiError(503, 'OFFLINE', 'Could not reach Perplexity.'); }
    // 429 (rate limit) and 5xx are retried with exponential backoff + jitter; Retry-After is honoured when present.
    if ((r.status === 429 || r.status >= 500) && attempt < MAX_RETRIES) {
      const ra = Number(r.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 500 * 2 ** attempt + Math.random() * 250;
      await sleep(wait);
      continue;
    }
    break;
  }
  const res = r!;
  if (res.status === 401 || res.status === 403) throw new ApiError(502, 'UPSTREAM', 'Perplexity rejected the API key (PERPLEXITY_API_KEY).');
  if (res.status === 422) throw new ApiError(400, 'VALIDATION', validationMessage(await res.text().catch(() => '')));
  if (res.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Perplexity rate limit reached. Try again shortly.');
  if (!res.ok) { console.error('[perplexity]', res.status); throw new ApiError(502, 'UPSTREAM', `Perplexity search failed (${res.status}).`); }

  const j: any = await res.json().catch(() => null);
  // Multi-query responses may nest one result list per query; flatten defensively, then dedupe by URL.
  const raw: any[] = Array.isArray(j?.results) ? j.results.flat() : [];
  const results = dedupeByUrl(raw
    .filter((x) => x && typeof x.url === 'string' && typeof x.title === 'string')
    .map((x): WebResult => ({ title: x.title, url: x.url, snippet: String(x.snippet ?? ''), date: x.date ?? null, last_updated: x.last_updated ?? null })));
  return { id: String(j?.id ?? ''), results };
}
