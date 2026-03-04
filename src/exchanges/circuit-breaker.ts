/**
 * Circuit breaker pattern implementation
 * Prevents cascading failures by temporarily disabling unhealthy exchanges
 */

import type { CircuitBreakerState, CircuitBreakerConfig, ExchangeId } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';

import type { CircuitBreakerMetrics } from './types.js';

const logger = createLogger('circuit-breaker');

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 60s reset for better stability
  halfOpenMaxAttempts: 3,
};

/**
 * Circuit breaker for a single exchange
 */
export class ExchangeCircuitBreaker {
  private readonly exchangeId: ExchangeId;
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private halfOpenAttempts = 0;
  private lastFailure: number | null = null;
  private lastSuccess: number | null = null;
  private lastStateChange: number;
  private totalFailures = 0;
  private totalSuccesses = 0;

  constructor(exchangeId: ExchangeId, config: Partial<CircuitBreakerConfig> = {}) {
    this.exchangeId = exchangeId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastStateChange = nowMs();
  }

  /**
   * Check if circuit allows requests
   */
  isAllowed(): boolean {
    this.checkStateTransition();

    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        return false;
      case 'half_open':
        return this.halfOpenAttempts < this.config.halfOpenMaxAttempts;
      default:
        return false;
    }
  }

  /**
   * Check and perform state transitions based on time
   */
  private checkStateTransition(): void {
    if (this.state === 'open') {
      const elapsed = nowMs() - this.lastStateChange;

      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo('half_open');
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = nowMs();

    if (newState === 'half_open') {
      this.halfOpenAttempts = 0;
    }

    if (newState === 'closed') {
      this.failureCount = 0;
    }

    logger.info(
      {
        exchangeId: this.exchangeId,
        oldState,
        newState,
        failureCount: this.failureCount,
        totalFailures: this.totalFailures,
      },
      'Circuit breaker state transition'
    );
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.successCount++;
    this.totalSuccesses++;
    this.lastSuccess = nowMs();

    switch (this.state) {
      case 'half_open':
        // Success in half-open state - close the circuit
        this.transitionTo('closed');
        break;
      case 'closed':
        // Reset failure count on success
        this.failureCount = 0;
        break;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(error?: Error): void {
    this.failureCount++;
    this.totalFailures++;
    this.lastFailure = nowMs();

    logger.warn(
      {
        exchangeId: this.exchangeId,
        state: this.state,
        failureCount: this.failureCount,
        threshold: this.config.failureThreshold,
        error: error?.message,
      },
      'Circuit breaker failure recorded'
    );

    switch (this.state) {
      case 'closed':
        if (this.failureCount >= this.config.failureThreshold) {
          this.transitionTo('open');
        }
        break;
      case 'half_open':
        // Any failure in half-open state reopens the circuit
        this.transitionTo('open');
        break;
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAllowed()) {
      throw new CircuitBreakerOpenError(
        `Circuit breaker open for ${this.exchangeId}`,
        this.exchangeId,
        this.getMetrics()
      );
    }

    if (this.state === 'half_open') {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Force the circuit to open state
   */
  forceOpen(): void {
    this.transitionTo('open');
    logger.warn({ exchangeId: this.exchangeId }, 'Circuit breaker forced open');
  }

  /**
   * Force the circuit to closed state
   */
  forceClose(): void {
    this.transitionTo('closed');
    logger.info({ exchangeId: this.exchangeId }, 'Circuit breaker forced closed');
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.lastStateChange = nowMs();

    logger.info({ exchangeId: this.exchangeId }, 'Circuit breaker reset');
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    this.checkStateTransition();

    return {
      exchangeId: this.exchangeId,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      lastStateChange: this.lastStateChange,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    this.checkStateTransition();
    return this.state;
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  readonly exchangeId: ExchangeId;
  readonly metrics: CircuitBreakerMetrics;

  constructor(message: string, exchangeId: ExchangeId, metrics: CircuitBreakerMetrics) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.exchangeId = exchangeId;
    this.metrics = metrics;
  }
}

/**
 * Manages circuit breakers for all exchanges
 */
export class CircuitBreakerManager {
  private readonly breakers: Map<ExchangeId, ExchangeCircuitBreaker> = new Map();
  private readonly config: Partial<CircuitBreakerConfig>;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = config;
  }

  /**
   * Get or create circuit breaker for an exchange
   */
  getBreaker(exchangeId: ExchangeId): ExchangeCircuitBreaker {
    let breaker = this.breakers.get(exchangeId);

    if (breaker === undefined) {
      breaker = new ExchangeCircuitBreaker(exchangeId, this.config);
      this.breakers.set(exchangeId, breaker);
    }

    return breaker;
  }

  /**
   * Check if an exchange is allowed (circuit closed or half-open)
   */
  isAllowed(exchangeId: ExchangeId): boolean {
    return this.getBreaker(exchangeId).isAllowed();
  }

  /**
   * Record success for an exchange
   */
  recordSuccess(exchangeId: ExchangeId): void {
    this.getBreaker(exchangeId).recordSuccess();
  }

  /**
   * Record failure for an exchange
   */
  recordFailure(exchangeId: ExchangeId, error?: Error): void {
    this.getBreaker(exchangeId).recordFailure(error);
  }

  /**
   * Execute with circuit breaker protection
   */
  async execute<T>(exchangeId: ExchangeId, fn: () => Promise<T>): Promise<T> {
    return this.getBreaker(exchangeId).execute(fn);
  }

  /**
   * Get all healthy exchanges (circuit not open)
   */
  getHealthyExchanges(): ExchangeId[] {
    const healthy: ExchangeId[] = [];

    for (const [exchangeId, breaker] of this.breakers) {
      if (breaker.isAllowed()) {
        healthy.push(exchangeId);
      }
    }

    return healthy;
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): CircuitBreakerMetrics[] {
    return Array.from(this.breakers.values()).map((breaker) => breaker.getMetrics());
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }

    logger.info('All circuit breakers reset');
  }
}

// Singleton instance
let circuitBreakerManager: CircuitBreakerManager | null = null;

/**
 * Get the global circuit breaker manager
 */
export function getCircuitBreakerManager(
  config?: Partial<CircuitBreakerConfig>
): CircuitBreakerManager {
  circuitBreakerManager ??= new CircuitBreakerManager(config);
  return circuitBreakerManager;
}
