/**
 * CEX-DEX Arbitrage Detector
 * Detects arbitrage opportunities between centralized and decentralized exchanges
 */

import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

import { createLogger } from '../utils/logger.js';
import { getDashboardStore } from '../dashboard/index.js';
import {
  fetchAllPools,
  getGasPrice,
  updateGasTokenPrices,
  type SimpleDexPool,
} from './price-fetcher.js';
import {
  DEX_SCANNER_DEFAULTS,
  getActiveChains,
} from './config.js';
import type { ChainId, CexDexOpportunity } from './types.js';

const logger = createLogger('cex-dex-detector');

/**
 * CEX price cache (updated from orderbook aggregator)
 */
interface CexPriceCache {
  prices: Map<string, { bid: number; ask: number; timestamp: number }>;
  lastUpdate: number;
}

const cexPriceCache: CexPriceCache = {
  prices: new Map(),
  lastUpdate: 0,
};

/**
 * DEX scanner state
 */
interface DexScannerState {
  isRunning: boolean;
  lastScanAt: number;
  totalScans: number;
  opportunitiesFound: number;
  pools: SimpleDexPool[];
  gasEstimates: Map<ChainId, number>; // USD cost per swap
}

const state: DexScannerState = {
  isRunning: false,
  lastScanAt: 0,
  totalScans: 0,
  opportunitiesFound: 0,
  pools: [],
  gasEstimates: new Map(),
};

/**
 * Dashboard integration
 */
let dashboardEnabled = false;
let dashboardStore: ReturnType<typeof getDashboardStore> | null = null;

export function enableDexDashboard(): void {
  dashboardEnabled = true;
  dashboardStore = getDashboardStore();
  logger.info('Dashboard integration enabled for DEX scanner');
}

/**
 * Update CEX prices from orderbook data
 */
export function updateCexPrices(
  symbol: string,
  bid: number,
  ask: number
): void {
  cexPriceCache.prices.set(symbol, {
    bid,
    ask,
    timestamp: Date.now(),
  });
  cexPriceCache.lastUpdate = Date.now();
}

/**
 * Get CEX price for a symbol
 */
function getCexPrice(symbol: string): { bid: number; ask: number } | null {
  const cached = cexPriceCache.prices.get(symbol);
  if (!cached) return null;
  
  // Stale check (60 seconds)
  if (Date.now() - cached.timestamp > 60000) {
    return null;
  }
  
  return { bid: cached.bid, ask: cached.ask };
}

/**
 * Map DEX pool tokens to CEX symbol
 */
function poolToCexSymbol(pool: SimpleDexPool): string | null {
  const { token0, token1 } = pool;
  
  // Common mappings
  const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'UST'];
  const wrappedNative: Record<string, string> = {
    'WETH': 'ETH',
    'WBNB': 'BNB',
    'WMATIC': 'MATIC',
    'WAVAX': 'AVAX',
  };
  
  let base = token0.symbol;
  let quote = token1.symbol;
  
  // Unwrap native tokens
  const unwrappedBase = wrappedNative[base];
  const unwrappedQuote = wrappedNative[quote];
  if (unwrappedBase) base = unwrappedBase;
  if (unwrappedQuote) quote = unwrappedQuote;
  
  // If quote is a stablecoin, format as BASE/QUOTE
  if (stablecoins.includes(quote)) {
    return `${base}/${quote}`;
  }
  
  // If base is a stablecoin, swap
  if (stablecoins.includes(base)) {
    return `${quote}/${base}`;
  }
  
  // Default: token0/token1
  return `${base}/${quote}`;
}

/**
 * Calculate DEX price from pool reserves
 */
function calculateDexPrice(pool: SimpleDexPool): number {
  const reserve0 = parseFloat(pool.reserve0);
  const reserve1 = parseFloat(pool.reserve1);
  
  if (reserve0 === 0 || reserve1 === 0) return 0;
  
  // Price = reserve1 / reserve0 (token0 priced in token1)
  return reserve1 / reserve0;
}

/**
 * Calculate arbitrage opportunity
 */
function calculateOpportunity(
  pool: SimpleDexPool,
  cexPrice: { bid: number; ask: number },
  gasEstimateUsd: number
): CexDexOpportunity | null {
  const dexPrice = calculateDexPrice(pool);
  if (dexPrice === 0) return null;
  
  const cexSymbol = poolToCexSymbol(pool);
  if (!cexSymbol) return null;
  
  const tradeSizeUsd = DEX_SCANNER_DEFAULTS.tradeSizeUsd;
  const dexFeePercent = pool.fee;
  const cexFeePercent = 0.075; // VIP fee
  
  // Direction 1: Buy on CEX, Sell on DEX
  // CEX ask < DEX price → profit
  const cexToDexGross = new Decimal(dexPrice)
    .minus(cexPrice.ask)
    .div(cexPrice.ask)
    .times(100);
  
  // Direction 2: Buy on DEX, Sell on CEX
  // DEX price < CEX bid → profit
  const dexToCexGross = new Decimal(cexPrice.bid)
    .minus(dexPrice)
    .div(dexPrice)
    .times(100);
  
  // Calculate costs
  const totalFees = new Decimal(dexFeePercent).plus(cexFeePercent);
  const gasCostPercent = new Decimal(gasEstimateUsd).div(tradeSizeUsd).times(100);
  const slippagePercent = new Decimal(DEX_SCANNER_DEFAULTS.maxSlippagePercent);
  const totalCosts = totalFees.plus(gasCostPercent).plus(slippagePercent);
  
  // Determine best direction
  let direction: 'cex_to_dex' | 'dex_to_cex';
  let grossPercent: Decimal;
  let cexSide: 'buy' | 'sell';
  let dexSide: 'buy' | 'sell';
  
  if (cexToDexGross.greaterThan(dexToCexGross)) {
    direction = 'cex_to_dex';
    grossPercent = cexToDexGross;
    cexSide = 'buy';
    dexSide = 'sell';
  } else {
    direction = 'dex_to_cex';
    grossPercent = dexToCexGross;
    cexSide = 'sell';
    dexSide = 'buy';
  }
  
  const netPercent = grossPercent.minus(totalCosts);
  const profitUsd = netPercent.div(100).times(tradeSizeUsd);
  
  // Skip if below threshold
  if (netPercent.lessThan(DEX_SCANNER_DEFAULTS.minProfitPercent)) {
    return null;
  }
  
  // Executable: net > 0 and sufficient liquidity
  const isExecutable = netPercent.greaterThan(0) && 
    pool.reserveUsd >= tradeSizeUsd * 2;
  
  return {
    id: uuidv4(),
    type: 'cex_dex',
    direction,
    symbol: cexSymbol,
    
    cexExchange: 'aggregated', // From CEX aggregator
    cexPrice: cexSide === 'buy' ? cexPrice.ask : cexPrice.bid,
    cexSide,
    
    dex: pool.dex,
    chain: pool.chain,
    poolAddress: pool.address,
    dexPrice,
    dexSide,
    
    grossPercent: grossPercent.toNumber(),
    netPercent: netPercent.toNumber(),
    profitUsd: profitUsd.toNumber(),
    
    cexFeePercent,
    dexFeePercent,
    gasEstimateUsd,
    slippagePercent: slippagePercent.toNumber(),
    
    liquidityUsd: pool.reserveUsd,
    // Constant-product (x*y=k) approximation: dx swapped against reserve R
    // moves price by ~ dx / (R + dx). Expressed as a percentage of pool TVL
    // halves (single-side reserve ≈ reserveUsd / 2). Returns null when we
    // can't estimate (zero/negative reserves).
    priceImpact: pool.reserveUsd > 0
      ? +((tradeSizeUsd / (pool.reserveUsd / 2 + tradeSizeUsd)) * 100).toFixed(4)
      : 0,
    
    confidence: isExecutable ? 0.8 : 0.5,
    executable: isExecutable,
    timestamp: Date.now() as any,
    issues: [],
  };
}

/**
 * Push opportunity to dashboard
 */
function pushToDashboard(opp: CexDexOpportunity): void {
  if (!dashboardEnabled || !dashboardStore) return;
  
  dashboardStore.addSpread({
    type: 'simple', // Reuse simple type for now
    symbol: opp.symbol,
    buyExchange: opp.cexSide === 'buy' ? opp.cexExchange : `${opp.dex}(${opp.chain})`,
    sellExchange: opp.cexSide === 'sell' ? opp.cexExchange : `${opp.dex}(${opp.chain})`,
    buyPrice: opp.cexSide === 'buy' ? opp.cexPrice : opp.dexPrice,
    sellPrice: opp.cexSide === 'sell' ? opp.cexPrice : opp.dexPrice,
    grossPercent: opp.grossPercent,
    netPercent: opp.netPercent,
    profitUsd: opp.profitUsd,
    depthUsd: opp.liquidityUsd,
    confidence: opp.confidence,
    fees: opp.cexFeePercent + opp.dexFeePercent + opp.gasEstimateUsd / DEX_SCANNER_DEFAULTS.tradeSizeUsd * 100,
    slippage: opp.slippagePercent,
    executable: opp.executable,
  });
  
  if (opp.executable) {
    logger.info(
      {
        symbol: opp.symbol,
        direction: opp.direction,
        net: opp.netPercent.toFixed(3),
        profit: opp.profitUsd.toFixed(2),
        dex: opp.dex,
        chain: opp.chain,
      },
      `🚀 DEX EXECUTABLE: ${opp.symbol} ${opp.direction} net=${opp.netPercent.toFixed(3)}% profit=$${opp.profitUsd.toFixed(2)}`
    );
  }
}

/**
 * Update gas estimates for all chains
 */
async function updateGasEstimates(): Promise<void> {
  for (const chain of getActiveChains()) {
    try {
      const estimate = await getGasPrice(chain);
      state.gasEstimates.set(chain, estimate.totalCostUsd * DEX_SCANNER_DEFAULTS.maxGasMultiplier);
    } catch (error) {
      logger.warn({ chain }, 'Failed to update gas estimate');
    }
  }
  
  logger.debug(
    { estimates: Object.fromEntries(state.gasEstimates) },
    'Updated gas estimates'
  );
}

/**
 * Scan for CEX-DEX opportunities
 */
async function scanOpportunities(): Promise<CexDexOpportunity[]> {
  const opportunities: CexDexOpportunity[] = [];
  
  for (const pool of state.pools) {
    const cexSymbol = poolToCexSymbol(pool);
    if (!cexSymbol) continue;
    
    const cexPrice = getCexPrice(cexSymbol);
    if (!cexPrice) continue;
    
    const gasEstimate = state.gasEstimates.get(pool.chain) ?? 5; // Default $5
    
    const opp = calculateOpportunity(pool, cexPrice, gasEstimate);
    if (opp) {
      opportunities.push(opp);
      pushToDashboard(opp);
    }
  }
  
  return opportunities;
}

/**
 * Main scan loop
 */
async function scanLoop(): Promise<void> {
  if (!state.isRunning) return;
  
  try {
    state.totalScans++;
    const startTime = Date.now();
    
    // Refresh pools periodically (every 10 scans)
    if (state.totalScans % 10 === 1) {
      state.pools = await fetchAllPools();
      await updateGasEstimates();
    }
    
    const opportunities = await scanOpportunities();
    state.opportunitiesFound += opportunities.length;
    state.lastScanAt = Date.now();
    
    const elapsed = Date.now() - startTime;
    
    if (opportunities.length > 0) {
      logger.info(
        {
          scan: state.totalScans,
          found: opportunities.length,
          pools: state.pools.length,
          elapsed,
        },
        `DEX scan #${state.totalScans}: found ${opportunities.length} opportunities in ${elapsed}ms`
      );
    } else if (state.totalScans % 10 === 0) {
      logger.debug(
        { scan: state.totalScans, pools: state.pools.length },
        `DEX scan #${state.totalScans}: no opportunities`
      );
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'DEX scan error'
    );
  }
  
  // Schedule next scan
  if (state.isRunning) {
    setTimeout(scanLoop, DEX_SCANNER_DEFAULTS.scanIntervalMs);
  }
}

/**
 * Start DEX scanner
 */
export async function startDexScanner(): Promise<void> {
  if (state.isRunning) {
    logger.warn('DEX scanner already running');
    return;
  }
  
  logger.info('🦄 DEX scan started - initializing pools and gas estimates...');
  state.isRunning = true;
  
  // Initial pool fetch
  try {
    state.pools = await fetchAllPools();
    await updateGasEstimates();
    logger.info(
      { pools: state.pools.length, chains: getActiveChains() },
      `🦄 DEX scanner ready: ${state.pools.length} pools across ${getActiveChains().length} chains`
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to initialize DEX scanner'
    );
  }
  
  // Start scan loop
  scanLoop();
}

/**
 * Stop DEX scanner
 */
export function stopDexScanner(): void {
  logger.info('Stopping DEX scanner...');
  state.isRunning = false;
}

/**
 * Get scanner stats
 */
export function getDexScannerStats(): {
  isRunning: boolean;
  totalScans: number;
  opportunitiesFound: number;
  activePools: number;
  lastScanAt: number;
} {
  return {
    isRunning: state.isRunning,
    totalScans: state.totalScans,
    opportunitiesFound: state.opportunitiesFound,
    activePools: state.pools.length,
    lastScanAt: state.lastScanAt,
  };
}

/**
 * Export for integration with CEX scanner
 */
export { updateGasTokenPrices };
