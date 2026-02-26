/**
 * Authentication module — persistent users + JWT
 * Users stored in data/users.json (survives restart)
 * Tokens are real JWTs signed with JWT_SECRET from .env
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import jwt from 'jsonwebtoken';

import { createLogger } from '../utils/logger.js';
import type { SubscriptionPlan } from './subscription.js';

const logger = createLogger('auth');

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  subscription: SubscriptionPlan;
  subscriptionExpiresAt?: number;
  preferences: UserPreferences;
}

export interface UserPreferences {
  depositSize: number;
  favoriteSpreads: string[];
  defaultTab: string;
  autoRefreshSec: number;
  theme: 'dark' | 'light';
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: PublicUser;
  error?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  createdAt: number;
  subscription: SubscriptionPlan;
  subscriptionExpiresAt?: number;
  pro: boolean;
  preferences: UserPreferences;
}

interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// ============================================================================
// Configuration
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'ro-fallback-jwt-secret-change-me';
const TOKEN_EXPIRY = '7d';

const DEFAULT_PREFERENCES: UserPreferences = {
  depositSize: 1000,
  favoriteSpreads: [],
  defaultTab: 'spreads',
  autoRefreshSec: 30,
  theme: 'dark',
};

// ============================================================================
// Persistent store
// ============================================================================

/** In-memory cache backed by users.json */
const users = new Map<string, User>();
const emailIndex = new Map<string, string>(); // email -> userId

/** Blacklisted JWTs (logout before expiry) — in-memory only, acceptable */
const revokedTokens = new Set<string>();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logger.info({ dir: DATA_DIR }, 'Created data directory');
  }
}

function loadUsers(): void {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    logger.info('No users.json found — starting fresh');
    return;
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf-8');
    const arr = JSON.parse(raw) as User[];
    for (const u of arr) {
      users.set(u.id, u);
      emailIndex.set(u.email, u.id);
    }
    logger.info({ count: users.size }, `Loaded ${users.size} users from disk`);
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to load users.json');
  }
}

function saveUsers(): void {
  ensureDataDir();
  try {
    const arr = Array.from(users.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to save users.json');
  }
}

// Load on module init
loadUsers();

// ============================================================================
// Helpers
// ============================================================================

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'ro-salt-v1').digest('hex');
}

function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function signToken(userId: string, email: string): string {
  const payload: JwtPayload = { userId, email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

function toPublicUser(user: User): PublicUser {
  const pub: PublicUser = {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    subscription: user.subscription ?? 'free',
    pro: (user.subscription ?? 'free') !== 'free',
    preferences: { ...user.preferences },
  };
  if (user.subscriptionExpiresAt !== undefined) {
    pub.subscriptionExpiresAt = user.subscriptionExpiresAt;
  }
  return pub;
}

// ============================================================================
// Auth functions
// ============================================================================

export function register(email: string, password: string): AuthResult {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { success: false, error: 'Invalid email address' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }
  if (emailIndex.has(normalizedEmail)) {
    return { success: false, error: 'Email already registered' };
  }

  const id = generateId();
  const user: User = {
    id,
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
    subscription: 'free',
    preferences: { ...DEFAULT_PREFERENCES },
  };

  users.set(id, user);
  emailIndex.set(normalizedEmail, id);
  saveUsers();

  const token = signToken(id, normalizedEmail);

  logger.info({ userId: id, email: normalizedEmail }, 'New user registered');

  return { success: true, token, user: toPublicUser(user) };
}

export function login(email: string, password: string): AuthResult {
  const normalizedEmail = email.trim().toLowerCase();

  const userId = emailIndex.get(normalizedEmail);
  if (!userId) {
    return { success: false, error: 'Invalid email or password' };
  }

  const user = users.get(userId);
  if (!user) {
    return { success: false, error: 'Invalid email or password' };
  }

  if (user.passwordHash !== hashPassword(password)) {
    logger.warn({ email: normalizedEmail }, 'Failed login attempt');
    return { success: false, error: 'Invalid email or password' };
  }

  const token = signToken(user.id, normalizedEmail);

  logger.info({ userId: user.id, email: normalizedEmail }, 'User logged in');

  return { success: true, token, user: toPublicUser(user) };
}

export function validateToken(token: string): PublicUser | null {
  if (revokedTokens.has(token)) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const user = users.get(payload.userId);
  if (!user) return null;

  return toPublicUser(user);
}

export function logout(token: string): boolean {
  revokedTokens.add(token);
  // Cap revoked set size (old tokens expire anyway)
  if (revokedTokens.size > 10000) {
    const iter = revokedTokens.values();
    for (let i = 0; i < 5000; i++) {
      const v = iter.next();
      if (v.done) break;
      revokedTokens.delete(v.value);
    }
  }
  return true;
}

export function updatePreferences(userId: string, prefs: Partial<UserPreferences>): PublicUser | null {
  const user = users.get(userId);
  if (!user) return null;

  if (prefs.depositSize !== undefined) user.preferences.depositSize = prefs.depositSize;
  if (prefs.favoriteSpreads !== undefined) user.preferences.favoriteSpreads = prefs.favoriteSpreads;
  if (prefs.defaultTab !== undefined) user.preferences.defaultTab = prefs.defaultTab;
  if (prefs.autoRefreshSec !== undefined) user.preferences.autoRefreshSec = prefs.autoRefreshSec;
  if (prefs.theme !== undefined) user.preferences.theme = prefs.theme;

  saveUsers();

  logger.debug({ userId }, 'User preferences updated');

  return toPublicUser(user);
}

export function getAuthStats(): { totalUsers: number; activeSessions: number } {
  return { totalUsers: users.size, activeSessions: 0 };
}

/** Get internal User by id (for subscription updates) */
export function getUserById(userId: string): User | undefined {
  return users.get(userId);
}

/** Update user subscription plan */
export function updateSubscription(
  userId: string,
  plan: SubscriptionPlan,
  expiresAt?: number,
): PublicUser | null {
  const user = users.get(userId);
  if (!user) return null;

  user.subscription = plan;
  if (expiresAt !== undefined) {
    user.subscriptionExpiresAt = expiresAt;
  }
  saveUsers();

  logger.info({ userId, plan, expiresAt }, 'User subscription updated');
  return toPublicUser(user);
}
