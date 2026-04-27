/**
 * Authentication module — PostgreSQL via Prisma
 * bcrypt passwords, short-lived JWT access tokens + refresh token rotation
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import type { SubscriptionPlan as PrismaSubPlan, Role } from '../generated/prisma/client.js';

const logger = createLogger('auth-db');

// ============================================================================
// Types (public API — keep backward-compatible with frontend)
// ============================================================================

export type SubscriptionPlan = 'free' | 'pro' | 'elite' | 'ultimate';
export type UserRole = 'user' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: number;
  subscription: SubscriptionPlan;
  subscriptionExpiresAt?: number;
  pro: boolean;
  twoFactorEnabled: boolean;
  preferences: UserPreferences;
}

export interface UserPreferences {
  depositSize: number;
  defaultTab: string;
  autoRefreshSec: number;
  theme: 'dark' | 'light';
}

export interface AuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: PublicUser;
  error?: string;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'ro-fallback-jwt-secret-change-me';
const ACCESS_TOKEN_EXPIRY = process.env['ACCESS_TOKEN_EXPIRY'] ?? '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env['REFRESH_TOKEN_EXPIRY_DAYS'] ?? '30', 10);
const BCRYPT_ROUNDS = Math.max(10, parseInt(process.env['BCRYPT_SALT_ROUNDS'] ?? '12', 10));

const DEFAULT_PREFS: UserPreferences = {
  depositSize: 1000,
  defaultTab: 'spreads',
  autoRefreshSec: 30,
  theme: 'dark',
};

// ============================================================================
// Helpers
// ============================================================================

function signAccessToken(userId: string, email: string, role: string): string {
  const payload: JwtPayload = { userId, email, role };
  const expiry = ACCESS_TOKEN_EXPIRY;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiry as unknown as number });
}

function verifyAccessToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function parsePrefs(raw: unknown): UserPreferences {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      depositSize: typeof obj['depositSize'] === 'number' ? obj['depositSize'] : DEFAULT_PREFS.depositSize,
      defaultTab: typeof obj['defaultTab'] === 'string' ? obj['defaultTab'] : DEFAULT_PREFS.defaultTab,
      autoRefreshSec: typeof obj['autoRefreshSec'] === 'number' ? obj['autoRefreshSec'] : DEFAULT_PREFS.autoRefreshSec,
      theme: obj['theme'] === 'light' ? 'light' : 'dark',
    };
  }
  return { ...DEFAULT_PREFS };
}

function toPublicUser(u: {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  subscription: PrismaSubPlan;
  subscriptionExpiresAt: Date | null;
  twoFactorEnabled: boolean;
  depositSize: number;
  preferences: unknown;
}): PublicUser {
  const prefs = parsePrefs(u.preferences);
  prefs.depositSize = u.depositSize;
  const pub: PublicUser = {
    id: u.id,
    email: u.email,
    role: u.role as UserRole,
    createdAt: u.createdAt.getTime(),
    subscription: u.subscription as SubscriptionPlan,
    pro: u.subscription !== 'free',
    twoFactorEnabled: u.twoFactorEnabled,
    preferences: prefs,
  };
  const expiresMs = u.subscriptionExpiresAt?.getTime();
  if (expiresMs !== undefined) {
    pub.subscriptionExpiresAt = expiresMs;
  }
  return pub;
}

// ============================================================================
// Auth functions
// ============================================================================

export async function register(
  email: string,
  password: string,
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { success: false, error: 'Invalid email address' };
  }
  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    logger.warn({ email: normalizedEmail, ip }, 'Registration attempt with existing email');
    return { success: false, error: 'Email already registered' };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      role: 'user',
      subscription: 'free',
      preferences: JSON.parse(JSON.stringify(DEFAULT_PREFS)),
      lastLoginAt: new Date(),
      lastLoginIp: ip ?? null,
    },
  });

  const accessToken = signAccessToken(user.id, normalizedEmail, user.role);
  const refreshTokenStr = generateRefreshToken();

  const refreshExpiresAt = new Date();
  refreshExpiresAt.setDate(refreshExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenStr,
      userId: user.id,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
      expiresAt: refreshExpiresAt,
    },
  });

  logger.info({ userId: user.id, email: normalizedEmail, ip }, 'New user registered');

  return {
    success: true,
    accessToken,
    refreshToken: refreshTokenStr,
    user: toPublicUser(user),
  };
}

export async function login(
  email: string,
  password: string,
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    logger.warn({ email: normalizedEmail, ip }, 'Login attempt for non-existent email');
    return { success: false, error: 'Invalid email or password' };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    logger.warn({ email: normalizedEmail, ip, userId: user.id }, 'Failed login attempt — wrong password');
    return { success: false, error: 'Invalid email or password' };
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
  });

  const accessToken = signAccessToken(user.id, normalizedEmail, user.role);
  const refreshTokenStr = generateRefreshToken();

  const refreshExpiresAt = new Date();
  refreshExpiresAt.setDate(refreshExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenStr,
      userId: user.id,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
      expiresAt: refreshExpiresAt,
    },
  });

  logger.info({ userId: user.id, email: normalizedEmail, ip }, 'User logged in');

  return {
    success: true,
    accessToken,
    refreshToken: refreshTokenStr,
    user: toPublicUser(user),
  };
}

export async function validateAccessToken(token: string): Promise<PublicUser | null> {
  const payload = verifyAccessToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) return null;

  return toPublicUser(user);
}

export async function refreshAccessToken(
  refreshTokenStr: string,
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshTokenStr },
    include: { user: true },
  });

  if (!stored) {
    logger.warn({ ip }, 'Refresh attempt with unknown token');
    return { success: false, error: 'Invalid refresh token' };
  }

  if (stored.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    logger.warn({ userId: stored.userId, ip }, 'Refresh token expired');
    return { success: false, error: 'Refresh token expired' };
  }

  // Rotate: delete old token, create new one
  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const newRefreshStr = generateRefreshToken();
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: newRefreshStr,
      userId: stored.userId,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
      expiresAt: newExpiry,
    },
  });

  const accessToken = signAccessToken(stored.user.id, stored.user.email, stored.user.role);

  logger.debug({ userId: stored.userId }, 'Access token refreshed');

  return {
    success: true,
    accessToken,
    refreshToken: newRefreshStr,
    user: toPublicUser(stored.user),
  };
}

export async function logout(refreshTokenStr: string): Promise<boolean> {
  try {
    await prisma.refreshToken.deleteMany({ where: { token: refreshTokenStr } });
    return true;
  } catch {
    return false;
  }
}

export async function logoutAll(userId: string): Promise<boolean> {
  try {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    logger.info({ userId }, 'All sessions revoked');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Profile / preferences
// ============================================================================

export async function updatePreferences(
  userId: string,
  prefs: Partial<UserPreferences>,
): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const current = parsePrefs(user.preferences);
  const merged: UserPreferences = {
    ...current,
    ...prefs,
  };

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      depositSize: merged.depositSize,
      preferences: JSON.parse(JSON.stringify(merged)),
    },
  });

  logger.debug({ userId }, 'User preferences updated');
  return toPublicUser(updated);
}

// ============================================================================
// Subscription management
// ============================================================================

export async function updateSubscription(
  userId: string,
  plan: SubscriptionPlan,
  expiresAt?: number,
): Promise<PublicUser | null> {
  const data: Record<string, unknown> = { subscription: plan as PrismaSubPlan };
  if (expiresAt !== undefined) {
    data['subscriptionExpiresAt'] = new Date(expiresAt);
  }

  try {
    const updated = await prisma.user.update({ where: { id: userId }, data });
    logger.info({ userId, plan, expiresAt }, 'User subscription updated');
    return toPublicUser(updated);
  } catch {
    return null;
  }
}

// ============================================================================
// Admin helpers
// ============================================================================

export async function getUserById(userId: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? toPublicUser(user) : null;
}

export async function getAllUsers(page = 1, limit = 50): Promise<{ users: PublicUser[]; total: number }> {
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count(),
  ]);
  return { users: users.map(toPublicUser), total };
}

export async function setUserRole(userId: string, role: UserRole): Promise<PublicUser | null> {
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: role as Role },
    });
    logger.info({ userId, role }, 'User role updated');
    return toPublicUser(updated);
  } catch {
    return null;
  }
}

export async function getAuthStats(): Promise<{ totalUsers: number; proUsers: number; adminUsers: number; activeRefreshTokens: number }> {
  const [totalUsers, proUsers, adminUsers, activeRefreshTokens] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { subscription: { not: 'free' } } }),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.refreshToken.count({ where: { expiresAt: { gt: new Date() } } }),
  ]);
  return { totalUsers, proUsers, adminUsers, activeRefreshTokens };
}

// ============================================================================
// 2FA helpers
// ============================================================================

export async function set2FASecret(userId: string, secret: string): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });
    return true;
  } catch {
    return false;
  }
}

export async function enable2FA(userId: string): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    logger.info({ userId }, '2FA enabled');
    return true;
  } catch {
    return false;
  }
}

export async function disable2FA(userId: string): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    logger.info({ userId }, '2FA disabled');
    return true;
  } catch {
    return false;
  }
}

export async function get2FASecret(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorSecret: true } });
  return user?.twoFactorSecret ?? null;
}

// ============================================================================
// Cleanup
// ============================================================================

export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    logger.debug({ count: result.count }, 'Cleaned up expired refresh tokens');
  }
  return result.count;
}

logger.info('Auth-DB module initialized (Prisma + bcrypt + JWT)');
