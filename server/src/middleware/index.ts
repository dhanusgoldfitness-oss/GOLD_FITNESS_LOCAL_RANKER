import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { ApiError } from '../lib/errors.js';
import { db } from '../lib/supabase.js';

declare module 'express-serve-static-core' {
  interface Request { user?: { id: string; email?: string; role: string } }
}

export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

/** Verifies the Supabase JWT (Authorization: Bearer) and loads the role from profiles. */
export const auth: RequestHandler = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new ApiError(401, 'UNAUTHORIZED', 'Sign in required.'));
  (async () => {
    const { data, error } = await db().auth.getUser(h.slice(7));
    if (error || !data.user) throw new ApiError(401, 'UNAUTHORIZED', 'Session expired. Please sign in again.');
    const { data: p } = await db().from('profiles').select('role').eq('id', data.user.id).maybeSingle();
    req.user = { id: data.user.id, email: data.user.email, role: p?.role ?? 'owner' };
  })().then(() => next(), next);
};

export const requireRole = (...roles: string[]): RequestHandler => (req, _res, next) =>
  roles.includes(req.user?.role ?? '') ? next() : next(new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action.'));

export const validate = <T>(schema: ZodSchema<T>, src: 'body' | 'query' = 'body') => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req[src]);
  if (!r.success) return next(r.error);
  (req as any)[src] = r.data;
  next();
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
  }
  console.error('[unhandled]', err instanceof Error ? err.message : err);   // never send internals to the client
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
