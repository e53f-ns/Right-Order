/**
 * 2FA service — TOTP via speakeasy + QR code generation
 */

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { set2FASecret, enable2FA, disable2FA, get2FASecret } from './auth-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('2fa');

const APP_NAME = 'RightOrder';

export interface TwoFactorSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export async function setup2FA(userId: string, email: string): Promise<TwoFactorSetupResult | null> {
  try {
    const secret = speakeasy.generateSecret({
      name: `${APP_NAME}:${email}`,
      issuer: APP_NAME,
      length: 20,
    });

    const base32 = secret.base32;
    const otpauthUrl = secret.otpauth_url ?? `otpauth://totp/${APP_NAME}:${email}?secret=${base32}&issuer=${APP_NAME}`;

    await set2FASecret(userId, base32);

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    logger.info({ userId }, '2FA secret generated');

    return { secret: base32, otpauthUrl, qrCodeDataUrl };
  } catch (err: unknown) {
    logger.error({ userId, error: err instanceof Error ? err.message : String(err) }, 'Failed to setup 2FA');
    return null;
  }
}

export async function verify2FA(userId: string, token: string): Promise<boolean> {
  const secret = await get2FASecret(userId);
  if (!secret) return false;

  const valid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2, // Allow 2 time steps of drift (60s)
  });

  if (valid) {
    logger.debug({ userId }, '2FA token verified');
  } else {
    logger.warn({ userId }, '2FA token verification failed');
  }

  return valid;
}

export async function confirm2FA(userId: string, token: string): Promise<boolean> {
  const isValid = await verify2FA(userId, token);
  if (!isValid) return false;

  await enable2FA(userId);
  logger.info({ userId }, '2FA confirmed and enabled');
  return true;
}

export async function remove2FA(userId: string): Promise<boolean> {
  await disable2FA(userId);
  logger.info({ userId }, '2FA disabled');
  return true;
}
