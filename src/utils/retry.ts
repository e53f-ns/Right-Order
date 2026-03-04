/**
 * Retry utility with exponential backoff and jitter
 * Handles rate limits, network errors, and temporary failures
 */

import { createLogger } from './logger.js';

const logger = createLogger('retry');

/**
 * Error types that should trigger retry
 */
export const RETRYABLE_ERRORS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
] as const;

/**
 * HTTP status codes that should trigger retry
 */
export const RETRYABLE_STATUS_CODES = [
  408, // Request Timeout
  429, // Too Many Requests (rate limit)
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
] as const;

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Jitter factor 0-1 (default: 0.1 = 10%) */
  jitterFactor: number;
  /** Optional: function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Optional: callback called before each retry */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number
): number {
  // Exponential backoff: initialDelay * multiplier^attempt
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: delay * (1 - jitter) to delay * (1 + jitter)
  const jitterRange = cappedDelay * jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random between -jitterRange and +jitterRange

  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Check if an error is retryable based on common patterns
 */
export function isRetryableError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  // Check for network errors
  if (error instanceof Error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== undefined && RETRYABLE_ERRORS.includes(errorCode as typeof RETRYABLE_ERRORS[number])) {
      return true;
    }

    // Check for rate limit errors (common in exchange APIs)
    const message = error.message.toLowerCase();
    if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('temporarily unavailable') ||
      message.includes('service unavailable') ||
      message.includes('timeout')
    ) {
      return true;
    }
  }

  // Check for HTTP status codes
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as { status?: number; statusCode?: number; code?: number };
    const status = errorObj.status ?? errorObj.statusCode ?? errorObj.code;

    if (typeof status === 'number' && RETRYABLE_STATUS_CODES.includes(status as typeof RETRYABLE_STATUS_CODES[number])) {
      return true;
    }
  }

  return false;
}

/**
 * Sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry on failure
 * Uses exponential backoff with jitter
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const shouldRetry = opts.isRetryable?.(error) ?? isRetryableError(error);

      if (!shouldRetry || attempt >= maxAttempts - 1) {
        // Not retryable or last attempt
        throw error;
      }

      // Calculate delay for next attempt
      const delayMs = calculateDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        jitterFactor
      );

      // Call onRetry callback if provided
      if (opts.onRetry !== undefined) {
        opts.onRetry(error, attempt + 1, delayMs);
      } else {
        // Default logging
        logger.warn(
          {
            attempt: attempt + 1,
            maxAttempts,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          },
          'Retrying after failure'
        );
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Create a retry wrapper with pre-configured options
 * Useful for creating exchange-specific retry handlers
 */
export function createRetryHandler(
  defaultOptions: Partial<RetryOptions>
): <T>(fn: () => Promise<T>, options?: Partial<RetryOptions>) => Promise<T> {
  return <T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}) =>
    withRetry(fn, { ...defaultOptions, ...options });
}

/**
 * Rate limit specific retry handler
 * Waits for rate limit reset before retrying
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> & { rateLimitResetMs?: number } = {}
): Promise<T> {
  const { rateLimitResetMs = 60000, ...retryOptions } = options;

  return withRetry(fn, {
    ...retryOptions,
    maxAttempts: retryOptions.maxAttempts ?? 5,
    initialDelayMs: rateLimitResetMs,
    maxDelayMs: rateLimitResetMs * 2,
    backoffMultiplier: 1.5,
    isRetryable: (error) => {
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return message.includes('rate limit') || message.includes('too many requests');
      }
      return false;
    },
  });
}
