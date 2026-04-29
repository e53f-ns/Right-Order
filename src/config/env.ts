import { z } from 'zod';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('env');

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),

  // Optional with defaults
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  FRONTEND_PORT: z.coerce.number().default(5173),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Optional (features disabled if missing)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  CRYPTO_USDT_TRC20_ADDRESS: z.string().optional(),
  CRYPTO_USDT_ERC20_ADDRESS: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  GROK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Token expiry
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    logger.fatal({ errors: result.error.issues }, 'Environment validation failed');
    console.error(`\nEnvironment validation failed:\n${errors}\n`);
    process.exit(1);
  }
  _env = result.data;
  logger.info({ nodeEnv: _env.NODE_ENV, port: _env.PORT }, 'Environment validated');
  return _env;
}

export function getEnv(): Env {
  if (!_env) return validateEnv();
  return _env;
}
