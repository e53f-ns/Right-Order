/**
 * Simple Arbitrage Detector
 * Detects buy-on-A / sell-on-B opportunities across exchanges
 * Emits opportunities when profitable spreads are found
 */

import { v4 as uuidv4 } from 'uuid';

import type { ExchangeId } from '../config/schema.js';
import { getDashboardStore, type RawSpreadData } from '../dashboard/index.js';
import {
  createOpportunityId,
  nowTimestampMs,
  type Percentage,
  type TradingSymbol,
} from '../types/branded.js';
import type { SimpleArbitrageOpportunity, OpportunityEvent } from '../types/opportunity.js';
import type { AggregatedOrderbook, NormalizedOrderbook } from '../types/orderbook.js';
import { toDecimal, isGreaterThanOrEqual } from '../utils/decimal.js';
import { createLogger } from '../utils/logger.js';
import { sendArbitrageAlert } from '../utils/telegram.js';
import { nowMs } from '../utils/time.js';

import {
  getOrderbookAggregator,
  type OrderbookAggregator,
  type OrderbookAggregatorConfig,
} from './orderbook-aggregator.js';
import {
  getProfitCalculator,
  type ProfitCalculator,
  type ProfitCalculatorConfig,
} from './profit-calculator.js';

const logger = createLogger('simple-arb-detector');

// Dashboard integration flag
let dashboardEnabled = false;
let dashboardStore: ReturnType<typeof getDashboardStore> | null = null;

/**
 * Enable dashboard integration
 */
export function enableDashboard(): void {
  dashboardEnabled = true;
  dashboardStore = getDashboardStore();
  logger.info('Dashboard integration enabled for SimpleArbDetector');
}

/**
 * Push spread to dashboard (if enabled)
 * Executable opportunities get high priority for alerts
 */
function pushToDashboard(data: Omit<RawSpreadData, 'id' | 'timestamp'>): void {
  if (dashboardEnabled && dashboardStore !== null) {
    dashboardStore.addSpread(data);
    logger.debug({
      symbol: data.symbol,
      net: data.netPercent.toFixed(3),
      gross: data.grossPercent.toFixed(3),
      route: `${data.buyExchange} -> ${data.sellExchange}`,
    }, `Spread pushed: ${data.symbol} net ${data.netPercent.toFixed(3)}%`);
  }
  
  // Determine if we should send alert
  // Priority 1: Executable (net > 0, sufficient depth)
  // Priority 2: Gross > 0.05% (good opportunity)
  // Priority 3: Near profitable (net > -0.05%)
  const isExecutable = data.executable === true;
  const hasGoodGross = data.grossPercent > 0.05;
  const isNearProfitable = data.netPercent > -0.05;
  const shouldAlert = isExecutable || hasGoodGross || isNearProfitable;
  
  if (shouldAlert) {
    sendArbitrageAlert({
      type: data.type,
      symbol: data.symbol,
      buyExchange: data.buyExchange,
      sellExchange: data.sellExchange,
      grossPercent: data.grossPercent,
      netPercent: data.netPercent,
      profitUsd: data.profitUsd,
      depthUsd: data.depthUsd,
      executable: isExecutable,
    }).catch(() => {
      // Silently ignore telegram errors
    });
    
    if (isExecutable) {
      logger.info(
        { symbol: data.symbol, route: `${data.buyExchange}→${data.sellExchange}`, net: data.netPercent, profit: data.profitUsd },
        `🚀 EXECUTABLE pushed to dashboard: ${data.symbol} net=${data.netPercent.toFixed(3)}%`
      );
    }
  }
}

/**
 * Configuration for the detector
 */
export interface SimpleArbDetectorConfig {
  /** Minimum net profit threshold (percentage) */
  minProfitThreshold: number;
  /** Minimum profit in USD (filter out tiny opportunities) */
  minProfitUsd: number;
  /** Maximum orderbook age to consider (ms) */
  maxOrderbookAgeMs: number;
  /** Trade size in USD */
  tradeSizeUsd: number;
  /** Slippage multiplier for safety */
  slippageMultiplier: number;
  /** Minimum confidence score (0-1) */
  minConfidence: number;
  /** Dedupe window: ignore same opportunity if seen within this time (ms) */
  dedupeWindowMs: number;
  /** Callback for new opportunities */
  onOpportunity?: (event: OpportunityEvent) => void;
}

const DEFAULT_CONFIG: SimpleArbDetectorConfig = {
  minProfitThreshold: 0.05, // 0.05% minimum for alerts (lowered for VIP fees)
  minProfitUsd: 0.5, // $0.50 minimum profit
  maxOrderbookAgeMs: 2000,
  tradeSizeUsd: 1000, // $1000 trade size (lowered)
  slippageMultiplier: 1.0, // No buffer - realistic execution
  minConfidence: 0.4, // Lowered to show more opportunities
  dedupeWindowMs: 10000, // 10 seconds between same route alerts
};

/**
 * Key for tracking seen opportunities (route = symbol_buyEx_sellEx)
 */
type OpportunityKey = string;

/** Price change threshold to consider opportunity as "new" */
const PRICE_CHANGE_THRESHOLD = 0.0005; // 0.05%

/**
 * Tracked opportunity info for dedupe and alert throttling
 */
interface TrackedOpportunity {
  lastSeenAt: number;
  lastAlertAt: number;
  lastNetProfit: number;
  lastGrossSpread: number;
  count: number;
  alertCount: number;
}

/**
 * Simple Arbitrage Detector
 * Scans aggregated orderbooks for cross-exchange arbitrage opportunities
 */
export class SimpleArbDetector {
  private readonly config: SimpleArbDetectorConfig;
  private readonly aggregator: OrderbookAggregator;
  private readonly calculator: ProfitCalculator;
  private readonly opportunityCallbacks: Set<(event: OpportunityEvent) => void> = new Set();
  private readonly trackedOpportunities: Map<OpportunityKey, TrackedOpportunity> = new Map();
  private isRunning = false;

  constructor(config: Partial<SimpleArbDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize dependencies with aligned config
    const aggregatorConfig: Partial<OrderbookAggregatorConfig> = {
      maxOrderbookAgeMs: this.config.maxOrderbookAgeMs,
    };

    const calculatorConfig: Partial<ProfitCalculatorConfig> = {
      tradeSizeUsd: this.config.tradeSizeUsd,
      slippageMultiplier: this.config.slippageMultiplier,
    };

    this.aggregator = getOrderbookAggregator(aggregatorConfig);
    this.calculator = getProfitCalculator(calculatorConfig);

    if (this.config.onOpportunity !== undefined) {
      this.opportunityCallbacks.add(this.config.onOpportunity);
    }
  }

  /**
   * Start the detector
   * Registers with aggregator to receive orderbook updates
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Detector already running');
      return;
    }

    this.isRunning = true;

    // Subscribe to orderbook updates
    this.aggregator.onUpdate(this.handleAggregatedUpdate);

    logger.info(
      {
        minProfitThreshold: this.config.minProfitThreshold,
        tradeSizeUsd: this.config.tradeSizeUsd,
        maxOrderbookAgeMs: this.config.maxOrderbookAgeMs,
      },
      'Simple arbitrage detector started'
    );
  }

  /**
   * Stop the detector
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.aggregator.offUpdate(this.handleAggregatedUpdate);

    logger.info('Simple arbitrage detector stopped');
  }

  /**
   * Handle aggregated orderbook update
   * Scans for arbitrage opportunities when data changes
   */
  private handleAggregatedUpdate = (
    symbol: TradingSymbol,
    aggregated: AggregatedOrderbook
  ): void => {
    if (!this.isRunning) return;

    // Need at least 2 exchanges to find arbitrage
    if (aggregated.exchanges.size < 2) {
      return;
    }

    // Scan all exchange pairs for opportunities
    this.scanForOpportunities(symbol, aggregated);
  };

  /**
   * Scan all exchange pairs for arbitrage opportunities
   */
  private scanForOpportunities(symbol: TradingSymbol, aggregated: AggregatedOrderbook): void {
    const exchanges = Array.from(aggregated.exchanges.keys());

    // Need at least 2 for comparison
    if (exchanges.length < 2) {
      return;
    }

    // Log scan start periodically - more frequently now
    this.scanCount++;
    const shouldLogDetails = this.scanCount <= 50 || this.scanCount % 100 === 0;

    let potentialSpreads = 0;
    let profitableSpreads = 0;
    let staleSkipped = 0;
    const bestSpread: { netProfit: string; grossSpread: string; profitUsd: string; pair: string } = { 
      netProfit: '-999', 
      grossSpread: '-999',
      profitUsd: '-999',
      pair: '' 
    };

    if (shouldLogDetails) {
      logger.info(
        {
          symbol,
          exchanges,
          exchangeCount: exchanges.length,
          pairsToCheck: exchanges.length * (exchanges.length - 1),
          scanCount: this.scanCount,
          threshold: this.config.minProfitThreshold,
        },
        `🔍 Scan #${this.scanCount}: ${symbol} across ${exchanges.length} exchanges`
      );
    }

    // Check every pair of exchanges (A->B and B->A)
    for (let i = 0; i < exchanges.length; i++) {
      for (let j = 0; j < exchanges.length; j++) {
        if (i === j) continue; // Same exchange

        const buyExchange = exchanges[i]!;
        const sellExchange = exchanges[j]!;

        const buyOrderbook = aggregated.exchanges.get(buyExchange);
        const sellOrderbook = aggregated.exchanges.get(sellExchange);

        if (buyOrderbook === undefined || sellOrderbook === undefined) {
          continue;
        }

        // Check for stale data
        const buyAge = this.getOrderbookAge(buyOrderbook);
        const sellAge = this.getOrderbookAge(sellOrderbook);

        if (buyAge > this.config.maxOrderbookAgeMs || sellAge > this.config.maxOrderbookAgeMs) {
          staleSkipped++;
          if (shouldLogDetails) {
            logger.debug(
              {
                symbol,
                buyExchange,
                sellExchange,
                buyAge,
                sellAge,
                maxAge: this.config.maxOrderbookAgeMs,
              },
              `⏰ Skipping stale: ${buyExchange}(${buyAge}ms)→${sellExchange}(${sellAge}ms)`
            );
          }
          continue;
        }

        // Get prices for logging
        const buyAsk = buyOrderbook.asks[0]?.price;
        const sellBid = sellOrderbook.bids[0]?.price;

        if (buyAsk === undefined || sellBid === undefined) {
          continue;
        }

        potentialSpreads++;

        // Full profit calculation
        const result = this.calculator.calculateSimpleArbitrage(
          buyExchange,
          sellExchange,
          buyOrderbook,
          sellOrderbook,
          this.config.tradeSizeUsd
        );

        const netProfit = toDecimal(result.netProfit);
        const netProfitStr = result.netProfit;
        const grossSpreadStr = result.grossSpread;
        const profitUsd = parseFloat(result.estimatedProfitUsd);

        // Track best spread (by net profit now)
        if (toDecimal(netProfitStr).greaterThan(toDecimal(bestSpread.netProfit))) {
          bestSpread.grossSpread = grossSpreadStr;
          bestSpread.netProfit = netProfitStr;
          bestSpread.profitUsd = result.estimatedProfitUsd;
          bestSpread.pair = `${buyExchange}→${sellExchange}`;
        }

        // Check thresholds
        const netProfitNum = parseFloat(netProfitStr);
        const grossSpreadNum = parseFloat(grossSpreadStr);
        const passesPercentThreshold = isGreaterThanOrEqual(netProfit, this.config.minProfitThreshold);
        const passesUsdThreshold = profitUsd >= this.config.minProfitUsd;
        const isConfident = result.confidence >= this.config.minConfidence;
        const isProfitable = netProfitNum > 0;
        const isNearProfitable = netProfitNum > -0.05 || grossSpreadNum > 0.05; // Close to break-even or good gross

        // Push ALL spreads to dashboard (not just profitable ones)
        // This allows the UI to show near-profitable opportunities
        if (isNearProfitable || grossSpreadNum > 0 || netProfitNum > -0.3) {
          pushToDashboard({
            type: 'simple',
            symbol: symbol as string,
            buyExchange: buyExchange,
            sellExchange: sellExchange,
            buyPrice: parseFloat(buyAsk),
            sellPrice: parseFloat(sellBid),
            grossPercent: grossSpreadNum,
            netPercent: netProfitNum,
            profitUsd: profitUsd,
            depthUsd: parseFloat(result.volume.tradeSizeUsd),
            confidence: result.confidence,
            fees: parseFloat(result.fees.totalFee),
            slippage: parseFloat(result.slippage.withMultiplier),
          });
        }

        // Check deduplication for this route
        const routeKey = `${symbol}_${buyExchange}_${sellExchange}`;
        const tracked = this.trackedOpportunities.get(routeKey);
        const now = nowMs();
        
        // Check if this is a "new" opportunity (price changed significantly)
        const isNew = tracked === undefined || 
          Math.abs(netProfitNum - tracked.lastNetProfit) > PRICE_CHANGE_THRESHOLD * 100;
        
        // Check if we should alert (enough time passed or significantly better)
        const shouldAlert = tracked === undefined ||
          (now - tracked.lastAlertAt > this.config.dedupeWindowMs) ||
          (netProfitNum > tracked.lastNetProfit + 0.02); // 0.02% better

        // Log near-profitable for debugging (but less spam)
        if (isNearProfitable && result.isExecutable && (isNew || this.scanCount % 100 === 0)) {
          const emoji = isProfitable ? '💰' : '🔶';
          logger.info(
            {
              route: `${buyExchange}→${sellExchange}`,
              symbol,
              gross: result.grossSpread,
              net: result.netProfit,
              usd: result.estimatedProfitUsd,
              conf: result.confidence.toFixed(2),
              isNew,
            },
            `${emoji} ${isProfitable ? 'PROFITABLE' : 'NEAR'}: ${symbol} ${buyExchange}→${sellExchange} gross=${result.grossSpread}% net=${result.netProfit}% ($${result.estimatedProfitUsd})`
          );
        }

        // Handle truly profitable spreads that pass all filters
        if (passesPercentThreshold && passesUsdThreshold && isConfident && result.isExecutable && shouldAlert) {
          profitableSpreads++;
          
          // Update tracking
          this.trackedOpportunities.set(routeKey, {
            lastSeenAt: now,
            lastAlertAt: now,
            lastNetProfit: netProfitNum,
            lastGrossSpread: grossSpreadNum,
            count: (tracked?.count ?? 0) + 1,
            alertCount: (tracked?.alertCount ?? 0) + 1,
          });
          
          logger.info(
            {
              symbol,
              route: `${buyExchange}→${sellExchange}`,
              buyPrice: buyAsk,
              sellPrice: sellBid,
              gross: result.grossSpread,
              net: result.netProfit,
              usd: result.estimatedProfitUsd,
              fees: result.fees.totalFee,
              slippage: result.slippage.withMultiplier,
              conf: result.confidence.toFixed(2),
              alertNum: tracked?.alertCount ?? 1,
            },
            `🚀 ARB ALERT: ${symbol} ${buyExchange}→${sellExchange} | net=${result.netProfit}% ($${result.estimatedProfitUsd}) conf=${result.confidence.toFixed(2)}`
          );

          this.handleProfitableOpportunity(
            symbol,
            buyExchange,
            sellExchange,
            buyOrderbook,
            sellOrderbook,
            result
          );
        } else if (tracked !== undefined) {
          // Update seen time without alerting
          tracked.lastSeenAt = now;
          tracked.lastNetProfit = netProfitNum;
          tracked.lastGrossSpread = grossSpreadNum;
          tracked.count++;
        }
      }
    }

    // Summary log - less frequent, more informative
    if (shouldLogDetails || profitableSpreads > 0 || this.scanCount % 100 === 0) {
      const bestNetNum = parseFloat(bestSpread.netProfit);
      const emoji = bestNetNum > 0 ? '🚀' : bestNetNum > -0.05 ? '🔶' : '📊';
      
      logger.info(
        {
          symbol,
          ex: exchanges.length,
          spreads: potentialSpreads,
          alerts: profitableSpreads,
          stale: staleSkipped,
          best: `${bestSpread.pair} net=${bestSpread.netProfit}%`,
        },
        `${emoji} #${this.scanCount}: ${symbol} | Best: ${bestSpread.pair || '-'} net=${bestSpread.netProfit}% | ${profitableSpreads} alerts`
      );
    }
    
    // Track global stats
    this.totalSpreadsChecked += potentialSpreads;
    this.totalSpreadsDetected += profitableSpreads;
  }

  // Counters for logging
  private scanCount = 0;
  private totalSpreadsChecked = 0;
  private totalSpreadsDetected = 0;


  /**
   * Handle a profitable opportunity
   */
  private handleProfitableOpportunity(
    symbol: TradingSymbol,
    buyExchange: ExchangeId,
    sellExchange: ExchangeId,
    buyOrderbook: NormalizedOrderbook,
    sellOrderbook: NormalizedOrderbook,
    result: ReturnType<ProfitCalculator['calculateSimpleArbitrage']>
  ): void {
    const now = nowMs();
    const opportunityKey = this.createOpportunityKey(symbol, buyExchange, sellExchange);

    // Check dedupe - already handled in scanForOpportunities but keep for direct calls
    const tracked = this.trackedOpportunities.get(opportunityKey);
    const currentNetProfit = parseFloat(result.netProfit);
    const currentGross = parseFloat(result.grossSpread);
    
    const isNew = tracked === undefined || now - tracked.lastSeenAt > this.config.dedupeWindowMs;
    const priceChanged = tracked !== undefined && 
      Math.abs(currentNetProfit - tracked.lastNetProfit) > PRICE_CHANGE_THRESHOLD * 100;

    // Skip if not new and price didn't change significantly
    if (!isNew && !priceChanged) {
      return;
    }

    // Create opportunity object
    const opportunity: SimpleArbitrageOpportunity = {
      id: createOpportunityId(uuidv4()),
      type: 'simple',
      symbol,
      buyExchange,
      sellExchange,
      buyPrice: buyOrderbook.asks[0]!.price,
      sellPrice: sellOrderbook.bids[0]!.price,
      grossSpread: result.grossSpread,
      netProfit: result.netProfit,
      estimatedProfitUsd: result.estimatedProfitUsd,
      fees: result.fees,
      slippage: result.slippage,
      volume: result.volume,
      timestamp: nowTimestampMs(),
      orderbookAges: {
        buyMs: this.getOrderbookAge(buyOrderbook),
        sellMs: this.getOrderbookAge(sellOrderbook),
        maxMs: Math.max(
          this.getOrderbookAge(buyOrderbook),
          this.getOrderbookAge(sellOrderbook)
        ),
      },
      isStale: false,
      confidence: result.confidence,
    };

    // Update tracking (if not already updated in scanForOpportunities)
    if (tracked === undefined || !this.trackedOpportunities.has(opportunityKey)) {
      this.trackedOpportunities.set(opportunityKey, {
        lastSeenAt: now,
        lastAlertAt: now,
        lastNetProfit: currentNetProfit,
        lastGrossSpread: currentGross,
        count: 1,
        alertCount: 1,
      });
    }

    // Create event
    const event: OpportunityEvent = {
      opportunity,
      isNew,
      priceChanged,
      ...(tracked !== undefined && { previousProfit: String(tracked.lastNetProfit) as Percentage }),
    };

    // Emit event
    this.emitOpportunity(event);

    logger.info(
      {
        symbol,
        buyExchange,
        sellExchange,
        buyPrice: opportunity.buyPrice,
        sellPrice: opportunity.sellPrice,
        grossSpread: result.grossSpread,
        netProfit: result.netProfit,
        profitUsd: result.estimatedProfitUsd,
        fees: result.fees.totalFee,
        slippage: result.slippage.withMultiplier,
        confidence: result.confidence,
        isNew,
        priceChanged,
      },
      'Arbitrage opportunity detected'
    );
  }

  /**
   * Create opportunity key for tracking
   */
  private createOpportunityKey(
    symbol: TradingSymbol,
    buyExchange: ExchangeId,
    sellExchange: ExchangeId
  ): OpportunityKey {
    return `${symbol}_${buyExchange}_${sellExchange}`;
  }

  /**
   * Get orderbook age in milliseconds
   */
  private getOrderbookAge(orderbook: NormalizedOrderbook): number {
    return nowMs() - orderbook.receivedAt;
  }

  /**
   * Emit opportunity event to callbacks
   */
  private emitOpportunity(event: OpportunityEvent): void {
    for (const callback of this.opportunityCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Error in opportunity callback'
        );
      }
    }
  }

  /**
   * Add opportunity callback
   */
  onOpportunity(callback: (event: OpportunityEvent) => void): void {
    this.opportunityCallbacks.add(callback);
  }

  /**
   * Remove opportunity callback
   */
  offOpportunity(callback: (event: OpportunityEvent) => void): void {
    this.opportunityCallbacks.delete(callback);
  }

  /**
   * Process an orderbook update directly
   * Alternative to using the aggregator's event system
   */
  processOrderbook(orderbook: NormalizedOrderbook): void {
    this.aggregator.processOrderbookUpdate(orderbook);
  }

  /**
   * Force scan all current orderbooks for opportunities
   * Useful for manual triggers or testing
   */
  scanAll(): SimpleArbitrageOpportunity[] {
    const opportunities: SimpleArbitrageOpportunity[] = [];
    const originalCallback = this.config.onOpportunity;

    // Temporarily capture opportunities
    const captureCallback = (event: OpportunityEvent): void => {
      if (event.opportunity.type === 'simple') {
        opportunities.push(event.opportunity);
      }
    };

    this.opportunityCallbacks.add(captureCallback);

    // Scan all aggregated orderbooks
    for (const [symbol, aggregated] of this.aggregator.getAllAggregated()) {
      this.scanForOpportunities(symbol, aggregated);
    }

    // Restore original callback
    this.opportunityCallbacks.delete(captureCallback);

    if (originalCallback !== undefined) {
      this.opportunityCallbacks.add(originalCallback);
    }

    return opportunities;
  }

  /**
   * Get current configuration
   */
  getConfig(): SimpleArbDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update minimum profit threshold
   */
  setMinProfitThreshold(threshold: number): void {
    this.config.minProfitThreshold = threshold;
    logger.info({ threshold }, 'Profit threshold updated');
  }

  /**
   * Update trade size
   */
  setTradeSize(tradeSizeUsd: number): void {
    this.config.tradeSizeUsd = tradeSizeUsd;
    this.calculator.setTradeSize(tradeSizeUsd);
    logger.info({ tradeSizeUsd }, 'Trade size updated');
  }

  /**
   * Get tracked opportunities stats
   */
  getTrackedStats(): {
    totalTracked: number;
    activeInWindow: number;
    opportunities: Array<{
      key: OpportunityKey;
      lastSeenAgo: number;
      count: number;
      profit: Percentage;
    }>;
  } {
    const now = nowMs();
    let activeInWindow = 0;
    const opportunities: Array<{
      key: OpportunityKey;
      lastSeenAgo: number;
      count: number;
      profit: Percentage;
    }> = [];

    for (const [key, tracked] of this.trackedOpportunities) {
      const lastSeenAgo = now - tracked.lastSeenAt;

      if (lastSeenAgo <= this.config.dedupeWindowMs) {
        activeInWindow++;
      }

      opportunities.push({
        key,
        lastSeenAgo,
        count: tracked.count,
        profit: String(tracked.lastNetProfit) as Percentage,
      });
    }

    return {
      totalTracked: this.trackedOpportunities.size,
      activeInWindow,
      opportunities,
    };
  }

  /**
   * Clear tracked opportunities
   */
  clearTracked(): void {
    this.trackedOpportunities.clear();
    logger.debug('Cleared tracked opportunities');
  }

  /**
   * Clean up old tracked opportunities
   * Call periodically to prevent memory growth
   */
  cleanupOldTracked(): number {
    const now = nowMs();
    const maxAge = this.config.dedupeWindowMs * 10; // Keep 10x the dedupe window
    let cleanedCount = 0;

    for (const [key, tracked] of this.trackedOpportunities) {
      if (now - tracked.lastSeenAt > maxAge) {
        this.trackedOpportunities.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug({ cleanedCount }, 'Cleaned up old tracked opportunities');
    }

    return cleanedCount;
  }
}

// Singleton instance
let detectorInstance: SimpleArbDetector | null = null;

/**
 * Get the global simple arbitrage detector
 */
export function getSimpleArbDetector(config?: Partial<SimpleArbDetectorConfig>): SimpleArbDetector {
  detectorInstance ??= new SimpleArbDetector(config);
  return detectorInstance;
}

/**
 * Reset the global detector (mainly for testing)
 */
export function resetSimpleArbDetector(): void {
  if (detectorInstance !== null) {
    detectorInstance.stop();
    detectorInstance = null;
  }
}
