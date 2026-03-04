/**
 * Crypto Arbitrage Scanner
 * Main entry point
 */

import type { Exchange } from 'ccxt';

import { loadConfig } from './config/index.js';
import type { ExchangeId } from './config/schema.js';
import { getConnectionManager, type ConnectionManager } from './exchanges/index.js';
import {
  getOrderbookAggregator,
  getSimpleArbDetector,
  getTriangularDetector,
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
} from './utils/symbol-manager.js';

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
 * These are always subscribed for triangular detection
 */
const TRIANGULAR_PAIRS: TradingSymbol[] = [
  'ETH/BTC' as TradingSymbol,
  'SOL/BTC' as TradingSymbol,
  'XRP/BTC' as TradingSymbol,
  'DOGE/BTC' as TradingSymbol,
  'LINK/ETH' as TradingSymbol,
];

/**
 * Exchanges to temporarily skip (connection issues)
 * Empty by default - all exchanges enabled
 */
const SKIP_EXCHANGES: ExchangeId[] = [];

/**
 * Handle detected simple arbitrage opportunity
 */
function handleSimpleOpportunity(event: OpportunityEvent): void {
  const opp = event.opportunity;

  if (opp.type !== 'simple') return;

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

  // TODO: Send to Telegram notifier when implemented
}

/**
 * Handle detected triangular arbitrage opportunity
 */
function handleTriangularOpportunity(event: OpportunityEvent): void {
  const opp = event.opportunity as TriangularArbitrageOpportunity;

  if (opp.type !== 'triangular') return;

  const profitSign = parseFloat(opp.netProfit) >= 0 ? '+' : '';
  const statusIcon = event.isNew ? '🔺' : event.priceChanged ? '📈' : '🔄';

  // Build step description
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

  // TODO: Send to Telegram notifier when implemented
}

async function main(): Promise<void> {
  logger.info('Starting Crypto Arbitrage Scanner...');

  try {
    const config = loadConfig();
    logger.info({ env: config.env.NODE_ENV }, 'Configuration loaded');

    // Initialize orderbook aggregator
    aggregator = getOrderbookAggregator({
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs,
    });

    // Initialize simple arbitrage detector with production-ready thresholds
    // Use values from config, with reasonable defaults for alerting
    const tradeSize = config.trading.tradeSizeUsd; // Use configured size
    const minProfitPercent = 0.05; // 0.05% minimum for alerts (realistic for CEX arb)
    const minProfitUsd = 1.0; // $1.00 minimum to avoid noise
    const slippageMultiplier = 1.1; // 10% buffer on slippage (dynamic adjusted by depth)
    const dedupeWindow = 10000; // 10 seconds between same-route alerts
    
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
      `🔧 Simple detector ready: ${minProfitPercent}% / $${minProfitUsd} min, ${slippageMultiplier}x slip buffer`
    );

    // Initialize triangular arbitrage detector
    // Triangular requires higher minimum due to 3 trades (more fees + slippage)
    const triMinProfitPercent = 0.1; // 0.1% minimum for triangular
    const triMinProfitUsd = 2.0; // $2.00 minimum profit
    const triSlippageMultiplier = 1.15; // 15% buffer for 3 trades
    
    triangularDetector = getTriangularDetector({
      minProfitThreshold: triMinProfitPercent,
      minProfitUsd: triMinProfitUsd,
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs - 500, // Stricter for triangular
      tradeSizeUsd: tradeSize,
      slippageMultiplier: triSlippageMultiplier,
      minConfidence: 0.5,
      dedupeWindowMs: 15000, // 15 seconds between same path alerts
      onOpportunity: handleTriangularOpportunity,
    });

    logger.info(
      {
        tradeSize: `$${tradeSize}`,
        minProfit: `${triMinProfitPercent}%`,
        minUsd: `$${triMinProfitUsd}`,
        slipMult: triSlippageMultiplier,
      },
      `🔧 Triangular detector ready: ${triMinProfitPercent}% / $${triMinProfitUsd} min, ${triSlippageMultiplier}x slip buffer`
    );

    // Initialize connection manager with increased depth
    connectionManager = getConnectionManager({
      maxOrderbookAgeMs: config.trading.maxOrderbookAgeMs,
      orderbookDepth: 20, // More levels for better slippage estimation
    });

    // Track orderbook updates count for logging
    let orderbookUpdateCount = 0;

    // Connect aggregator and detectors to connection manager
    connectionManager.onOrderbookUpdate((orderbook) => {
      orderbookUpdateCount++;

      // Log first few updates and then periodically
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

      // Send to orderbook aggregator (for simple arb)
      aggregator?.processOrderbookUpdate(orderbook);

      // Send to triangular detector (processes per-exchange orderbooks)
      triangularDetector?.processOrderbook(orderbook);
    });

    // Start the detectors
    arbDetector.start();
    triangularDetector.start();

    // Filter out problematic exchanges
    const exchangesToConnect = config.trading.enabledExchanges.filter(
      (ex) => !SKIP_EXCHANGES.includes(ex)
    );

    logger.info(
      {
        exchanges: exchangesToConnect,
        skipped: SKIP_EXCHANGES,
      },
      'Connecting to exchanges...'
    );

    await connectionManager.connectAll(exchangesToConnect);

    // Wait a bit for connections to stabilize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get healthy exchanges
    const healthyExchanges = connectionManager.getHealthyExchanges();
    logger.info({ healthyExchanges }, 'Healthy exchanges ready');

    if (healthyExchanges.length < 2) {
      logger.warn('Less than 2 healthy exchanges, arbitrage detection will be limited');
    }

    // Initialize dynamic symbol manager
    // Build a map of exchange instances for symbol fetching
    // Note: We use the connection manager's internal exchanges via getAllStatus
    const exchangeMap = new Map<ExchangeId, Exchange>();
    // For now, we'll use the fallback symbols since we don't have direct access to ccxt instances
    // The symbol manager will fetch markets when exchanges are passed
    
    logger.info('Initializing dynamic symbol manager...');
    
    // Initialize symbols (will use fallback for now, dynamic fetch happens with direct ccxt access)
    await initSymbols(exchangeMap);
    
    // Get symbol stats
    const symbolStats = getSymbolManagerStats();
    
    logger.info(
      {
        totalSymbols: symbolStats.totalSymbols,
        arbitrageSymbols: symbolStats.arbitrageSymbols,
        dynamicCount: symbolStats.dynamicCount,
        fallbackCount: symbolStats.fallbackCount,
      },
      `Symbol manager ready: ${symbolStats.totalSymbols} symbols (arb-ready: ${symbolStats.arbitrageSymbols})`
    );

    // Subscribe to symbols on each healthy exchange
    let totalSubscriptions = 0;
    const subscribedSymbols = new Set<TradingSymbol>();

    for (const exchangeId of healthyExchanges) {
      // Get symbols for this exchange (limited to 30)
      const exchangeSymbolList = getExchangeSymbols(exchangeId);
      
      logger.info(
        { exchangeId, symbolCount: exchangeSymbolList.length },
        `Subscribing to ${exchangeSymbolList.length} symbols on ${exchangeId}`
      );

      // Subscribe with staggered delay to avoid rate limits
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
        { batchDelayMs: 100 } // 100ms delay between subscriptions
      );

      // Also subscribe to triangular pairs for this exchange
      for (const triSymbol of TRIANGULAR_PAIRS) {
        if (!exchangeSymbolList.includes(triSymbol)) {
          try {
            connectionManager.subscribe(exchangeId, triSymbol);
            subscribedSymbols.add(triSymbol);
            totalSubscriptions++;
          } catch {
            // Triangular pairs might not exist on all exchanges, ignore
          }
        }
      }
    }

    logger.info(
      {
        uniqueSymbols: subscribedSymbols.size,
        exchanges: healthyExchanges.length,
        totalSubscriptions,
      },
      `Subscribing to ${subscribedSymbols.size} symbols across ${healthyExchanges.length} exchanges`
    );

    // Periodic cleanup of stale data
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
      const allStatus = connectionManager?.getAllStatus() ?? [];

      // Calculate updates in this interval
      const updatesThisInterval = orderbookUpdateCount - lastOrderbookCount;
      lastOrderbookCount = orderbookUpdateCount;
      const updatesPerSec = Math.round(updatesThisInterval / 30);

      // Show exchange states (compact)
      const exchangeStates = allStatus.map((s) => 
        `${s.exchangeId}:${s.state === 'connected' ? '✓' : s.state === 'error' ? '✗' : '?'}(${s.subscribedSymbols.length})`
      ).join(' ');

      const freshOrderbooks = (stats?.totalExchangeOrderbooks ?? 0) - (stats?.staleOrderbooks ?? 0);
      const simpleTrackedCount = simpleTracked?.activeInWindow ?? 0;
      const simpleTotalTracked = simpleTracked?.totalTracked ?? 0;
      const triTrackedCount = triStats?.trackedPaths ?? 0;
      const triOppsFound = triStats?.totalOpportunitiesFound ?? 0;

      logger.info(
        {
          num: statusCount,
          healthy: healthy.length,
          fresh: freshOrderbooks,
          stale: stats?.staleOrderbooks ?? 0,
          simple: { tracked: simpleTrackedCount, total: simpleTotalTracked },
          triangular: { tracked: triTrackedCount, found: triOppsFound, scans: triStats?.scanCount ?? 0 },
          updates: { interval: updatesThisInterval, total: orderbookUpdateCount, perSec: updatesPerSec },
          exchanges: exchangeStates,
        },
        `📈 Status #${statusCount}: ${healthy.length} ex | ${freshOrderbooks} books | Simple: ${simpleTrackedCount} | Tri: ${triTrackedCount} tracked, ${triOppsFound} found | ${updatesPerSec}/s`
      );

      // Log symbol stats every 5th status
      if (stats && stats.symbolStats.length > 0 && statusCount % 5 === 0) {
        logger.debug({ symbolStats: stats.symbolStats }, 'Symbol statistics');
      }
    }, 30000);

    logger.info(
      {
        exchanges: healthyExchanges.length,
        symbols: subscribedSymbols.size,
        minProfit: config.trading.minProfitThreshold,
        tradeSize: config.trading.tradeSizeUsd,
      },
      'Scanner initialized. Watching for arbitrage opportunities...'
    );

    // Test exchange connections after 15 seconds
    setTimeout(() => {
      logger.info('=== Testing exchange connections ===');
      
      const allStatus = connectionManager?.getAllStatus() ?? [];
      const aggStats = aggregator?.getStats();
      const symStats = getSymbolManagerStats();
      
      const results: Array<{ exchange: string; status: string; subscriptions: number }> = [];
      
      for (const status of allStatus) {
        const isConnected = status.state === 'connected';
        const subscCount = status.subscribedSymbols.length;
        
        results.push({
          exchange: status.exchangeId,
          status: isConnected ? '✓ connected' : `✗ ${status.state}`,
          subscriptions: subscCount,
        });
      }
      
      // Log results
      const connectedCount = results.filter(r => r.status.includes('connected')).length;
      
      logger.info(
        { 
          totalExchanges: results.length,
          connectedCount,
          totalOrderbooks: aggStats?.totalExchangeOrderbooks ?? 0,
          freshOrderbooks: (aggStats?.totalExchangeOrderbooks ?? 0) - (aggStats?.staleOrderbooks ?? 0),
          symbols: {
            total: symStats.totalSymbols,
            arbitrage: symStats.arbitrageSymbols,
            dynamic: symStats.dynamicCount,
            fallback: symStats.fallbackCount,
          },
          exchanges: results.map(r => `${r.exchange}: ${r.status} (${r.subscriptions} pairs)`),
        },
        `🧪 Connection test: ${connectedCount}/${results.length} exchanges | ${symStats.totalSymbols} symbols (${symStats.arbitrageSymbols} arb-ready)`
      );
    }, 15000);

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

  // Clear intervals
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
  }
  if (statusInterval !== null) {
    clearInterval(statusInterval);
  }

  // Stop symbol manager
  stopSymbolManager();

  // Stop detectors
  if (arbDetector !== null) {
    arbDetector.stop();
  }
  if (triangularDetector !== null) {
    triangularDetector.stop();
  }

  // Disconnect from all exchanges
  if (connectionManager !== null) {
    await connectionManager.disconnectAll();
  }

  logger.info('Shutdown complete');
}

// Graceful shutdown handlers
process.on('SIGINT', () => {
  logger.info('Received SIGINT');
  void shutdown().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM');
  void shutdown().then(() => process.exit(0));
});

void main();
