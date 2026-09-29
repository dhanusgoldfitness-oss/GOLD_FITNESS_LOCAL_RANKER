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

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL.split(','), credentials: false }));
app.use(express.json({ limit: '200kb' }));

app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } } }));
// AI endpoints cost money: tighter limit
app.use(['/api/locations/:id/ai', '/api/reviews/:id/ai-reply', '/api/posts/generate'], rateLimit({ windowMs: 60_000, limit: 20, message: { error: { code: 'RATE_LIMITED', message: 'AI rate limit reached. Try again in a minute.' } } }));

app.use('/api', core);
app.use('/api', gbp);
app.use('/api', reviews);
app.use('/api', business);
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } }));
app.use(errorHandler);

app.listen(config.PORT, () => console.log(`DGF Local Ranker API listening on :${config.PORT}`));
