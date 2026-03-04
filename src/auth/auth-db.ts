/**
 * Authentication module — PostgreSQL via Prisma
 * bcrypt passwords, short-lived JWT access tokens + refresh token rotation
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import net from 'node:net';
import tls from 'node:tls';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import type { SubscriptionPlan as PrismaSubPlan, Role } from '../generated/prisma/client.js';

const logger = createLogger('auth-db');
const IS_PROD = process.env['NODE_ENV'] === 'production';

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

export interface RegisterCodeRequestResult {
  success: boolean;
  error?: string;
  expiresInSec?: number;
  emailMasked?: string;
}

export interface LoginCodeRequestResult {
  success: boolean;
  error?: string;
  expiresInSec?: number;
  emailMasked?: string;
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

function resolveJwtAccessSecret(): string {
  const configuredSecret = process.env['JWT_ACCESS_SECRET'] ?? process.env['JWT_SECRET'];
  if (configuredSecret && configuredSecret.length >= 32 && !configuredSecret.includes('CHANGE_ME')) {
    return configuredSecret;
  }

  if (IS_PROD) {
    throw new Error('JWT_ACCESS_SECRET must be set to a strong value (>=32 chars) in production');
  }

  const ephemeralSecret = crypto.randomBytes(32).toString('hex');
  logger.warn('JWT_ACCESS_SECRET is not configured securely; using ephemeral dev-only secret');
  return ephemeralSecret;
}

const JWT_SECRET = resolveJwtAccessSecret();
const ACCESS_TOKEN_EXPIRY = process.env['ACCESS_TOKEN_EXPIRY'] ?? '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env['REFRESH_TOKEN_EXPIRY_DAYS'] ?? '30', 10);
const BCRYPT_ROUNDS = parseInt(process.env['BCRYPT_ROUNDS'] ?? process.env['BCRYPT_SALT_ROUNDS'] ?? '12', 10);
const EMAIL_CODE_TTL_MIN = parseInt(process.env['EMAIL_VERIFICATION_TTL_MIN'] ?? '10', 10);
const EMAIL_CODE_MAX_ATTEMPTS = parseInt(process.env['EMAIL_VERIFICATION_MAX_ATTEMPTS'] ?? '5', 10);
const EMAIL_PROVIDER = (process.env['EMAIL_PROVIDER'] ?? 'auto').trim().toLowerCase();
const RESEND_API_KEY = process.env['RESEND_API_KEY'];
const EMAIL_FROM = process.env['EMAIL_FROM'] ?? 'Right Order <no-reply@rightorder.app>';
const SMTP_HOST = process.env['SMTP_HOST'] ?? 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env['SMTP_PORT'] ?? '587', 10);
const SMTP_SECURE = (process.env['SMTP_SECURE'] ?? 'false').trim().toLowerCase() === 'true';
const SMTP_USER = process.env['SMTP_USER'];
const SMTP_PASS = process.env['SMTP_PASS'];

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

function generateEmailVerificationCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const prefix = name.slice(0, 2);
  return `${prefix}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

function normalizeFromAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return from.trim();
}

function hasSmtpConfig(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

function createSmtpReader(socket: net.Socket | tls.TLSSocket): () => Promise<SmtpResponse> {
  let buffer = '';
  const queue: string[] = [];
  let waitingResolve: ((line: string) => void) | null = null;
  let waitingReject: ((error: Error) => void) | null = null;

  const flush = (): void => {
    if (waitingResolve && queue.length > 0) {
      const resolve = waitingResolve;
      waitingResolve = null;
      waitingReject = null;
      const line = queue.shift();
      if (line !== undefined) {
        resolve(line);
      }
    }
  };

  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const raw = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      queue.push(raw);
      idx = buffer.indexOf('\n');
    }
    flush();
  });

  const failWaiter = (message: string): void => {
    if (waitingReject) {
      const reject = waitingReject;
      waitingResolve = null;
      waitingReject = null;
      reject(new Error(message));
    }
  };

  socket.on('error', err => failWaiter(`SMTP socket error: ${err.message}`));
  socket.on('close', () => failWaiter('SMTP socket closed'));

  const nextLine = (): Promise<string> =>
    new Promise((resolve, reject) => {
      waitingResolve = resolve;
      waitingReject = reject;
      flush();
    });

  return async (): Promise<SmtpResponse> => {
    const lines: string[] = [];
    let line = await nextLine();
    lines.push(line);
    const code = parseInt(line.slice(0, 3), 10);
    if (!Number.isFinite(code)) {
      throw new Error(`Invalid SMTP response: ${line}`);
    }
    while (line.length >= 4 && line[3] === '-') {
      line = await nextLine();
      lines.push(line);
    }
    return { code, lines };
  };
}

async function smtpSendCommand(
  socket: net.Socket | tls.TLSSocket,
  readResponse: () => Promise<SmtpResponse>,
  command: string,
  expectedCodes: number[],
): Promise<SmtpResponse> {
  socket.write(`${command}\r\n`);
  const response = await readResponse();
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP ${command.split(' ')[0]} failed (${response.code}): ${response.lines.join(' | ')}`);
  }
  return response;
}

function upgradeToTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect(
      {
        socket,
        servername: host,
      },
      () => resolve(secureSocket),
    );
    secureSocket.once('error', reject);
  });
}

async function sendViaSmtp(email: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
  if (!SMTP_USER || !SMTP_PASS) {
    logger.error('SMTP_USER/SMTP_PASS are not configured');
    return { success: false, error: 'Email provider is not configured' };
  }

  const sender = normalizeFromAddress(EMAIL_FROM);
  let socket: net.Socket | tls.TLSSocket = SMTP_SECURE
    ? tls.connect({
        host: SMTP_HOST,
        port: SMTP_PORT,
        servername: SMTP_HOST,
      })
    : net.connect({ host: SMTP_HOST, port: SMTP_PORT });

  try {
    const waitConnected = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    await waitConnected;

    let readResponse = createSmtpReader(socket);

    const greeting = await readResponse();
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed (${greeting.code}): ${greeting.lines.join(' | ')}`);
    }

    await smtpSendCommand(socket, readResponse, 'EHLO localhost', [250]);

    if (!SMTP_SECURE) {
      await smtpSendCommand(socket, readResponse, 'STARTTLS', [220]);
      socket = await upgradeToTls(socket, SMTP_HOST);
      readResponse = createSmtpReader(socket);
      await smtpSendCommand(socket, readResponse, 'EHLO localhost', [250]);
    }

    await smtpSendCommand(socket, readResponse, 'AUTH LOGIN', [334]);
    await smtpSendCommand(socket, readResponse, Buffer.from(SMTP_USER).toString('base64'), [334]);
    await smtpSendCommand(socket, readResponse, Buffer.from(SMTP_PASS).toString('base64'), [235]);

    await smtpSendCommand(socket, readResponse, `MAIL FROM:<${sender}>`, [250]);
    await smtpSendCommand(socket, readResponse, `RCPT TO:<${email}>`, [250, 251]);
    await smtpSendCommand(socket, readResponse, 'DATA', [354]);

    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
    const dotSafeHtml = html.replace(/\r?\n\./g, '\n..');
    const message = [
      `From: ${EMAIL_FROM}`,
      `To: ${email}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      dotSafeHtml,
    ].join('\r\n');

    socket.write(`${message}\r\n.\r\n`);
    const queued = await readResponse();
    if (queued.code !== 250) {
      throw new Error(`SMTP DATA failed (${queued.code}): ${queued.lines.join(' | ')}`);
    }

    await smtpSendCommand(socket, readResponse, 'QUIT', [221]);
    return { success: true };
  } catch (err: unknown) {
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
      },
      'SMTP verification email send failed',
    );
    return { success: false, error: 'Failed to send verification email' };
  } finally {
    socket.end();
  }
}

async function sendVerificationEmail(
  email: string,
  code: string,
  purpose: 'register' | 'login',
): Promise<{ success: boolean; error?: string }> {
  const subject = purpose === 'login'
    ? 'Your Right Order login code'
    : 'Your Right Order verification code';
  const intro = purpose === 'login'
    ? 'Use this code to complete sign in:'
    : 'Use this code to complete your account creation:';
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; color: #111;">
      <h2 style="margin-bottom: 8px;">Verify your email</h2>
      <p style="margin: 0 0 12px 0;">${intro}</p>
      <div style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 8px 0 16px 0;">${code}</div>
      <p style="margin: 0; color: #555;">Code expires in ${EMAIL_CODE_TTL_MIN} minutes.</p>
    </div>
  `;

  if (EMAIL_PROVIDER === 'smtp' || (EMAIL_PROVIDER === 'auto' && hasSmtpConfig())) {
    return sendViaSmtp(email, subject, html);
  }

  if (EMAIL_PROVIDER === 'resend' || EMAIL_PROVIDER === 'auto') {
    if (!RESEND_API_KEY) {
      logger.error({ provider: EMAIL_PROVIDER }, 'RESEND_API_KEY not configured');
      return { success: false, error: 'Email provider is not configured' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [email],
          subject,
          html,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, 'Failed to send verification email via Resend');
        return { success: false, error: 'Failed to send verification email' };
      }
      return { success: true };
    } catch (err: unknown) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Resend verification email request failed');
      return { success: false, error: 'Failed to send verification email' };
    }
  }

  logger.error({ provider: EMAIL_PROVIDER }, 'Unknown email provider configuration');
  return { success: false, error: 'Email provider is not configured' };
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

async function createSessionForUser(
  user: {
    id: string;
    email: string;
    role: Role;
    createdAt: Date;
    subscription: PrismaSubPlan;
    subscriptionExpiresAt: Date | null;
    twoFactorEnabled: boolean;
    depositSize: number;
    preferences: unknown;
  },
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const accessToken = signAccessToken(user.id, user.email, user.role);
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

  return {
    success: true,
    accessToken,
    refreshToken: refreshTokenStr,
    user: toPublicUser(user),
  };
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
  const request = await requestRegistrationCode(email, password, ip, userAgent);
  if (!request.success) {
    return { success: false, error: request.error ?? 'Failed to start registration' };
  }
  return { success: false, error: 'Verification code sent. Please verify to complete registration.' };
}

export async function requestRegistrationCode(
  email: string,
  password: string,
  ip?: string,
  userAgent?: string,
): Promise<RegisterCodeRequestResult> {
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

  const code = generateEmailVerificationCode();
  const [passwordHash, codeHash] = await Promise.all([
    bcrypt.hash(password, BCRYPT_ROUNDS),
    bcrypt.hash(code, 8),
  ]);
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60 * 1000);

  await prisma.emailVerification.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      codeHash,
      passwordHash,
      attempts: 0,
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    },
    update: {
      codeHash,
      passwordHash,
      attempts: 0,
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    },
  });

  const sent = await sendVerificationEmail(normalizedEmail, code, 'register');
  if (!sent.success) {
    return { success: false, error: sent.error ?? 'Failed to send verification code' };
  }

  logger.info({ email: normalizedEmail, ip }, 'Registration verification code sent');
  return {
    success: true,
    expiresInSec: EMAIL_CODE_TTL_MIN * 60,
    emailMasked: maskEmail(normalizedEmail),
  };
}

export async function verifyRegistrationCode(
  email: string,
  code: string,
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const codeNormalized = code.trim();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { success: false, error: 'Invalid email address' };
  }
  if (!/^\d{6}$/.test(codeNormalized)) {
    return { success: false, error: 'Invalid verification code format' };
  }

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    return { success: false, error: 'Email already registered' };
  }

  const pending = await prisma.emailVerification.findUnique({ where: { email: normalizedEmail } });
  if (!pending) {
    return { success: false, error: 'Verification code not found. Request a new one.' };
  }
  if (pending.expiresAt < new Date()) {
    await prisma.emailVerification.delete({ where: { email: normalizedEmail } });
    return { success: false, error: 'Verification code expired. Request a new one.' };
  }
  if (pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await prisma.emailVerification.delete({ where: { email: normalizedEmail } });
    return { success: false, error: 'Too many invalid attempts. Request a new code.' };
  }

  const codeValid = await bcrypt.compare(codeNormalized, pending.codeHash);
  if (!codeValid) {
    await prisma.emailVerification.update({
      where: { email: normalizedEmail },
      data: { attempts: { increment: 1 } },
    });
    return { success: false, error: 'Invalid verification code' };
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: pending.passwordHash,
      role: 'user',
      subscription: 'free',
      preferences: JSON.parse(JSON.stringify(DEFAULT_PREFS)),
      lastLoginAt: new Date(),
      lastLoginIp: ip ?? null,
    },
  });
  await prisma.emailVerification.delete({ where: { email: normalizedEmail } });

  logger.info({ userId: user.id, email: normalizedEmail, ip }, 'New user registered via email verification');
  return createSessionForUser(user, ip, userAgent);
}

export async function requestLoginCode(
  email: string,
  password: string,
  ip?: string,
  userAgent?: string,
): Promise<LoginCodeRequestResult> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { success: false, error: 'Invalid email address' };
  }
  if (!password) {
    return { success: false, error: 'Password required' };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    logger.warn({ email: normalizedEmail, ip }, 'Login code request for non-existent email');
    return { success: false, error: 'Invalid email or password' };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    logger.warn({ email: normalizedEmail, ip, userId: user.id }, 'Login code request failed — wrong password');
    return { success: false, error: 'Invalid email or password' };
  }

  const code = generateEmailVerificationCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60 * 1000);

  await prisma.loginVerification.upsert({
    where: { email: normalizedEmail },
    create: {
      userId: user.id,
      email: normalizedEmail,
      codeHash,
      attempts: 0,
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    },
    update: {
      userId: user.id,
      codeHash,
      attempts: 0,
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    },
  });

  const sent = await sendVerificationEmail(normalizedEmail, code, 'login');
  if (!sent.success) {
    return { success: false, error: sent.error ?? 'Failed to send verification code' };
  }

  logger.info({ userId: user.id, email: normalizedEmail, ip }, 'Login verification code sent');
  return {
    success: true,
    expiresInSec: EMAIL_CODE_TTL_MIN * 60,
    emailMasked: maskEmail(normalizedEmail),
  };
}

export async function verifyLoginCode(
  email: string,
  code: string,
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const codeNormalized = code.trim();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { success: false, error: 'Invalid email address' };
  }
  if (!/^\d{6}$/.test(codeNormalized)) {
    return { success: false, error: 'Invalid verification code format' };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const pending = await prisma.loginVerification.findUnique({ where: { email: normalizedEmail } });
  if (!pending) {
    return { success: false, error: 'Verification code not found. Request a new one.' };
  }
  if (pending.expiresAt < new Date()) {
    await prisma.loginVerification.delete({ where: { email: normalizedEmail } });
    return { success: false, error: 'Verification code expired. Request a new one.' };
  }
  if (pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await prisma.loginVerification.delete({ where: { email: normalizedEmail } });
    return { success: false, error: 'Too many invalid attempts. Request a new code.' };
  }

  const codeValid = await bcrypt.compare(codeNormalized, pending.codeHash);
  if (!codeValid) {
    await prisma.loginVerification.update({
      where: { email: normalizedEmail },
      data: { attempts: { increment: 1 } },
    });
    return { success: false, error: 'Invalid verification code' };
  }

  await prisma.loginVerification.delete({ where: { email: normalizedEmail } });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
  });

  logger.info({ userId: user.id, email: normalizedEmail, ip }, 'User logged in via email code verification');
  return createSessionForUser(user, ip, userAgent);
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

  logger.info({ userId: user.id, email: normalizedEmail, ip }, 'User logged in');
  return createSessionForUser(user, ip, userAgent);
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
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const safeLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.trunc(limit))) : 50;
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
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

export async function cleanupExpiredEmailVerifications(): Promise<number> {
  const result = await prisma.emailVerification.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    logger.debug({ count: result.count }, 'Cleaned up expired email verification codes');
  }
  return result.count;
}

export async function cleanupExpiredLoginVerifications(): Promise<number> {
  const result = await prisma.loginVerification.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    logger.debug({ count: result.count }, 'Cleaned up expired login verification codes');
  }
  return result.count;
}

logger.info('Auth-DB module initialized (Prisma + bcrypt + JWT)');
