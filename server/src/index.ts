import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './middleware/index.js';
import { core } from './routes/core.js';
import { gbp } from './routes/gbp.js';
import { reviews } from './routes/reviews.js';
import { business } from './routes/business.js';
import { growth } from './routes/growth.js';
import { admin, crm, hooks } from './routes/crm.js';
import { assistant } from './routes/assistant.js';
import { media } from './routes/media.js';
import { startScheduler } from './lib/scheduler.js';
import { configured } from './config.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL.split(','), credentials: false }));
app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));   // raw body needed for webhook signatures

app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } } }));
// AI endpoints cost money: tighter limit
app.use(['/api/locations/:id/ai', '/api/reviews/:id/ai-reply', '/api/posts/generate'], rateLimit({ windowMs: 60_000, limit: 20, message: { error: { code: 'RATE_LIMITED', message: 'AI rate limit reached. Try again in a minute.' } } }));

app.use('/api', core);
app.use('/api', hooks);   // public, signature-verified webhooks — must stay before authenticated routers
app.use('/api', gbp);
app.use('/api', reviews);
app.use('/api', business);
app.use('/api', growth);
app.use('/api', crm);
app.use('/api', assistant);
app.use('/api', media);
app.use('/api', admin);
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } }));
app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`DGF Local Ranker API listening on :${config.PORT}`);
  if (config.SCHEDULER_ENABLED === 'true' && configured.supabase) startScheduler();
});
