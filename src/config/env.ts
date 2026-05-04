import { z } from 'zod';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('env');

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),

  // Optional with defaults
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  FRONTEND_PORT: z.coerce.number().default(5173),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Optional (features disabled if missing)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_ELITE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ELITE_YEARLY: z.string().optional(),
  STRIPE_PRICE_ULTIMATE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ULTIMATE_YEARLY: z.string().optional(),
  CRYPTO_USDT_TRC20_ADDRESS: z.string().optional(),
  CRYPTO_USDT_ERC20_ADDRESS: z.string().optional(),
  CRYPTO_USDT_TON_ADDRESS: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  GROK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ETHERSCAN_API_KEY: z.string().optional(),
  TONCENTER_API_KEY: z.string().optional(),

  // Token expiry
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

const PAYMENT_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CRYPTO_USDT_TRC20_ADDRESS',
  'CRYPTO_USDT_ERC20_ADDRESS',
] as const;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    logger.fatal({ errors: result.error.issues }, 'Environment validation failed');
    console.error(`\nEnvironment validation failed:\n${errors}\n`);
    process.exit(1);
  }
  _env = result.data;

  if (_env.NODE_ENV === 'production') {
    const missing = PAYMENT_VARS.filter(k => {
      const v = _env![k];
      return !v || v === 'sk_test_PLACEHOLDER' || v === 'whsec_PLACEHOLDER';
    });
    if (missing.length > 0) {
      logger.warn({ missing }, 'Production mode: payment env vars missing — payment processing will be disabled for those methods');
      console.warn(`\nWARNING: production mode but missing payment vars: ${missing.join(', ')}\n`);
    }
    if (_env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      logger.warn('Production mode but STRIPE_SECRET_KEY is a test key (sk_test_*) — real payments will NOT process');
      console.warn('\nWARNING: NODE_ENV=production but STRIPE_SECRET_KEY is a test key.\n');
    }
  }

  logger.info({ nodeEnv: _env.NODE_ENV, port: _env.PORT }, 'Environment validated');
  return _env;
}

export function getEnv(): Env {
  if (!_env) return validateEnv();
  return _env;
}
