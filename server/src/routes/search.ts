import { Router } from 'express';
import { z } from 'zod';
import { auth, validate, wrap } from '../middleware/index.js';
import { webSearch } from '../lib/perplexity.js';

export const search = Router();
search.use(auth);

const date = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Use MM/DD/YYYY');
const body = z.object({
  query: z.union([z.string().trim().min(2).max(400), z.array(z.string().trim().min(2).max(400)).min(1).max(5)]),
  max_results: z.number().int().min(1).max(20).optional(),
  search_type: z.enum(['web', 'fast']).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  search_language_filter: z.array(z.string().length(2)).max(20).optional(),
  search_domain_filter: z.array(z.string().min(3).max(253)).max(20).optional(),
  search_recency_filter: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
  search_after_date_filter: date.optional(), search_before_date_filter: date.optional(),
  last_updated_after_filter: date.optional(), last_updated_before_filter: date.optional(),
}).strict();

/** Ranked web results (title, url, snippet, date) — raw data for the app's own AI/research features, not an answer. */
search.post('/search/web', validate(body), wrap(async (req, res) => {
  res.json(await webSearch(req.body));
}));
