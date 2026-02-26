/**
 * Token bucket rate limiter
 * Per-exchange rate limiting to respect API limits
 */

import { EXCHANGE_CONFIGS } from '../config/exchanges.js';
import type { ExchangeId } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';

import type { RateLimiterStatus } from './types.js';

const logger = createLogger('rate-limiter');

/**
 * Queued request waiting for tokens
 */
interface QueuedRequest {
  tokens: number;
  priority: Priority;
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timeoutMs: number;
}

/**
 * Priority type
 */
type Priority = 'high' | 'normal' | 'low';

/**
 * Priority weights for queue ordering
 */
const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * Token bucket rate limiter for a single exchange
 */
export class ExchangeRateLimiter {
  private readonly exchangeId: ExchangeId;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private availableTokens: number;
  private lastRefillTime: number;
  private readonly queue: QueuedRequest[] = [];
  private processingQueue = false;

  constructor(exchangeId: ExchangeId, requestsPerMinute?: number) {
    this.exchangeId = exchangeId;

    // Get rate limit from config or use provided value
    const config = EXCHANGE_CONFIGS[exchangeId];
    const rpm = requestsPerMinute ?? config.rateLimits.requestsPerMinute;

    // Convert to tokens: use 80% of limit as safety margin
    this.maxTokens = Math.floor((rpm * 0.8) / 60); // tokens per second capacity
    this.refillRate = Math.floor(rpm * 0.8) / 60; // refill rate per second
    this.availableTokens = this.maxTokens;
    this.lastRefillTime = nowMs();

    logger.debug(
      {
        exchangeId,
        maxTokens: this.maxTokens,
        refillRate: this.refillRate.toFixed(2),
        requestsPerMinute: rpm,
      },
      'Rate limiter initialized'
    );
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = nowMs();
    const elapsedSec = (now - this.lastRefillTime) / 1000;

    if (elapsedSec > 0) {
      const tokensToAdd = elapsedSec * this.refillRate;
      this.availableTokens = Math.min(this.maxTokens, this.availableTokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Try to consume tokens immediately
   * Returns true if tokens were consumed, false if not enough tokens
   */
  private tryConsume(tokens: number): boolean {
    this.refill();

    if (this.availableTokens >= tokens) {
      this.availableTokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Acquire tokens for a request
   * Returns a promise that resolves when tokens are available
   *
   * @param tokens - Number of tokens to acquire (default: 1)
   * @param priority - Request priority (default: 'normal')
   * @param timeoutMs - Maximum time to wait (default: 30000ms)
   */
  async acquire(
    tokens = 1,
    priority: Priority = 'normal',
    timeoutMs = 30000
  ): Promise<void> {
    // Try immediate consumption
    if (this.tryConsume(tokens)) {
      return;
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        tokens,
        priority,
        resolve,
        reject,
        enqueuedAt: nowMs(),
        timeoutMs,
      };

      // Insert in priority order
      const insertIndex = this.queue.findIndex(
        (r) => PRIORITY_WEIGHTS[r.priority] > PRIORITY_WEIGHTS[priority]
      );

      if (insertIndex === -1) {
        this.queue.push(request);
      } else {
        this.queue.splice(insertIndex, 0, request);
      }

      logger.debug(
        {
          exchangeId: this.exchangeId,
          tokens,
          priority,
          queueLength: this.queue.length,
        },
        'Request queued for rate limiting'
      );

      // Start processing queue if not already running
      this.scheduleProcessQueue();
    });
  }

  /**
   * Schedule queue processing
   */
  private scheduleProcessQueue(): void {
    if (this.processingQueue) return;

    this.processingQueue = true;
    setTimeout(() => this.processQueue(), 100);
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    const now = nowMs();

    // Process expired requests
    const expiredIndices: number[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const request = this.queue[i];
      if (request !== undefined && now - request.enqueuedAt > request.timeoutMs) {
        expiredIndices.push(i);
        request.reject(new Error(`Rate limit timeout for ${this.exchangeId}`));
      }
    }

    // Remove expired requests (reverse order to maintain indices)
    for (let i = expiredIndices.length - 1; i >= 0; i--) {
      const idx = expiredIndices[i];
      if (idx !== undefined) {
        this.queue.splice(idx, 1);
      }
    }

    // Try to fulfill queued requests
    while (this.queue.length > 0) {
      const firstRequest = this.queue[0];
      if (firstRequest === undefined) break;

      if (this.tryConsume(firstRequest.tokens)) {
        this.queue.shift();
        firstRequest.resolve();
      } else {
        // Not enough tokens, wait and retry
        break;
      }
    }

    // Continue processing if queue not empty
    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 100);
    } else {
      this.processingQueue = false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): RateLimiterStatus {
    this.refill();

    return {
      exchangeId: this.exchangeId,
      availableTokens: Math.floor(this.availableTokens),
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
      lastRefill: this.lastRefillTime,
      queuedRequests: this.queue.length,
    };
  }

  /**
   * Reset the limiter (useful for testing or after long pause)
   */
  reset(): void {
    this.availableTokens = this.maxTokens;
    this.lastRefillTime = nowMs();

    // Reject all queued requests
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      if (request !== undefined) {
        request.reject(new Error('Rate limiter reset'));
      }
    }

    logger.info({ exchangeId: this.exchangeId }, 'Rate limiter reset');
  }
}

/**
 * Manages rate limiters for all exchanges
 */
export class RateLimiterManager {
  private readonly limiters: Map<ExchangeId, ExchangeRateLimiter> = new Map();

  /**
   * Get or create rate limiter for an exchange
   */
  getLimiter(exchangeId: ExchangeId): ExchangeRateLimiter {
    let limiter = this.limiters.get(exchangeId);

    if (limiter === undefined) {
      limiter = new ExchangeRateLimiter(exchangeId);
      this.limiters.set(exchangeId, limiter);
    }

    return limiter;
  }

  /**
   * Acquire tokens for an exchange
   */
  async acquire(
    exchangeId: ExchangeId,
    tokens = 1,
    priority: Priority = 'normal'
  ): Promise<void> {
    const limiter = this.getLimiter(exchangeId);
    return limiter.acquire(tokens, priority);
  }

  /**
   * Get status for all limiters
   */
  getAllStatus(): RateLimiterStatus[] {
    return Array.from(this.limiters.values()).map((limiter) => limiter.getStatus());
  }

  /**
   * Reset all limiters
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }
}

// Singleton instance
let rateLimiterManager: RateLimiterManager | null = null;

/**
 * Get the global rate limiter manager
 */
export function getRateLimiterManager(): RateLimiterManager {
  rateLimiterManager ??= new RateLimiterManager();
  return rateLimiterManager;
}
