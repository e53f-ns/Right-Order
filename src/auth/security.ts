/**
 * Security middleware — rate limiting, Helmet, CORS, cookie-parser, auth extraction
 */

import type { Request, Response, NextFunction, Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createLogger } from '../utils/logger.js';
import { validateAccessToken, type PublicUser } from './auth-db.js';

const logger = createLogger('security');

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
  handler: (_req: Request, res: Response) => {
    logger.warn({ ip: _req.ip }, 'Auth rate limit exceeded');
    res.status(429).json({ success: false, error: 'Too many authentication attempts, try again later' });
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
  max: 10, // 10 payment attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many payment attempts, try again later' },
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
  // Helmet — secure HTTP headers
  if (IS_PROD) {
    app.use(helmet({ crossOriginEmbedderPolicy: false }));
  } else {
    app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
  }

  // CORS
  const origin = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
  app.use(cors({
    origin: origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Cookie parser
  app.use(cookieParser());

  // Global API rate limit
  app.use('/api/', apiLimiter);

  // Auth-specific rate limits
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/payment/', paymentLimiter);

  // Extract user from Bearer token on all requests
  app.use(extractUser);

  logger.info({ cors: origin, helmet: true, rateLimiting: true }, 'Security middleware applied');
}
