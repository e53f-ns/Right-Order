/**
 * Funding Rates Monitor
 * Monitors perpetual funding rates from Binance, Bybit, OKX, and other exchanges
 * Calculates funding yield estimates and arbitrage opportunities
 */

import { createLogger } from '../utils/logger.js';
import { processFundingAlert } from '../telegram/telegram-bot.js';

const logger = createLogger('funding-rates');

// ============================================================================
// Types
// ============================================================================

export type FundingExchange = 'binance' | 'bybit' | 'okx' | 'bitget' | 'gateio' | 'kucoin';

export interface FundingRate {
  exchange: FundingExchange;
  symbol: string;
  rate: number;
  nextFundingTime: number;
  predictedRate: number;
  markPrice: number;
  indexPrice: number;
  openInterest: number;
  volume24h: number;
}

export interface FundingYield {
  symbol: string;
  exchange: FundingExchange;
  currentRate: number;
  annualizedYield: number;
  dailyYield: number;
  direction: 'long' | 'short';
  fundingInterval: number;
  nextFunding: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface FundingArbitrage {
  symbol: string;
  longExchange: FundingExchange;
  shortExchange: FundingExchange;
  longRate: number;
  shortRate: number;
  spreadRate: number;
  annualizedSpread: number;
  dailyProfit: number;
  confidence: number;
}

export interface FundingSnapshot {
  timestamp: number;
  rates: FundingRate[];
  yields: FundingYield[];
  arbitrages: FundingArbitrage[];
  topPositive: FundingRate[];
  topNegative: FundingRate[];
}

interface ExchangeConfig {
  name: string;
  fundingInterval: number;
  apiUrl: string;
  enabled: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const EXCHANGE_CONFIGS: Record<FundingExchange, ExchangeConfig> = {
  binance: {
    name: 'Binance',
    fundingInterval: 8,
    apiUrl: 'https://fapi.binance.com',
    enabled: true,
  },
  bybit: {
    name: 'Bybit',
    fundingInterval: 8,
    apiUrl: 'https://api.bybit.com',
    enabled: true,
  },
  okx: {
    name: 'OKX',
    fundingInterval: 8,
    apiUrl: 'https://www.okx.com',
    enabled: true,
  },
  bitget: {
    name: 'Bitget',
    fundingInterval: 8,
    apiUrl: 'https://api.bitget.com',
    enabled: true,
  },
  gateio: {
    name: 'Gate.io',
    fundingInterval: 8,
    apiUrl: 'https://api.gateio.ws',
    enabled: true,
  },
  kucoin: {
    name: 'KuCoin',
    fundingInterval: 8,
    apiUrl: 'https://api-futures.kucoin.com',
    enabled: true,
  },
};

const TOP_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
  'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'UNIUSDT', 'AAVEUSDT',
  'ARBUSDT', 'OPUSDT', 'APTUSDT', 'SUIUSDT', 'SEIUSDT',
];

const SCAN_INTERVAL_MS = 60000;
const MIN_RATE_THRESHOLD = 0.0001;

// ============================================================================
// State
// ============================================================================

interface FundingState {
  isRunning: boolean;
  lastScan: number;
  scanCount: number;
  rates: Map<string, FundingRate>;
  history: Map<string, number[]>;
  snapshot: FundingSnapshot | null;
}

const state: FundingState = {
  isRunning: false,
  lastScan: 0,
  scanCount: 0,
  rates: new Map(),
  history: new Map(),
  snapshot: null,
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch Binance funding rates
 */
async function fetchBinanceFunding(): Promise<FundingRate[]> {
  try {
    const [ratesRes, premiumRes] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/fundingRate?limit=100'),
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex'),
    ]);

    if (!ratesRes.ok || !premiumRes.ok) return [];

    const rates = await ratesRes.json() as Array<{
      symbol: string;
      fundingRate: string;
      fundingTime: number;
    }>;

    const premiums = await premiumRes.json() as Array<{
      symbol: string;
      markPrice: string;
      indexPrice: string;
      nextFundingTime: number;
      interestRate: string;
    }>;

    const premiumMap = new Map(premiums.map(p => [p.symbol, p]));
    const results: FundingRate[] = [];

    for (const rate of rates) {
      if (!TOP_SYMBOLS.includes(rate.symbol)) continue;
      const premium = premiumMap.get(rate.symbol);

      results.push({
        exchange: 'binance',
        symbol: rate.symbol,
        rate: parseFloat(rate.fundingRate),
        nextFundingTime: premium?.nextFundingTime || rate.fundingTime,
        predictedRate: parseFloat(premium?.interestRate || rate.fundingRate),
        markPrice: parseFloat(premium?.markPrice || '0'),
        indexPrice: parseFloat(premium?.indexPrice || '0'),
        openInterest: 0,
        volume24h: 0,
      });
    }

    return results;
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Binance funding fetch error');
    return [];
  }
}

/**
 * Fetch Bybit funding rates
 */
async function fetchBybitFunding(): Promise<FundingRate[]> {
  try {
    const response = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
    if (!response.ok) return [];

    const data = await response.json() as {
      result: {
        list: Array<{
          symbol: string;
          fundingRate: string;
          nextFundingTime: string;
          markPrice: string;
          indexPrice: string;
          openInterest: string;
          volume24h: string;
        }>;
      };
    };

    return (data.result?.list || [])
      .filter(t => TOP_SYMBOLS.includes(t.symbol))
      .map(t => ({
        exchange: 'bybit' as FundingExchange,
        symbol: t.symbol,
        rate: parseFloat(t.fundingRate),
        nextFundingTime: parseInt(t.nextFundingTime),
        predictedRate: parseFloat(t.fundingRate),
        markPrice: parseFloat(t.markPrice),
        indexPrice: parseFloat(t.indexPrice),
        openInterest: parseFloat(t.openInterest),
        volume24h: parseFloat(t.volume24h),
      }));
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Bybit funding fetch error');
    return [];
  }
}

/**
 * Fetch OKX funding rates
 */
async function fetchOkxFunding(): Promise<FundingRate[]> {
  try {
    const response = await fetch('https://www.okx.com/api/v5/public/funding-rate?instType=SWAP');
    if (!response.ok) return [];

    const data = await response.json() as {
      data: Array<{
        instId: string;
        fundingRate: string;
        nextFundingRate: string;
        nextFundingTime: string;
      }>;
    };

    return (data.data || [])
      .filter(t => {
        const symbol = t.instId.replace('-SWAP', '').replace('-', '');
        return TOP_SYMBOLS.includes(symbol + 'USDT') || TOP_SYMBOLS.includes(symbol);
      })
      .map(t => {
        const symbol = t.instId.replace('-SWAP', '').replace('-', '') + 'USDT';
        return {
          exchange: 'okx' as FundingExchange,
          symbol: symbol.replace('USDTUSDT', 'USDT'),
          rate: parseFloat(t.fundingRate),
          nextFundingTime: parseInt(t.nextFundingTime),
          predictedRate: parseFloat(t.nextFundingRate || t.fundingRate),
          markPrice: 0,
          indexPrice: 0,
          openInterest: 0,
          volume24h: 0,
        };
      });
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'OKX funding fetch error');
    return [];
  }
}

/**
 * Fetch Bitget funding rates
 */
async function fetchBitgetFunding(): Promise<FundingRate[]> {
  try {
    const response = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    if (!response.ok) return [];

    const data = await response.json() as {
      data: Array<{
        symbol: string;
        fundingRate: string;
        nextFundingTime: string;
        markPrice: string;
        indexPrice: string;
        openInterest: string;
        turnover24h: string;
      }>;
    };

    return (data.data || [])
      .filter(t => TOP_SYMBOLS.includes(t.symbol.replace('USDT', '') + 'USDT'))
      .map(t => ({
        exchange: 'bitget' as FundingExchange,
        symbol: t.symbol,
        rate: parseFloat(t.fundingRate),
        nextFundingTime: parseInt(t.nextFundingTime),
        predictedRate: parseFloat(t.fundingRate),
        markPrice: parseFloat(t.markPrice),
        indexPrice: parseFloat(t.indexPrice),
        openInterest: parseFloat(t.openInterest),
        volume24h: parseFloat(t.turnover24h),
      }));
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Bitget funding fetch error');
    return [];
  }
}

/**
 * Generate mock funding rates for testing
 */
function generateMockRates(): FundingRate[] {
  // Synthetic funding rates removed — return empty so the UI shows
  // "Coming soon / data unavailable" instead of fake numbers.
  return [];
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Calculate funding yield
 */
function calculateYield(rate: FundingRate): FundingYield {
  const config = EXCHANGE_CONFIGS[rate.exchange];
  const fundingsPerDay = 24 / config.fundingInterval;
  const dailyYield = rate.rate * fundingsPerDay * 100;
  const annualizedYield = dailyYield * 365;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (Math.abs(rate.rate) > 0.001) riskLevel = 'high';
  else if (Math.abs(rate.rate) > 0.0005) riskLevel = 'medium';

  return {
    symbol: rate.symbol,
    exchange: rate.exchange,
    currentRate: rate.rate,
    annualizedYield,
    dailyYield,
    direction: rate.rate >= 0 ? 'short' : 'long',
    fundingInterval: config.fundingInterval,
    nextFunding: rate.nextFundingTime,
    riskLevel,
  };
}

/**
 * Find funding arbitrage opportunities
 */
function findArbitrages(rates: FundingRate[]): FundingArbitrage[] {
  const arbitrages: FundingArbitrage[] = [];
  const bySymbol = new Map<string, FundingRate[]>();

  for (const rate of rates) {
    const existing = bySymbol.get(rate.symbol) || [];
    existing.push(rate);
    bySymbol.set(rate.symbol, existing);
  }

  for (const [symbol, symbolRates] of bySymbol) {
    if (symbolRates.length < 2) continue;

    const sorted = symbolRates.sort((a, b) => a.rate - b.rate);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];

    if (!lowest || !highest) continue;

    const spreadRate = highest.rate - lowest.rate;
    if (spreadRate < MIN_RATE_THRESHOLD) continue;

    const fundingsPerDay = 3;
    const dailyProfit = spreadRate * fundingsPerDay * 100;
    const annualizedSpread = dailyProfit * 365;

    const confidence = Math.min(0.9, 0.5 + (spreadRate / 0.001) * 0.2);

    arbitrages.push({
      symbol,
      longExchange: lowest.rate < 0 ? lowest.exchange : highest.exchange,
      shortExchange: highest.rate > 0 ? highest.exchange : lowest.exchange,
      longRate: lowest.rate,
      shortRate: highest.rate,
      spreadRate,
      annualizedSpread,
      dailyProfit,
      confidence,
    });
  }

  return arbitrages.sort((a, b) => b.spreadRate - a.spreadRate);
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Fetch all funding rates
 */
async function fetchAllRates(): Promise<FundingRate[]> {
  const [binance, bybit, okx, bitget] = await Promise.all([
    fetchBinanceFunding(),
    fetchBybitFunding(),
    fetchOkxFunding(),
    fetchBitgetFunding(),
  ]);

  const allRates = [...binance, ...bybit, ...okx, ...bitget];

  if (allRates.length === 0) {
    logger.info('No API data available, using mock rates');
    return generateMockRates();
  }

  return allRates;
}

/**
 * Run single scan
 */
async function runScan(): Promise<FundingSnapshot> {
  state.scanCount++;
  const startTime = Date.now();

  const rates = await fetchAllRates();

  for (const rate of rates) {
    const key = `${rate.exchange}:${rate.symbol}`;
    state.rates.set(key, rate);

    const history = state.history.get(key) || [];
    history.push(rate.rate);
    if (history.length > 24) history.shift();
    state.history.set(key, history);
  }

  const yields = rates.map(calculateYield);
  const arbitrages = findArbitrages(rates);

  const sortedByRate = [...rates].sort((a, b) => b.rate - a.rate);
  const topPositive = sortedByRate.filter(r => r.rate > 0).slice(0, 10);
  const topNegative = sortedByRate.filter(r => r.rate < 0).sort((a, b) => a.rate - b.rate).slice(0, 10);

  const snapshot: FundingSnapshot = {
    timestamp: Date.now(),
    rates,
    yields,
    arbitrages,
    topPositive,
    topNegative,
  };

  state.snapshot = snapshot;
  state.lastScan = Date.now();

  // Send Telegram alerts for high-APY funding arbs
  for (const arb of arbitrages) {
    if (arb.annualizedSpread >= 10) {
      processFundingAlert(arb).catch(err => {
        logger.debug({ error: err instanceof Error ? err.message : String(err) }, 'Funding alert error');
      });
    }
  }

  const scanTime = Date.now() - startTime;
  if (state.scanCount % 5 === 0 || state.scanCount === 1) {
    logger.info(
      { scan: state.scanCount, rates: rates.length, arbs: arbitrages.length, scanTimeMs: scanTime },
      `Funding scan #${state.scanCount}: ${rates.length} rates, ${arbitrages.length} arbitrages`
    );
  }

  return snapshot;
}

/**
 * Scan loop
 */
async function scanLoop(): Promise<void> {
  while (state.isRunning) {
    try {
      await runScan();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Funding scan error');
    }
    await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL_MS));
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start funding rate monitor
 */
export async function startFundingMonitor(): Promise<void> {
  if (state.isRunning) {
    logger.warn('Funding monitor already running');
    return;
  }

  logger.info(
    { exchanges: Object.keys(EXCHANGE_CONFIGS).filter(e => EXCHANGE_CONFIGS[e as FundingExchange].enabled) },
    'Starting funding rate monitor...'
  );

  state.isRunning = true;

  await runScan();

  logger.info('📊 Funding rate monitor started');

  scanLoop().catch(error => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Funding scan loop error');
    state.isRunning = false;
  });
}

/**
 * Stop funding monitor
 */
export function stopFundingMonitor(): void {
  logger.info('Stopping funding monitor...');
  state.isRunning = false;
}

/**
 * Get current snapshot
 */
export function getFundingSnapshot(): FundingSnapshot | null {
  return state.snapshot;
}

/**
 * Get rates for a specific symbol
 */
export function getSymbolRates(symbol: string): FundingRate[] {
  const rates: FundingRate[] = [];
  for (const [key, rate] of state.rates) {
    if (key.endsWith(`:${symbol}`)) {
      rates.push(rate);
    }
  }
  return rates;
}

/**
 * Get all current rates
 */
export function getAllRates(): FundingRate[] {
  return Array.from(state.rates.values());
}

/**
 * Get funding arbitrage opportunities
 */
export function getFundingArbitrages(): FundingArbitrage[] {
  return state.snapshot?.arbitrages || [];
}

/**
 * Get top positive/negative rates
 */
export function getTopRates(): { positive: FundingRate[]; negative: FundingRate[] } {
  return {
    positive: state.snapshot?.topPositive || [],
    negative: state.snapshot?.topNegative || [],
  };
}

/**
 * Get funding monitor stats
 */
export function getFundingStats(): {
  isRunning: boolean;
  scanCount: number;
  lastScan: number;
  rateCount: number;
  arbCount: number;
} {
  return {
    isRunning: state.isRunning,
    scanCount: state.scanCount,
    lastScan: state.lastScan,
    rateCount: state.rates.size,
    arbCount: state.snapshot?.arbitrages.length || 0,
  };
}

/**
 * Check if monitor is running
 */
export function isFundingMonitorRunning(): boolean {
  return state.isRunning;
}
