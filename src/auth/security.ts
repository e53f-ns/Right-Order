/**
 * Security middleware — rate limiting, Helmet, CORS, cookie-parser, auth extraction
 */

import type { Request, Response, NextFunction, Express } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createLogger } from '../utils/logger.js';
import { validateAccessToken, type PublicUser } from './auth-db.js';

const logger = createLogger('security');
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ============================================================================
// Extend Express Request
// ============================================================================

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

// ============================================================================
// Rate limiters
// ============================================================================

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20, // 20 auth attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts, try again later' },
  handler: (req: Request, res: Response) => {
    const retryAfter = getRetryAfterSeconds(req);
    if (retryAfter !== undefined) {
      res.setHeader('Retry-After', String(retryAfter));
    }
    logger.warn({ ip: req.ip, retryAfter }, 'Auth rate limit exceeded');
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts, try again later',
      code: 'AUTH_RATE_LIMITED',
      retry_after: retryAfter,
    });
  },
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 120, // 120 API requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, slow down' },
});

export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 payment creation attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`,
  skip: (req: Request) => {
    const path = req.path || req.originalUrl.split('?')[0] || '';
    return !(path === '/api/payment/checkout' || path === '/api/payment/crypto');
  },
  message: { success: false, error: 'Too many payment attempts, try again later' },
  handler: (req: Request, res: Response) => {
    const retryAfter = getRetryAfterSeconds(req);
    if (retryAfter !== undefined) {
      res.setHeader('Retry-After', String(retryAfter));
    }
    logger.warn({ ip: req.ip, userId: req.user?.id, path: req.path || req.originalUrl, retryAfter }, 'Payment rate limit exceeded');
    res.status(429).json({
      success: false,
      error: 'Too many payment attempts, try again later',
      code: 'PAYMENT_RATE_LIMITED',
      retry_after: retryAfter,
    });
  },
});

// ============================================================================
// Cookie config
// ============================================================================

const IS_PROD = process.env['NODE_ENV'] === 'production';

export const REFRESH_COOKIE_NAME = 'ro_refresh_token';

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: IS_PROD ? 'strict' as const : 'lax' as const,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

function parseAllowedOrigins(): string[] {
  const raw = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
  return raw
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function getRequestOrigin(req: Request): string | null {
  const originHeader = req.headers['origin'];
  if (typeof originHeader === 'string' && originHeader.trim()) {
    return originHeader.trim();
  }
  const refererHeader = req.headers['referer'];
  if (typeof refererHeader === 'string' && refererHeader.trim()) {
    try {
      return new URL(refererHeader).origin;
    } catch {
      return null;
    }
  }
  return null;
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
}

function csrfProtection(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const cookies = req.cookies as Record<string, string> | undefined;
    const hasRefreshCookie = Boolean(cookies?.[REFRESH_COOKIE_NAME]);
    const hasAuthHeader = typeof req.headers['authorization'] === 'string';
    if (!hasRefreshCookie || hasAuthHeader) {
      next();
      return;
    }

    const requestOrigin = getRequestOrigin(req);
    if (!requestOrigin || !isAllowedOrigin(requestOrigin, allowedOrigins)) {
      logger.warn({ ip: req.ip, method: req.method, path: req.path, origin: requestOrigin }, 'CSRF origin check failed');
      res.status(403).json({ success: false, error: 'CSRF validation failed', code: 'CSRF_BLOCKED' });
      return;
    }

    next();
  };
}

// ============================================================================
// Middleware to extract user from Bearer token
// ============================================================================

export async function extractUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const user = await validateAccessToken(token);
      if (user) {
        req.user = user;
      }
    } catch (err: unknown) {
      logger.debug({ error: err instanceof Error ? err.message : String(err) }, 'Token validation failed');
    }
  }
  next();
}

// ============================================================================
// Require auth middleware
// ============================================================================

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'admin') {
    logger.warn({ userId: req.user.id, role: req.user.role }, 'Non-admin access attempt');
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }
  next();
}

// ============================================================================
// Apply all security middleware to Express app
// ============================================================================

export function applySecurityMiddleware(app: Express): void {
  const allowedOrigins = parseAllowedOrigins();

  // Helmet — secure HTTP headers
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://api.fontshare.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://api.fontshare.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...allowedOrigins],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  }));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    next();
  });

  // CORS
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (isAllowedOrigin(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin denied'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Cookie parser
  app.use(cookieParser());

  // Extract user early so payment rate limits can key by user (not only IP)
  app.use(extractUser);

  // CSRF protection for cookie-authenticated state-changing requests
  app.use(csrfProtection(allowedOrigins));

  // Global API rate limit
  app.use('/api/', apiLimiter);

  // Auth-specific rate limits
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  // Payment creation limit (checkout + crypto create only)
  app.use('/api/payment/', paymentLimiter);

  logger.info({ corsOrigins: allowedOrigins, helmet: true, rateLimiting: true, csrf: true }, 'Security middleware applied');
}

function getRetryAfterSeconds(req: Request): number | undefined {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  if (!resetTime) return undefined;
  const deltaMs = resetTime.getTime() - Date.now();
  if (deltaMs <= 0) return 0;
  return Math.ceil(deltaMs / 1000);
}
