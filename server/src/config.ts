import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:8080/api/auth/google/callback'),
  TOKEN_ENC_KEY: z.string().optional(),
  OAUTH_STATE_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
});

export const config = schema.parse(process.env);

/** Which integrations are configured — used for honest status reporting (never fake data). */
export const configured = {
  supabase: !!(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY),
  google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  crypto: !!(config.TOKEN_ENC_KEY && /^[0-9a-f]{64}$/i.test(config.TOKEN_ENC_KEY)),
  gemini: !!config.GEMINI_API_KEY,
};
