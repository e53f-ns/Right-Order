/**
 * Crypto Arbitrage Scanner with Dashboard
 * Main entry point that runs both scanner and dashboard
 * 
 * Usage: npm run dev:all
 */

// ccxt types not needed in this entry point

import { loadConfig } from './config/index.js';
import type { ExchangeId } from './config/schema.js';
import { getDashboardServer, getDashboardStore } from './dashboard/index.js';
import { getConnectionManager, type ConnectionManager } from './exchanges/index.js';
import {
  getOrderbookAggregator,
  getSimpleArbDetector,
  getTriangularDetector,
  enableDashboard,
  enableTriangularDashboard,
  type SimpleArbDetector,
  type TriangularDetector,
  type OrderbookAggregator,
} from './scanner/index.js';
import type { TradingSymbol } from './types/branded.js';
import type { OpportunityEvent, TriangularArbitrageOpportunity } from './types/opportunity.js';
import { formatForDisplay } from './utils/decimal.js';
import { createLogger } from './utils/logger.js';
import {
  initSymbols,
  getExchangeSymbols,
  getSymbolManagerStats,
  stopSymbolManager,
  subscribeWithDelay,
  registerConnectedExchanges,
} from './utils/symbol-manager.js';
import {
  startDexScanner,
  stopDexScanner,
  enableDexDashboard,
  getDexScannerStats,
} from './dex/index.js';
import {
  updateCexPrice as updateDexScannerCexPrice,
} from './scanner/dex-scanner.js';
import {
  feedPricePair as feedStatArbPrice,
  computeSignals as computeStatArbSignals,
  startStatArb,
  isStatArbRunning,
  seedHistoricalData as seedStatArbData,
} from './strategies/stat-arb.js';
import {
  feedPairPrices,
  analyzePairs,
  startPairsTrading,
  isPairsTradingRunning,
  getPairCandidates,
  seedPairsData,
} from './strategies/pairs-trading.js';

const logger = createLogger('main');

// Global instances for shutdown
let connectionManager: ConnectionManager | null = null;
let arbDetector: SimpleArbDetector | null = null;
let triangularDetector: TriangularDetector | null = null;
let aggregator: OrderbookAggregator | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let statusInterval: ReturnType<typeof setInterval> | null = null;

/**
 * BTC pairs for triangular arbitrage paths
 */
const TRIANGULAR_PAIRS: TradingSymbol[] = [
  'ETH/BTC' as TradingSymbol,
  'SOL/BTC' as TradingSymbol,
  'XRP/BTC' as TradingSymbol,
  'DOGE/BTC' as TradingSymbol,
  'LINK/ETH' as TradingSymbol,
];

/**
 * Exchanges to temporarily skip
 */
const SKIP_EXCHANGES: ExchangeId[] = ['bitrue', 'coinbase'] as ExchangeId[];

// Prevent unhandled WS errors from crashing the process
process.on('uncaughtException', (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Uncaught exception (kept alive)');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'Unhandled rejection (kept alive)');
});

/**
 * Handle detected simple arbitrage opportunity
 */
function handleSimpleOpportunity(event: OpportunityEvent): void {
  const opp = event.opportunity;
  if (opp.type !== 'simple') return;

  // Push to dashboard store
  const store = getDashboardStore();
  store.pushOpportunity(event);

  const profitSign = parseFloat(opp.netProfit) >= 0 ? '+' : '';
  const statusIcon = event.isNew ? '🔥' : event.priceChanged ? '📈' : '🔄';

  logger.info(
    {
      id: opp.id,
      symbol: opp.symbol,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      netProfit: opp.netProfit,
      profitUsd: opp.estimatedProfitUsd,
      confidence: opp.confidence,
      isNew: event.isNew,
    },
    `${statusIcon} ARB: ${opp.symbol} | Buy ${opp.buyExchange} @ ${formatForDisplay(opp.buyPrice, 2)} → Sell ${opp.sellExchange} @ ${formatForDisplay(opp.sellPrice, 2)} | ${profitSign}${opp.netProfit}% (~$${opp.estimatedProfitUsd})`
  );
}

/**
 * Handle detected triangular arbitrage opportunity
 */
function handleTriangularOpportunity(event: OpportunityEvent): void {
  const opp = event.opportunity as TriangularArbitrageOpportunity;
  if (opp.type !== 'triangular') return;

  // Push to dashboard store
  const store = getDashboardStore();
  store.pushOpportunity(event);

  const profitSign = parseFloat(opp.netProfit) >= 0 ? '+' : '';
  const statusIcon = event.isNew ? '🔺' : event.priceChanged ? '📈' : '🔄';

  const steps = opp.path.map((step, i) => {
    const action = step.side === 'buy' ? 'Buy' : 'Sell';
    return `${i + 1}. ${action} ${step.pair} @ ${formatForDisplay(step.price, 6)}`;
  });

  logger.info(
    {
      id: opp.id,
      exchange: opp.exchange,
      path: opp.pathDescription,
      startAmount: opp.startAmount,
      endAmount: opp.endAmount,
      netProfit: opp.netProfit,
      profitUsd: opp.estimatedProfitUsd,
      totalFees: opp.totalFees,
      slippage: opp.estimatedSlippage,
      confidence: opp.confidence,
      isNew: event.isNew,
      steps,
    },
    `${statusIcon} TRI: ${opp.exchange} | ${opp.pathDescription} | ${profitSign}${opp.netProfit}% (~$${opp.estimatedProfitUsd})`
  );
}

async function main(): Promise<void> {
  logger.info('Starting Crypto Arbitrage Scanner with Dashboard...');

  try {
    const config = loadConfig();
    logger.info({ env: config.env.NODE_ENV }, 'Configuration loaded');

    // Initialize dashboard
    const dashboardStore = getDashboardStore();
    const dashboardServer = getDashboardServer({ port: 3000, host: 'localhost' });
    await dashboardServer.start();

    // Enable dashboard integration in detectors
    enableDashboard();
    enableTriangularDashboard();

    logger.info('Dashboard server started at http://localhost:3000');

    // Initialize orderbook aggregator
    aggregator = getOrderbookAggregator({
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs,
    });

    // Initialize simple arbitrage detector
    const tradeSize = config.trading.tradeSizeUsd;
    const minProfitPercent = 0.05;
    const minProfitUsd = 1.0;
    const slippageMultiplier = 1.1;
    const dedupeWindow = 10000;

    arbDetector = getSimpleArbDetector({
      minProfitThreshold: minProfitPercent,
      minProfitUsd: minProfitUsd,
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs,
      tradeSizeUsd: tradeSize,
      slippageMultiplier: slippageMultiplier,
      minConfidence: 0.5,
      dedupeWindowMs: dedupeWindow,
      onOpportunity: handleSimpleOpportunity,
    });

    logger.info(
      {
        tradeSize: `$${tradeSize}`,
        minProfit: `${minProfitPercent}%`,
        minUsd: `$${minProfitUsd}`,
        slipMult: slippageMultiplier,
        dedupeMs: dedupeWindow,
      },
      `🔧 Simple detector ready`
    );

    // Initialize triangular arbitrage detector
    const triMinProfitPercent = 0.1;
    const triMinProfitUsd = 2.0;
    const triSlippageMultiplier = 1.15;

    triangularDetector = getTriangularDetector({
      minProfitThreshold: triMinProfitPercent,
      minProfitUsd: triMinProfitUsd,
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs - 500,
      tradeSizeUsd: tradeSize,
      slippageMultiplier: triSlippageMultiplier,
      minConfidence: 0.5,
      dedupeWindowMs: 15000,
      onOpportunity: handleTriangularOpportunity,
    });

    logger.info(
      {
        tradeSize: `$${tradeSize}`,
        minProfit: `${triMinProfitPercent}%`,
        minUsd: `$${triMinProfitUsd}`,
        slipMult: triSlippageMultiplier,
      },
      `🔧 Triangular detector ready`
    );

    // Initialize connection manager
    connectionManager = getConnectionManager({
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs,
      orderbookDepth: 20,
    });

    let orderbookUpdateCount = 0;

    // Track latest mid-prices per exchange:symbol for stat-arb cross-exchange feeding
    const latestMidPrices = new Map<string, { price: number; ts: number }>();
    // Pairs trading candidate list (symbol pairs on same exchange)
    const pairCandidates = getPairCandidates();

    // Connect aggregator and detectors to connection manager
    connectionManager.onOrderbookUpdate((orderbook) => {
      orderbookUpdateCount++;

      if (orderbookUpdateCount <= 5 || orderbookUpdateCount % 500 === 0) {
        logger.info(
          {
            exchange: orderbook.exchange,
            symbol: orderbook.symbol,
            bestBid: orderbook.bids[0]?.price,
            bestAsk: orderbook.asks[0]?.price,
            totalUpdates: orderbookUpdateCount,
          },
          'Orderbook update received'
        );
      }

      aggregator?.processOrderbookUpdate(orderbook);
      triangularDetector?.processOrderbook(orderbook);

      // Feed CEX prices to DEX scanner for CEX-DEX arbitrage detection
      const bestBid = orderbook.bids[0]?.price;
      const bestAsk = orderbook.asks[0]?.price;
      if (bestBid && bestAsk && Number(bestBid) > 0 && Number(bestAsk) > 0) {
        updateDexScannerCexPrice(
          orderbook.symbol,
          orderbook.exchange as ExchangeId,
          Number(bestBid),
          Number(bestAsk),
        );

        // Compute mid-price and feed to stat-arb + pairs-trading engines
        const midPrice = (Number(bestBid) + Number(bestAsk)) / 2;
        const now = Date.now();
        const priceKey = `${orderbook.exchange}:${orderbook.symbol}`;
        latestMidPrices.set(priceKey, { price: midPrice, ts: now });

        // --- Stat Arb: feed cross-exchange spread for same symbol ---
        if (isStatArbRunning()) {
          // Find same symbol on other exchanges
          for (const [otherKey, otherData] of latestMidPrices) {
            if (otherKey === priceKey) continue;
            const [otherExchange, otherSymbol] = otherKey.split(':');
            if (otherSymbol !== orderbook.symbol) continue;
            if (!otherExchange || now - otherData.ts > 30000) continue; // Skip stale (>30s)
            feedStatArbPrice(
              orderbook.symbol,
              orderbook.exchange,
              midPrice,
              otherExchange,
              otherData.price,
              now
            );
          }
        }

        // --- Pairs Trading: feed correlated pair prices on same exchange ---
        if (isPairsTradingRunning()) {
          for (const [symbolA, symbolB] of pairCandidates) {
            const keyA = `${orderbook.exchange}:${symbolA}`;
            const keyB = `${orderbook.exchange}:${symbolB}`;
            const dataA = latestMidPrices.get(keyA);
            const dataB = latestMidPrices.get(keyB);
            if (dataA && dataB && now - dataA.ts < 30000 && now - dataB.ts < 30000) {
              feedPairPrices(
                orderbook.exchange,
                symbolA,
                dataA.price,
                symbolB,
                dataB.price,
                now
              );
            }
          }
        }
      }
    });

    // Start the detectors
    arbDetector.start();
    triangularDetector.start();

    // Filter and connect to exchanges
    const exchangesToConnect = config.trading.enabledExchanges.filter(
      (ex) => !SKIP_EXCHANGES.includes(ex)
    );

    logger.info(
      { exchanges: exchangesToConnect, skipped: SKIP_EXCHANGES },
      'Connecting to exchanges...'
    );

    await connectionManager.connectAll(exchangesToConnect);

    const healthyExchanges = connectionManager.getHealthyExchanges();
    const connectedExchanges = connectionManager.getConnectedExchanges();
    const failedExchanges = exchangesToConnect.filter(e => !connectedExchanges.includes(e));

    logger.info(
      {
        healthy: healthyExchanges.length,
        connected: connectedExchanges.length,
        attempted: exchangesToConnect.length,
        healthyList: healthyExchanges,
        failedList: failedExchanges,
      },
      `Exchanges ready: ${healthyExchanges.length}/${exchangesToConnect.length} healthy (${failedExchanges.length} failed)`
    );

    if (healthyExchanges.length < 2) {
      logger.warn('Less than 2 healthy exchanges — spreads will be limited');
    }

    // Initialize symbol manager with ALL exchange instances (not just healthy)
    // Symbol manager handles failures gracefully with fallback symbols
    const exchangeMap = connectionManager.getExchangeInstances();
    logger.info(
      { exchangeInstanceCount: exchangeMap.size, exchanges: Array.from(exchangeMap.keys()) },
      `Got ${exchangeMap.size} exchange instances for symbol manager`
    );
    await initSymbols(exchangeMap);

    // Safety net: register ALL connected exchanges with fallback symbols
    // (handles exchanges that failed dynamic fetch or returned 0 markets)
    registerConnectedExchanges(connectedExchanges);

    const symbolStats = getSymbolManagerStats();
    logger.info(
      {
        totalSymbols: symbolStats.totalSymbols,
        dynamicCount: symbolStats.dynamicCount,
        fallbackCount: symbolStats.fallbackCount,
        exchangeCount: symbolStats.exchangeCount,
        arbitrageSymbols: symbolStats.arbitrageSymbols,
      },
      `Symbol manager ready: ${symbolStats.totalSymbols} symbols from ${symbolStats.exchangeCount} exchanges`
    );

    // Update dashboard exchange counts immediately (don't wait for 30s status interval)
    dashboardStore.updateExchangeCounts(
      connectionManager.getConnectedExchanges().length,
      connectionManager.getTotalExchanges()
    );

    // Subscribe to symbols
    let totalSubscriptions = 0;
    const subscribedSymbols = new Set<TradingSymbol>();

    for (const exchangeId of healthyExchanges) {
      const exchangeSymbolList = getExchangeSymbols(exchangeId);

      logger.info(
        { exchangeId, symbolCount: exchangeSymbolList.length },
        `Subscribing to symbols on ${exchangeId}`
      );

      await subscribeWithDelay(
        (symbol) => {
          try {
            connectionManager?.subscribe(exchangeId, symbol);
            subscribedSymbols.add(symbol);
            totalSubscriptions++;
          } catch (error) {
            logger.warn(
              {
                exchangeId,
                symbol,
                error: error instanceof Error ? error.message : String(error),
              },
              'Failed to subscribe'
            );
          }
        },
        exchangeSymbolList,
        { batchSize: 10, batchDelayMs: 2000 }
      );

      for (const triSymbol of TRIANGULAR_PAIRS) {
        if (!exchangeSymbolList.includes(triSymbol)) {
          try {
            connectionManager.subscribe(exchangeId, triSymbol);
            subscribedSymbols.add(triSymbol);
            totalSubscriptions++;
          } catch {
            // Ignore
          }
        }
      }

      // Log per-exchange subscription status
      const isHealthy = connectionManager?.getHealthyExchanges().includes(exchangeId) ?? false;
      logger.info(
        { exchangeId, subscribed: exchangeSymbolList.length, healthy: isHealthy },
        `Exchange ${exchangeId}: subscribed ${exchangeSymbolList.length} symbols, healthy: ${isHealthy}`
      );
    }

    logger.info(
      {
        uniqueSymbols: subscribedSymbols.size,
        exchanges: healthyExchanges.length,
        totalSubscriptions,
      },
      `Subscribed to ${subscribedSymbols.size} symbols`
    );

    // Start stat-arb and pairs-trading engines now that we have live data flowing
    if (!isStatArbRunning()) {
      startStatArb();
      // Seed with synthetic data so signals appear immediately
      seedStatArbData();
      logger.info('Statistical arbitrage engine started + seeded (live feed wired)');
    }
    if (!isPairsTradingRunning()) {
      startPairsTrading();
      // Seed with synthetic data so cointegrated pairs + signals appear immediately
      seedPairsData();
      logger.info({ pairCandidates: pairCandidates.length }, 'Pairs trading engine started + seeded (live feed wired)');
    }

    // Periodic cleanup + stat-arb/pairs compute cycles
    cleanupInterval = setInterval(() => {
      const cleanedOrderbooks = aggregator?.cleanupStaleOrderbooks() ?? 0;
      const cleanedSimpleTracked = arbDetector?.cleanupOldTracked() ?? 0;
      const cleanedTriTracked = triangularDetector?.cleanupOldTracked() ?? 0;

      if (cleanedOrderbooks > 0 || cleanedSimpleTracked > 0 || cleanedTriTracked > 0) {
        logger.debug(
          { cleanedOrderbooks, cleanedSimpleTracked, cleanedTriTracked },
          'Cleanup completed'
        );
      }

      // Run stat-arb and pairs-trading compute cycles
      if (isStatArbRunning()) {
        try { computeStatArbSignals(); } catch (err) {
          logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Stat arb compute error');
        }
      }
      if (isPairsTradingRunning()) {
        try { analyzePairs(); } catch (err) {
          logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Pairs trading analyze error');
        }
      }
    }, 30000);

    // Log status every 30 seconds
    let statusCount = 0;
    let lastOrderbookCount = 0;

    statusInterval = setInterval(() => {
      statusCount++;
      const stats = aggregator?.getStats();
      const simpleTracked = arbDetector?.getTrackedStats();
      const triStats = triangularDetector?.getStats();
      const healthy = connectionManager?.getHealthyExchanges() ?? [];
      const connected = connectionManager?.getConnectedExchanges() ?? [];
      const total = connectionManager?.getTotalExchanges() ?? 0;
      const dashboardStats = dashboardStore.getStats();

      const updatesThisInterval = orderbookUpdateCount - lastOrderbookCount;
      lastOrderbookCount = orderbookUpdateCount;
      const updatesPerSec = Math.round(updatesThisInterval / 30);

      const freshOrderbooks = (stats?.totalExchangeOrderbooks ?? 0) - (stats?.staleOrderbooks ?? 0);
      const simpleTrackedCount = simpleTracked?.activeInWindow ?? 0;
      const triTrackedCount = triStats?.trackedPaths ?? 0;

      // Update dashboard with connected/total exchange counts
      dashboardStore.updateExchangeCounts(connected.length, total);

      // Log healthy exchanges in requested format
      logger.info(
        {
          healthy: healthy.length,
          connected: connected.length,
          total,
          exchanges: healthy,
        },
        `Healthy exchanges: ${healthy.length}/${total} (connected: ${connected.length})`
      );

      logger.info(
        {
          num: statusCount,
          healthy: healthy.length,
          fresh: freshOrderbooks,
          stale: stats?.staleOrderbooks ?? 0,
          simple: { tracked: simpleTrackedCount },
          triangular: { tracked: triTrackedCount, found: triStats?.totalOpportunitiesFound ?? 0 },
          updates: { total: orderbookUpdateCount, perSec: updatesPerSec },
          dashboard: {
            opportunities: dashboardStats.opportunitiesCount,
            uniqueSpreads: dashboardStats.uniqueSpreads,
            calculations: dashboardStats.totalCalculations,
          },
        },
        `📈 Status #${statusCount}: ${healthy.length} ex | ${freshOrderbooks} books | ${updatesPerSec}/s | Unique spreads: ${dashboardStats.uniqueSpreads}`
      );
    }, 30000);

    // Initialize DEX scanner
    enableDexDashboard();
    logger.info('Starting DEX scanner...');
    await startDexScanner();
    
    const dexStats = getDexScannerStats();
    logger.info(
      {
        dexPools: dexStats.activePools,
        dexRunning: dexStats.isRunning,
      },
      `DEX scanner initialized with ${dexStats.activePools} pools`
    );

    logger.info(
      {
        exchanges: healthyExchanges.length,
        symbols: subscribedSymbols.size,
        dexPools: dexStats.activePools,
        dashboard: 'http://localhost:3000',
      },
      'Scanner with Dashboard + DEX initialized. Open http://localhost:3000 to view spreads'
    );

    // Keep process alive
    await new Promise<never>(() => {});
  } catch (error) {
    logger.fatal({ error }, 'Fatal error during startup');
    await shutdown();
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  if (cleanupInterval !== null) clearInterval(cleanupInterval);
  if (statusInterval !== null) clearInterval(statusInterval);

  stopSymbolManager();

  if (arbDetector !== null) arbDetector.stop();
  if (triangularDetector !== null) triangularDetector.stop();
  stopDexScanner();
  if (connectionManager !== null) await connectionManager.disconnectAll();

  logger.info('Shutdown complete');
}

process.on('SIGINT', () => {
  logger.info('Received SIGINT');
  void shutdown().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM');
  void shutdown().then(() => process.exit(0));
});

void main();
