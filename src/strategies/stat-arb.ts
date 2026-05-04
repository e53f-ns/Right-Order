/**
 * Statistical Arbitrage Engine
 * Mean-reversion strategy using z-score on price spreads between exchanges
 * Detects when a spread deviates significantly from its historical mean
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('stat-arb');

// ============================================================================
// Types
// ============================================================================

export interface PriceEntry {
  exchange: string;
  symbol: string;
  price: number;
  timestamp: number;
}

export interface StatArbSignal {
  id: string;
  symbol: string;
  exchangeA: string;
  exchangeB: string;
  currentSpread: number;
  meanSpread: number;
  stdDev: number;
  zScore: number;
  direction: 'long_A_short_B' | 'long_B_short_A' | 'neutral';
  strength: 'weak' | 'moderate' | 'strong';
  expectedReversion: number;
  confidence: number;
  profitPotential: number;
  timestamp: number;
}

export interface StatArbConfig {
  windowSize: number;
  zScoreEntry: number;
  zScoreExit: number;
  minSamples: number;
  maxHoldingPeriodMs: number;
}

export interface StatArbStats {
  isRunning: boolean;
  signalCount: number;
  pairsTracked: number;
  scanCount: number;
  lastScan: number;
  strongSignals: number;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: StatArbConfig = {
  windowSize: 60,
  zScoreEntry: 2.0,
  zScoreExit: 0.5,
  minSamples: 5,
  maxHoldingPeriodMs: 3600000,
};


// ============================================================================
// State
// ============================================================================

interface SpreadHistory {
  exchangeA: string;
  exchangeB: string;
  symbol: string;
  spreads: number[];
  timestamps: number[];
}

interface StatArbState {
  isRunning: boolean;
  config: StatArbConfig;
  histories: Map<string, SpreadHistory>;
  signals: Map<string, StatArbSignal>;
  scanCount: number;
  lastScan: number;
}

const state: StatArbState = {
  isRunning: false,
  config: { ...DEFAULT_CONFIG },
  histories: new Map(),
  signals: new Map(),
  scanCount: 0,
  lastScan: 0,
};

// ============================================================================
// Math Helpers
// ============================================================================

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stddev(arr: number[], avg: number): number {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function spreadKey(symbol: string, exA: string, exB: string): string {
  const [a, b] = [exA, exB].sort();
  return `${symbol}__${a}__${b}`;
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Feed a price observation into the stat arb engine
 */
export function feedPrice(entry: PriceEntry): void {
  if (!state.isRunning) return;

  // Store latest price per exchange+symbol
  const priceKey = `${entry.exchange}:${entry.symbol}`;
  latestPrices.set(priceKey, entry);
}

const latestPrices = new Map<string, PriceEntry>();

/**
 * Feed price pair and compute spread
 */
export function feedPricePair(
  symbol: string,
  exchangeA: string,
  priceA: number,
  exchangeB: string,
  priceB: number,
  timestamp: number
): void {
  if (!state.isRunning) return;
  if (priceA <= 0 || priceB <= 0) return;

  const key = spreadKey(symbol, exchangeA, exchangeB);
  const existing = state.histories.get(key);

  if (!existing) {
    const sorted = [exchangeA, exchangeB].sort();
    const newHistory: SpreadHistory = {
      exchangeA: sorted[0] ?? exchangeA,
      exchangeB: sorted[1] ?? exchangeB,
      symbol,
      spreads: [Math.log(priceA / priceB)],
      timestamps: [timestamp],
    };
    state.histories.set(key, newHistory);
    return;
  }

  // Spread = log(priceA / priceB) — log spread is more stationary
  const spread = Math.log(priceA / priceB);
  existing.spreads.push(spread);
  existing.timestamps.push(timestamp);

  // Trim to window size
  if (existing.spreads.length > state.config.windowSize) {
    existing.spreads.shift();
    existing.timestamps.shift();
  }
}

/**
 * Compute signals for all tracked pairs
 */
export function computeSignals(): StatArbSignal[] {
  const now = Date.now();
  state.scanCount++;
  state.lastScan = now;

  const newSignals: StatArbSignal[] = [];

  for (const [key, history] of state.histories) {
    if (history.spreads.length < state.config.minSamples) continue;

    const avg = mean(history.spreads);
    const sd = stddev(history.spreads, avg);
    if (sd < 1e-10) continue; // No variance

    const currentSpread = history.spreads[history.spreads.length - 1]!;
    const zScore = (currentSpread - avg) / sd;

    let direction: StatArbSignal['direction'] = 'neutral';
    let strength: StatArbSignal['strength'] = 'weak';

    if (zScore > state.config.zScoreEntry) {
      direction = 'long_B_short_A'; // Spread too high — expect reversion down
      strength = zScore > 3 ? 'strong' : 'moderate';
    } else if (zScore < -state.config.zScoreEntry) {
      direction = 'long_A_short_B'; // Spread too low — expect reversion up
      strength = zScore < -3 ? 'strong' : 'moderate';
    }

    if (direction === 'neutral') continue;

    const expectedReversion = avg - currentSpread; // Expected move
    const confidence = Math.min(0.95, 0.5 + Math.abs(zScore) * 0.1);
    const profitPotential = Math.abs(expectedReversion) * 100; // As percentage

    const signal: StatArbSignal = {
      id: key,
      symbol: history.symbol,
      exchangeA: history.exchangeA,
      exchangeB: history.exchangeB,
      currentSpread,
      meanSpread: avg,
      stdDev: sd,
      zScore,
      direction,
      strength,
      expectedReversion,
      confidence,
      profitPotential,
      timestamp: now,
    };

    state.signals.set(key, signal);
    newSignals.push(signal);
  }

  if (state.scanCount % 10 === 0 || newSignals.length > 0) {
    const strong = newSignals.filter(s => s.strength === 'strong').length;
    logger.info(
      { scan: state.scanCount, pairs: state.histories.size, signals: newSignals.length, strong },
      `Stat arb scan #${state.scanCount}: ${newSignals.length} signals (${strong} strong)`
    );
  }

  return newSignals;
}

// ============================================================================
// Public API
// ============================================================================

export function startStatArb(config?: Partial<StatArbConfig>): void {
  if (state.isRunning) {
    logger.warn('Stat arb engine already running');
    return;
  }
  if (config) {
    state.config = { ...DEFAULT_CONFIG, ...config };
  }
  state.isRunning = true;
  logger.info({ config: state.config }, 'Statistical arbitrage engine started');
}

/**
 * Previously seeded the engine with synthetic mean-reverting spread data so
 * signals appeared immediately. Disabled — production must accumulate real
 * exchange data via bootstrapFromPrices() / live updates. The UI shows
 * "Coming soon" until real data has been collected.
 */
export function seedHistoricalData(): void {
  logger.info('Stat arb seeding disabled — waiting for real exchange data');
}

/**
 * Bootstrap spread history from OHLCV close prices.
 * Called with real exchange data to replace/augment seeded data.
 */
export function bootstrapFromPrices(
  symbol: string,
  exchangeA: string,
  pricesA: number[],
  exchangeB: string,
  pricesB: number[],
  startTimestamp: number,
  intervalMs: number
): void {
  if (!state.isRunning) return;
  const len = Math.min(pricesA.length, pricesB.length, state.config.windowSize);
  if (len < 3) return;

  const key = spreadKey(symbol, exchangeA, exchangeB);
  const sorted = [exchangeA, exchangeB].sort();
  const spreads: number[] = [];
  const timestamps: number[] = [];

  for (let i = 0; i < len; i++) {
    const pa = pricesA[i]!;
    const pb = pricesB[i]!;
    if (pa <= 0 || pb <= 0) continue;
    spreads.push(Math.log(pa / pb));
    timestamps.push(startTimestamp + i * intervalMs);
  }

  if (spreads.length >= state.config.minSamples) {
    state.histories.set(key, {
      exchangeA: sorted[0] ?? exchangeA,
      exchangeB: sorted[1] ?? exchangeB,
      symbol,
      spreads,
      timestamps,
    });
  }
}

/**
 * Force an immediate compute cycle (for manual refresh button)
 */
export function forceCompute(): StatArbSignal[] {
  return computeSignals();
}

export function stopStatArb(): void {
  state.isRunning = false;
  logger.info('Statistical arbitrage engine stopped');
}

export function getStatArbSignals(): StatArbSignal[] {
  return Array.from(state.signals.values())
    .filter(s => Date.now() - s.timestamp < state.config.maxHoldingPeriodMs)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

export function getStatArbStats(): StatArbStats {
  const signals = getStatArbSignals();
  return {
    isRunning: state.isRunning,
    signalCount: signals.length,
    pairsTracked: state.histories.size,
    scanCount: state.scanCount,
    lastScan: state.lastScan,
    strongSignals: signals.filter(s => s.strength === 'strong').length,
  };
}

export function isStatArbRunning(): boolean {
  return state.isRunning;
}

export function getStatArbPairsTracked(): number {
  return state.histories.size;
}
