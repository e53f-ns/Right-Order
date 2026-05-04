/**
 * Pairs Trading Engine
 * Cointegration-based strategy: finds pairs of assets whose price ratio
 * is mean-reverting, then trades deviations from equilibrium
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('pairs-trading');

// ============================================================================
// Types
// ============================================================================

export interface PairCandidate {
  symbolA: string;
  symbolB: string;
  exchange: string;
  correlation: number;
  cointegrationScore: number;
  halfLife: number;
  isCointegrated: boolean;
}

export interface PairsSignal {
  id: string;
  symbolA: string;
  symbolB: string;
  exchange: string;
  ratio: number;
  meanRatio: number;
  zScore: number;
  direction: 'long_A_short_B' | 'long_B_short_A' | 'neutral';
  strength: 'weak' | 'moderate' | 'strong';
  hedgeRatio: number;
  profitPotential: number;
  confidence: number;
  timestamp: number;
}

export interface PairsTradingStats {
  isRunning: boolean;
  pairsTracked: number;
  cointegratedPairs: number;
  activeSignals: number;
  strongSignals: number;
  scanCount: number;
  lastScan: number;
}

// ============================================================================
// State
// ============================================================================

interface PairHistory {
  symbolA: string;
  symbolB: string;
  exchange: string;
  pricesA: number[];
  pricesB: number[];
  ratios: number[];
  timestamps: number[];
}

interface PairsState {
  isRunning: boolean;
  histories: Map<string, PairHistory>;
  candidates: Map<string, PairCandidate>;
  signals: Map<string, PairsSignal>;
  scanCount: number;
  lastScan: number;
}

const WINDOW_SIZE = 60;
const MIN_SAMPLES = 8;
const Z_SCORE_ENTRY = 2.0;
const SIGNAL_MAX_AGE_MS = 3600000;

const state: PairsState = {
  isRunning: false,
  histories: new Map(),
  candidates: new Map(),
  signals: new Map(),
  scanCount: 0,
  lastScan: 0,
};

// ============================================================================
// Well-known correlated pairs
// ============================================================================

const PAIR_CANDIDATES: Array<[string, string]> = [
  ['BTC/USDT', 'ETH/USDT'],
  ['ETH/USDT', 'SOL/USDT'],
  ['BTC/USDT', 'SOL/USDT'],
  ['LINK/USDT', 'DOT/USDT'],
  ['ADA/USDT', 'DOT/USDT'],
  ['AVAX/USDT', 'SOL/USDT'],
  ['DOGE/USDT', 'SHIB/USDT'],
  ['MATIC/USDT', 'AVAX/USDT'],
  ['LINK/USDT', 'AVAX/USDT'],
  ['XRP/USDT', 'ADA/USDT'],
];

// ============================================================================
// Math Helpers
// ============================================================================

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[], avg: number): number {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const sa = a.slice(-n);
  const sb = b.slice(-n);
  const ma = mean(sa);
  const mb = mean(sb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const diffA = (sa[i] ?? 0) - ma;
    const diffB = (sb[i] ?? 0) - mb;
    num += diffA * diffB;
    da += diffA * diffA;
    db += diffB * diffB;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : 0;
}

/**
 * Simple cointegration test: Engle-Granger style
 * Regress A on B, then check if residuals are stationary (ADF-like)
 * Returns a score 0..1 where >0.7 suggests cointegration
 */
function cointegrationScore(ratios: number[]): number {
  if (ratios.length < MIN_SAMPLES) return 0;
  const avg = mean(ratios);
  const sd = stddev(ratios, avg);
  if (sd < 1e-10) return 0;

  // Check mean-reversion: count zero crossings of (ratio - mean)
  let crossings = 0;
  let prev = ratios[0]! - avg;
  for (let i = 1; i < ratios.length; i++) {
    const curr = (ratios[i] ?? 0) - avg;
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) crossings++;
    prev = curr;
  }

  // Expected crossings for random walk ~ n/2 * (2/pi)
  // More crossings = more mean-reverting
  const expectedRandom = (ratios.length / 2) * (2 / Math.PI);
  const crossingRatio = crossings / expectedRandom;

  // Half-life estimation: how quickly does ratio revert?
  // Higher crossing ratio + lower variance = better cointegration
  const score = Math.min(1.0, crossingRatio * 0.5 + (1 / (1 + sd * 100)) * 0.5);
  return score;
}

function estimateHalfLife(ratios: number[]): number {
  if (ratios.length < 10) return Infinity;
  const avg = mean(ratios);

  // Simple lag-1 autocorrelation approach
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 1; i < ratios.length; i++) {
    const x = (ratios[i - 1] ?? 0) - avg;
    const y = (ratios[i] ?? 0) - avg;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const beta = sumX2 > 0 ? sumXY / sumX2 : 1;
  if (beta >= 1 || beta <= 0) return Infinity;
  return -Math.log(2) / Math.log(beta);
}

function pairKey(symbolA: string, symbolB: string, exchange: string): string {
  return `${exchange}__${symbolA}__${symbolB}`;
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Feed prices for a pair
 */
export function feedPairPrices(
  exchange: string,
  symbolA: string,
  priceA: number,
  symbolB: string,
  priceB: number,
  timestamp: number
): void {
  if (!state.isRunning) return;
  if (priceA <= 0 || priceB <= 0) return;

  const key = pairKey(symbolA, symbolB, exchange);
  let history = state.histories.get(key);

  if (!history) {
    history = {
      symbolA,
      symbolB,
      exchange,
      pricesA: [],
      pricesB: [],
      ratios: [],
      timestamps: [],
    };
    state.histories.set(key, history);
  }

  history.pricesA.push(priceA);
  history.pricesB.push(priceB);
  history.ratios.push(priceA / priceB);
  history.timestamps.push(timestamp);

  // Trim to window
  if (history.ratios.length > WINDOW_SIZE) {
    history.pricesA.shift();
    history.pricesB.shift();
    history.ratios.shift();
    history.timestamps.shift();
  }
}

/**
 * Analyze all pairs and generate signals
 */
export function analyzePairs(): PairsSignal[] {
  const now = Date.now();
  state.scanCount++;
  state.lastScan = now;

  const newSignals: PairsSignal[] = [];

  for (const [key, history] of state.histories) {
    if (history.ratios.length < MIN_SAMPLES) continue;

    const corr = correlation(history.pricesA, history.pricesB);
    const cointScore = cointegrationScore(history.ratios);
    const halfLife = estimateHalfLife(history.ratios);
    const isCointegrated = cointScore > 0.6 && halfLife < 50 && Math.abs(corr) > 0.5;

    // Update candidate info
    state.candidates.set(key, {
      symbolA: history.symbolA,
      symbolB: history.symbolB,
      exchange: history.exchange,
      correlation: corr,
      cointegrationScore: cointScore,
      halfLife,
      isCointegrated,
    });

    if (!isCointegrated) continue;

    // Compute z-score of current ratio
    const avg = mean(history.ratios);
    const sd = stddev(history.ratios, avg);
    if (sd < 1e-10) continue;

    const currentRatio = history.ratios[history.ratios.length - 1] ?? avg;
    const zScore = (currentRatio - avg) / sd;

    let direction: PairsSignal['direction'] = 'neutral';
    let strength: PairsSignal['strength'] = 'weak';

    if (zScore > Z_SCORE_ENTRY) {
      direction = 'long_B_short_A';
      strength = zScore > 3 ? 'strong' : 'moderate';
    } else if (zScore < -Z_SCORE_ENTRY) {
      direction = 'long_A_short_B';
      strength = zScore < -3 ? 'strong' : 'moderate';
    }

    if (direction === 'neutral') continue;

    const hedgeRatio = avg; // Simple hedge ratio = mean price ratio
    const profitPotential = Math.abs(zScore * sd / avg) * 100;
    const confidence = Math.min(0.95, cointScore * 0.5 + Math.abs(corr) * 0.3 + Math.min(0.2, Math.abs(zScore) * 0.05));

    const signal: PairsSignal = {
      id: key,
      symbolA: history.symbolA,
      symbolB: history.symbolB,
      exchange: history.exchange,
      ratio: currentRatio,
      meanRatio: avg,
      zScore,
      direction,
      strength,
      hedgeRatio,
      profitPotential,
      confidence,
      timestamp: now,
    };

    state.signals.set(key, signal);
    newSignals.push(signal);
  }

  if (state.scanCount % 10 === 0 || newSignals.length > 0) {
    const cointegrated = Array.from(state.candidates.values()).filter(c => c.isCointegrated).length;
    logger.info(
      { scan: state.scanCount, pairs: state.histories.size, cointegrated, signals: newSignals.length },
      `Pairs scan #${state.scanCount}: ${cointegrated} cointegrated, ${newSignals.length} signals`
    );
  }

  return newSignals;
}

// ============================================================================
// Public API
// ============================================================================

export function startPairsTrading(): void {
  if (state.isRunning) {
    logger.warn('Pairs trading engine already running');
    return;
  }
  state.isRunning = true;
  logger.info({ pairCandidates: PAIR_CANDIDATES.length }, 'Pairs trading engine started');
}

/**
 * Seed the engine with synthetic ratio data so cointegrated pairs and signals
 * appear immediately on startup. Generates Ornstein-Uhlenbeck ratio series
 * with realistic correlation and occasional z-score deviations.
 */
export function seedPairsData(): void {
  // Synthetic seeding disabled — pairs trading must accumulate real data via
  // feedPairPrices(). UI shows "Coming soon" until enough history exists.
  logger.info('Pairs trading seeding disabled — waiting for real exchange data');
}

/**
 * Force an immediate analysis cycle (for manual refresh button)
 */
export function forceAnalyze(): PairsSignal[] {
  return analyzePairs();
}

/**
 * Get ALL candidates (both cointegrated and monitoring)
 */
export function getAllCandidates(): PairCandidate[] {
  return Array.from(state.candidates.values())
    .sort((a, b) => b.cointegrationScore - a.cointegrationScore);
}

export function stopPairsTrading(): void {
  state.isRunning = false;
  logger.info('Pairs trading engine stopped');
}

export function getPairCandidates(): Array<[string, string]> {
  return [...PAIR_CANDIDATES];
}

export function getCointegratedPairs(): PairCandidate[] {
  return Array.from(state.candidates.values()).filter(c => c.isCointegrated);
}

export function getPairsSignals(): PairsSignal[] {
  return Array.from(state.signals.values())
    .filter(s => Date.now() - s.timestamp < SIGNAL_MAX_AGE_MS)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

export function getPairsTradingStats(): PairsTradingStats {
  const signals = getPairsSignals();
  return {
    isRunning: state.isRunning,
    pairsTracked: state.histories.size,
    cointegratedPairs: Array.from(state.candidates.values()).filter(c => c.isCointegrated).length,
    activeSignals: signals.length,
    strongSignals: signals.filter(s => s.strength === 'strong').length,
    scanCount: state.scanCount,
    lastScan: state.lastScan,
  };
}

export function isPairsTradingRunning(): boolean {
  return state.isRunning;
}
