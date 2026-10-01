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
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  AI_TEXT_PROVIDER: z.enum(['auto', 'openai', 'claude', 'gemini']).default('auto'),
  AI_IMAGE_PROVIDER: z.enum(['auto', 'openai', 'gemini']).default('auto'),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),
  GEMINI_VIDEO_MODEL: z.string().default('veo-3.0-fast-generate-001'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  SCHEDULER_ENABLED: z.string().default('true'),
});

export const config = schema.parse(process.env);

/** Which integrations are configured — used for honest status reporting (never fake data). */
export const configured = {
  supabase: !!(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY),
  google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  crypto: !!(config.TOKEN_ENC_KEY && /^[0-9a-f]{64}$/i.test(config.TOKEN_ENC_KEY)),
  gemini: !!config.GEMINI_API_KEY,
  claude: !!config.ANTHROPIC_API_KEY,
  openai: !!config.OPENAI_API_KEY,
  /** any provider able to write text (AI Mode, replies, audits, captions) */
  text: !!(config.GEMINI_API_KEY || config.ANTHROPIC_API_KEY || config.OPENAI_API_KEY),
  /** any provider able to make images */
  image: !!(config.GEMINI_API_KEY || (config.OPENAI_API_KEY && /^https:\/\/api\.openai\.com\//.test(config.OPENAI_BASE_URL))),
  maps: !!config.GOOGLE_MAPS_API_KEY,
  whatsapp: !!(config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_ID),
};
