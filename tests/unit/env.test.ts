import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const ENV_KEYS = [
  'DATABASE_URL', 'JWT_SECRET', 'NODE_ENV', 'PORT', 'FRONTEND_PORT',
  'CORS_ORIGIN', 'ACCESS_TOKEN_EXPIRY', 'REFRESH_TOKEN_EXPIRY',
];

describe('validateEnv', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('PROCESS_EXIT');
    }) as typeof process.exit);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
    vi.restoreAllMocks();
  });

  it('exits with code 1 when DATABASE_URL is missing', () => {
    process.env['JWT_SECRET'] = 'test-secret-minimum-16-chars';
    expect(() => validateEnv()).toThrow('PROCESS_EXIT');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when JWT_SECRET is missing', () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    expect(() => validateEnv()).toThrow('PROCESS_EXIT');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when JWT_SECRET is shorter than 16 chars', () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    process.env['JWT_SECRET'] = 'tooshort';
    expect(() => validateEnv()).toThrow('PROCESS_EXIT');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('returns NODE_ENV default of "development" when not set', () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    process.env['JWT_SECRET'] = 'test-secret-minimum-16-chars';
    const env = validateEnv();
    expect(env.NODE_ENV).toBe('development');
  });

  it('returns PORT default of 3000 when not set', () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    process.env['JWT_SECRET'] = 'test-secret-minimum-16-chars';
    const env = validateEnv();
    expect(env.PORT).toBe(3000);
  });

  it('returns parsed env when all required vars are set', () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    process.env['JWT_SECRET'] = 'test-secret-minimum-16-chars';
    const env = validateEnv();
    expect(env.DATABASE_URL).toBe('postgresql://localhost/test');
    expect(env.JWT_SECRET).toBe('test-secret-minimum-16-chars');
  });
});
