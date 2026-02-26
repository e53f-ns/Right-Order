/**
 * Futures Arbitrage Strategy
 * Computes spot-futures basis from mark/index prices + perpetual funding rates
 * Identifies contango/backwardation opportunities across exchanges
 */

import { createLogger } from '../utils/logger.js';
import { processFuturesAlert } from '../telegram/telegram-bot.js';
import {
  getAllRates,
  startFundingMonitor,
  isFundingMonitorRunning,
  type FundingExchange,
} from '../analysis/funding-rates.js';

const logger = createLogger('futures-arb');

// ============================================================================
// Types
// ============================================================================

export interface FuturesArbSignal {
  id: string;
  symbol: string;
  exchange: FundingExchange;
  spotPrice: number;       // indexPrice (spot)
  futuresPrice: number;    // markPrice (perp futures)
  basisPercent: number;    // (futures - spot) / spot * 100
  basisAnnualized: number; // annualized basis
  fundingRate: number;     // current 8h funding rate
  fundingApy: number;      // annualized funding yield
  combinedApy: number;     // basis APY + funding APY (total carry)
  direction: 'long_basis' | 'short_basis'; // contango = short basis (sell futures, buy spot)
  regime: 'contango' | 'backwardation';
  confidence: number;
  openInterest: number;
  volume24h: number;
  nextFundingTime: number;
  timestamp: number;
}

export interface FuturesArbStats {
  isRunning: boolean;
  signalCount: number;
  lastScan: number;
  scanCount: number;
  avgBasis: number;
  bestBasis: number;
}

// ============================================================================
// State
// ============================================================================

interface FuturesArbState {
  isRunning: boolean;
  signals: FuturesArbSignal[];
  lastScan: number;
  scanCount: number;
  intervalId: ReturnType<typeof setInterval> | null;
}

const state: FuturesArbState = {
  isRunning: false,
  signals: [],
  lastScan: 0,
  scanCount: 0,
  intervalId: null,
};

const SCAN_INTERVAL_MS = 60_000; // 1 minute
const MIN_BASIS_THRESHOLD = 0.005; // 0.005% minimum basis to show

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Compute futures arb signals from existing funding rate data.
 * Each FundingRate has markPrice (futures) and indexPrice (spot).
 */
function computeSignals(): FuturesArbSignal[] {
  const rates = getAllRates();
  if (rates.length === 0) {
    logger.debug('No funding rates available for futures arb computation');
    return [];
  }

  const signals: FuturesArbSignal[] = [];
  const now = Date.now();

  for (const rate of rates) {
    // Need both prices for basis calc
    if (rate.markPrice <= 0 || rate.indexPrice <= 0) continue;

    const spotPrice = rate.indexPrice;
    const futuresPrice = rate.markPrice;
    const basisPercent = ((futuresPrice - spotPrice) / spotPrice) * 100;

    // Skip noise
    if (Math.abs(basisPercent) < MIN_BASIS_THRESHOLD) continue;

    // Annualize: basis is current instant premium, assume it reverts over ~30 days
    // More conservative than simple *365
    const basisAnnualized = basisPercent * 12; // ~monthly reversion → *12

    // Funding APY: rate is per-period (8h), 3 periods/day, *365
    const fundingApy = rate.rate * 3 * 365 * 100;

    // Combined carry = basis annualized + funding APY
    // For a short-basis trade (sell futures, buy spot):
    //   earn basis convergence + earn funding if rate > 0
    const combinedApy = Math.abs(basisAnnualized) + Math.abs(fundingApy);

    const regime = basisPercent > 0 ? 'contango' : 'backwardation';
    // Contango → short basis (sell futures, buy spot) is profitable
    // Backwardation → long basis (buy futures, sell spot) is profitable
    const direction = regime === 'contango' ? 'short_basis' : 'long_basis';

    // Confidence: higher basis + higher OI + higher volume = more confident
    let confidence = 0.5;
    if (Math.abs(basisPercent) > 0.05) confidence += 0.1;
    if (Math.abs(basisPercent) > 0.1) confidence += 0.1;
    if (rate.openInterest > 100_000_000) confidence += 0.1;
    if (rate.volume24h > 500_000_000) confidence += 0.1;
    if (Math.abs(rate.rate) > 0.0003) confidence += 0.05;
    confidence = Math.min(0.95, Math.max(0.1, confidence));

    signals.push({
      id: `${rate.exchange}-${rate.symbol}-${now}`,
      symbol: rate.symbol,
      exchange: rate.exchange,
      spotPrice,
      futuresPrice,
      basisPercent,
      basisAnnualized,
      fundingRate: rate.rate,
      fundingApy,
      combinedApy,
      direction,
      regime,
      confidence,
      openInterest: rate.openInterest,
      volume24h: rate.volume24h,
      nextFundingTime: rate.nextFundingTime,
      timestamp: now,
    });
  }

  // Sort by absolute combined APY descending
  signals.sort((a, b) => Math.abs(b.combinedApy) - Math.abs(a.combinedApy));

  return signals;
}

/**
 * Run a single scan
 */
function runScan(): void {
  state.scanCount++;
  const signals = computeSignals();
  state.signals = signals;
  state.lastScan = Date.now();

  // Send Telegram alerts for high combined APY signals
  for (const sig of signals) {
    if (Math.abs(sig.combinedApy) >= 5) {
      processFuturesAlert(sig).catch(err => {
        logger.debug({ error: err instanceof Error ? err.message : String(err) }, 'Futures alert error');
      });
    }
  }

  if (state.scanCount % 5 === 0 || state.scanCount === 1) {
    const avgBasis = signals.length > 0
      ? signals.reduce((sum, s) => sum + Math.abs(s.basisPercent), 0) / signals.length
      : 0;
    logger.info(
      { scan: state.scanCount, signals: signals.length, avgBasis: avgBasis.toFixed(4) },
      `Futures arb scan #${state.scanCount}: ${signals.length} signals, avg basis ${avgBasis.toFixed(4)}%`
    );
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start futures arb scanner.
 * Depends on funding monitor — starts it if not running.
 */
export async function startFuturesArb(): Promise<void> {
  if (state.isRunning) {
    logger.warn('Futures arb scanner already running');
    return;
  }

  // Ensure funding monitor is running (provides mark/index prices)
  if (!isFundingMonitorRunning()) {
    logger.info('Starting funding monitor for futures arb data...');
    await startFundingMonitor();
  }

  state.isRunning = true;
  runScan();

  state.intervalId = setInterval(() => {
    try {
      runScan();
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Futures arb scan error');
    }
  }, SCAN_INTERVAL_MS);

  logger.info('📈 Futures arbitrage scanner started');
}

/**
 * Stop scanner
 */
export function stopFuturesArb(): void {
  if (state.intervalId) clearInterval(state.intervalId);
  state.intervalId = null;
  state.isRunning = false;
  logger.info('Futures arb scanner stopped');
}

/**
 * Check if running
 */
export function isFuturesArbRunning(): boolean {
  return state.isRunning;
}

/**
 * Get current signals
 */
export function getFuturesArbSignals(): FuturesArbSignal[] {
  return state.signals;
}

/**
 * Get stats
 */
export function getFuturesArbStats(): FuturesArbStats {
  const signals = state.signals;
  const avgBasis = signals.length > 0
    ? signals.reduce((sum, s) => sum + Math.abs(s.basisPercent), 0) / signals.length
    : 0;
  const bestBasis = signals.length > 0
    ? Math.max(...signals.map(s => Math.abs(s.basisPercent)))
    : 0;

  return {
    isRunning: state.isRunning,
    signalCount: signals.length,
    lastScan: state.lastScan,
    scanCount: state.scanCount,
    avgBasis,
    bestBasis,
  };
}
