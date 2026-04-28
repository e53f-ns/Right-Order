/**
 * Real orderbook fetching service with TTL cache
 * Replaces simulated Math.random() orderbook data
 */

import type { ExchangeId } from '../config/schema.js';
import { getConnectionManager } from '../exchanges/connection-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('orderbook-service');

export interface OrderbookLevel {
  price: number;
  amount: number;
  total: number;
}

export interface OrderbookResult {
  asks: OrderbookLevel[];
  bids: OrderbookLevel[];
  timestamp: number;
  realtime: boolean;
}

const CACHE_TTL_MS = 5000;
interface CacheEntry { data: OrderbookResult; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

function getCacheKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

function getFromCache(key: string): OrderbookResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key: string, data: OrderbookResult): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) { if (now > v.expiresAt) cache.delete(k); }
  }
}

export async function fetchOrderbook(
  exchangeName: string, symbol: string, limit = 10,
): Promise<OrderbookResult | null> {
  const cacheKey = getCacheKey(exchangeName, symbol);
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const cm = getConnectionManager();
    const instances = cm.getExchangeInstances();
    const exchange = instances.get(exchangeName as ExchangeId);
    if (!exchange) { logger.debug({ exchange: exchangeName }, 'Exchange not available'); return null; }

    const ob = await exchange.fetchOrderBook(symbol, limit);
    const asks: OrderbookLevel[] = (ob.asks ?? []).slice(0, limit).map(([p, a]) => {
      const price = p ?? 0; const amount = a ?? 0;
      return { price: +price.toFixed(6), amount: +amount.toFixed(4), total: +(price * amount).toFixed(2) };
    });
    const bids: OrderbookLevel[] = (ob.bids ?? []).slice(0, limit).map(([p, a]) => {
      const price = p ?? 0; const amount = a ?? 0;
      return { price: +price.toFixed(6), amount: +amount.toFixed(4), total: +(price * amount).toFixed(2) };
    });

    const result: OrderbookResult = { asks, bids, timestamp: ob.timestamp ?? Date.now(), realtime: true };
    setCache(cacheKey, result);
    return result;
  } catch (err: unknown) {
    logger.warn({ exchange: exchangeName, symbol, error: err instanceof Error ? err.message : String(err) }, 'Failed to fetch orderbook');
    return null;
  }
}

export function emptyOrderbook(): OrderbookResult {
  return { asks: [], bids: [], timestamp: Date.now(), realtime: false };
}

logger.info('Orderbook service initialized');
