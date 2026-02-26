/**
 * Dashboard Standalone Entry Point
 * Runs just the dashboard server (for development/testing)
 * 
 * Usage: npm run dev:dashboard
 */

import type { ExchangeId } from './config/schema.js';
import { getDashboardServer, getDashboardStore } from './dashboard/index.js';
import {
  createPrice,
  createAmount,
  createPercentage,
  createUsdValue,
  createOpportunityId,
  nowTimestampMs,
  type TradingSymbol,
} from './types/branded.js';
import type { SimpleArbitrageOpportunity, OpportunityEvent } from './types/opportunity.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('dashboard-main');

/**
 * Generate mock spread data for testing
 */
function generateMockSpread(): OpportunityEvent {
  const symbols: TradingSymbol[] = [
    'BTC/USDT' as TradingSymbol,
    'ETH/USDT' as TradingSymbol,
    'SOL/USDT' as TradingSymbol,
    'XRP/USDT' as TradingSymbol,
    'DOGE/USDT' as TradingSymbol,
  ];

  const exchanges: ExchangeId[] = ['binance', 'bybit', 'okx', 'kucoin', 'gateio'];

  const symbol = symbols[Math.floor(Math.random() * symbols.length)]!;
  const buyExchange = exchanges[Math.floor(Math.random() * exchanges.length)]!;
  let sellExchange = exchanges[Math.floor(Math.random() * exchanges.length)]!;
  while (sellExchange === buyExchange) {
    sellExchange = exchanges[Math.floor(Math.random() * exchanges.length)]!;
  }

  const basePrice = symbol === 'BTC/USDT' ? 95000 : symbol === 'ETH/USDT' ? 3200 : symbol === 'SOL/USDT' ? 180 : 1;
  const buyPrice = basePrice * (1 + (Math.random() * 0.002 - 0.001));
  const sellPrice = basePrice * (1 + (Math.random() * 0.002));
  
  const grossSpread = ((sellPrice - buyPrice) / buyPrice) * 100;
  const fees = 0.2; // 0.2% total fees
  const slippage = Math.random() * 0.1;
  const netProfit = grossSpread - fees - slippage;
  const profitUsd = (netProfit / 100) * 5000;

  const opportunity: SimpleArbitrageOpportunity = {
    id: createOpportunityId(crypto.randomUUID()),
    type: 'simple',
    symbol,
    buyExchange,
    sellExchange,
    buyPrice: createPrice(buyPrice.toFixed(2)),
    sellPrice: createPrice(sellPrice.toFixed(2)),
    grossSpread: createPercentage(grossSpread.toFixed(4)),
    netProfit: createPercentage(netProfit.toFixed(4)),
    estimatedProfitUsd: createUsdValue(profitUsd.toFixed(2)),
    fees: {
      buyFee: createPercentage('0.1'),
      sellFee: createPercentage('0.1'),
      totalFee: createPercentage('0.2'),
    },
    slippage: {
      estimated: createPercentage(slippage.toFixed(4)),
      withMultiplier: createPercentage((slippage * 1.1).toFixed(4)),
    },
    volume: {
      availableBase: createAmount('10'),
      tradeSizeBase: createAmount('0.05'),
      tradeSizeUsd: createUsdValue('5000'),
    },
    timestamp: nowTimestampMs(),
    orderbookAges: {
      buyMs: Math.floor(Math.random() * 500),
      sellMs: Math.floor(Math.random() * 500),
      maxMs: Math.floor(Math.random() * 500),
    },
    isStale: false,
    confidence: 0.7 + Math.random() * 0.3,
  };

  return {
    opportunity,
    isNew: true,
    priceChanged: false,
  };
}

async function main(): Promise<void> {
  logger.info('Starting Dashboard in standalone mode...');

  // Initialize store
  const store = getDashboardStore();

  // Initialize and start server
  const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  const server = getDashboardServer({ port: PORT, host: '0.0.0.0' }); 
  server.getApp().get('/health', (_req, res) => {
    res.status(200).send('OK - Right Order is alive');
  });
  await server.start();
  logger.info(`Dashboard server listening on http://0.0.0.0:${PORT}`);
  logger.info('Generating mock data for testing...');

  // Generate mock data periodically
  setInterval(() => {
    const event = generateMockSpread();
    store.pushOpportunity(event);
    
    // Log every 10th mock opportunity
    if (Math.random() < 0.1) {
      const opp = event.opportunity as SimpleArbitrageOpportunity;
      logger.info(
        {
          symbol: opp.symbol,
          route: `${opp.buyExchange}→${opp.sellExchange}`,
          net: opp.netProfit,
        },
        'Mock spread generated'
      );
    }
  }, 2000);
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down dashboard...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down dashboard...');
  process.exit(0);
});

void main();
