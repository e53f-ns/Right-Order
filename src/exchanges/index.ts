/**
 * Exchange layer module
 * Rate limiting, connection management, and circuit breaker
 */

// Types
export type {
  ConnectionState,
  ConnectionEventType,
  ConnectionEvent,
  OrderbookUpdateCallback,
  ConnectionEventCallback,
  ExchangeConnectionStatus,
  SubscriptionRequest,
  TokenRequest,
  RateLimiterStatus,
  CircuitBreakerMetrics,
  ConnectionManagerOptions,
  ExchangeCredentials,
  CcxtExchange,
  CcxtOrderbook,
} from './types.js';

export { DEFAULT_CONNECTION_OPTIONS } from './types.js';

// Rate limiter
export {
  ExchangeRateLimiter,
  RateLimiterManager,
  getRateLimiterManager,
} from './rate-limiter.js';

// Circuit breaker
export {
  ExchangeCircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerManager,
  getCircuitBreakerManager,
} from './circuit-breaker.js';

// Connection manager
export {
  ConnectionManager,
  getConnectionManager,
  getUnsupportedSymbols,
  clearUnsupportedSymbols,
} from './connection-manager.js';
