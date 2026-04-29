import { Router, type Request, type Response } from 'express';
import { getDashboardStore } from '../dashboard/store.js';
import { getSymbolManagerStats } from '../utils/symbol-manager.js';
import { nowMs } from '../utils/time.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('routes/scanner');
const router = Router();

router.get('/api/stats', (_req: Request, res: Response) => {
  const store = getDashboardStore();
  const stats = store.getStats();
  const symbolStats = getSymbolManagerStats();

  res.json({
    success: true,
    timestamp: nowMs(),
    stats: {
      connectedExchanges: stats.connectedExchanges,
      totalExchanges: stats.totalExchanges,
      activeSymbols: symbolStats.totalSymbols > 0
        ? symbolStats.totalSymbols
        : stats.activeSymbols.size,
      uniqueSpreads: stats.uniqueSpreads,
      opportunitiesCount: stats.opportunitiesCount,
      bestGrossPercent: stats.bestGrossPercent,
      bestNetPercent: stats.bestNetPercent,
      totalCalculations: stats.totalCalculations,
      lastUpdate: stats.lastUpdate,
      uptime: stats.uptime,
      activeExchanges: Array.from(stats.activeExchanges),
      activeExchangesCount: stats.activeExchanges.size,
      symbolManager: {
        total: symbolStats.totalSymbols,
        dynamic: symbolStats.dynamicCount,
        fallback: symbolStats.fallbackCount,
        arbitrage: symbolStats.arbitrageSymbols,
        exchanges: symbolStats.exchangeCount,
      },
    },
  });
});

router.get('/api/logs', (req: Request, res: Response) => {
  const store = getDashboardStore();
  const limitParam = req.query['limit'];
  const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 100;
  const logs = store.getLogs(Math.min(limit, 500));
  res.json({ success: true, count: logs.length, timestamp: nowMs(), logs });
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: nowMs(), uptime: process.uptime() });
});

router.post('/api/clear', (_req: Request, res: Response) => {
  const store = getDashboardStore();
  store.clearAll();
  res.json({ success: true, message: 'All spreads cleared' });
});

router.post('/api/test-data', (_req: Request, res: Response) => {
  // Dev-only endpoint — disabled in production
  if (process.env['NODE_ENV'] === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const store = getDashboardStore();
  const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
  const exchanges = ['binance', 'bybit', 'okx', 'kucoin', 'gateio'];

  for (let i = 0; i < 5; i++) {
    const symbol = symbols[i % symbols.length]!;
    const buyEx = exchanges[i % exchanges.length]!;
    const sellEx = exchanges[(i + 1) % exchanges.length]!;

    const basePrice = symbol === 'BTC/USDT' ? 95000 : symbol === 'ETH/USDT' ? 3200 : symbol === 'SOL/USDT' ? 180 : 1;
    const buyPrice = basePrice * (1 + (Math.random() * 0.002 - 0.001));
    const sellPrice = basePrice * (1 + (Math.random() * 0.003 - 0.001));
    const grossPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
    const fees = 0.2;
    const slippage = Math.random() * 0.1;
    const netPercent = grossPercent - fees - slippage;

    store.addSpread({
      type: 'simple',
      symbol,
      buyExchange: buyEx,
      sellExchange: sellEx,
      buyPrice,
      sellPrice,
      grossPercent,
      netPercent,
      profitUsd: (netPercent / 100) * 5000,
      depthUsd: 5000,
      confidence: 0.7 + Math.random() * 0.3,
      fees,
      slippage,
    });
  }

  const triPaths = [
    { path: 'USDT → BTC → ETH → USDT', symbol: 'BTC/USDT', exchange: 'binance' },
    { path: 'USDT → ETH → SOL → USDT', symbol: 'ETH/USDT', exchange: 'bybit' },
    { path: 'USDT → XRP → BTC → USDT', symbol: 'XRP/USDT', exchange: 'okx' },
    { path: 'USDT → SOL → ETH → USDT', symbol: 'SOL/USDT', exchange: 'kucoin' },
    { path: 'USDT → DOGE → BTC → USDT', symbol: 'DOGE/USDT', exchange: 'gateio' },
  ];

  for (let i = 0; i < 5; i++) {
    const triConfig = triPaths[i]!;
    const grossPercent = (Math.random() * 0.4) - 0.1;
    const fees = 0.3;
    const slippage = Math.random() * 0.15;
    const netPercent = grossPercent - fees - slippage;

    store.addSpread({
      type: 'triangular',
      symbol: triConfig.symbol,
      buyExchange: triConfig.exchange,
      sellExchange: triConfig.exchange,
      buyPrice: 0,
      sellPrice: 0,
      grossPercent,
      netPercent,
      profitUsd: (netPercent / 100) * 5000,
      depthUsd: 5000,
      confidence: 0.6 + Math.random() * 0.3,
      fees,
      slippage,
      pathDescription: triConfig.path,
    });
  }

  logger.info('Generated 10 test spreads (5 simple + 5 triangular)');
  res.json({ success: true, message: 'Generated 10 test spreads (5 simple + 5 triangular)' });
});

// Page renders
router.get('/stats', (_req: Request, res: Response) => {
  const store = getDashboardStore();
  const stats = store.getStats();
  const symbolStats = getSymbolManagerStats();

  res.render('stats', {
    title: 'Scanner Statistics',
    stats: {
      connectedExchanges: stats.connectedExchanges,
      totalExchanges: stats.totalExchanges,
      activeExchanges: Array.from(stats.activeExchanges),
      activeExchangesCount: stats.activeExchanges.size,
      activeSymbols: symbolStats.totalSymbols > 0 ? symbolStats.totalSymbols : stats.activeSymbols.size,
      totalCalculations: stats.totalCalculations,
      bestGrossPercent: stats.bestGrossPercent.toFixed(4),
      bestNetPercent: stats.bestNetPercent.toFixed(4),
      opportunitiesCount: stats.opportunitiesCount,
      uniqueSpreads: stats.uniqueSpreads,
      uptime: stats.uptime,
      lastUpdate: stats.lastUpdate !== 0 ? new Date(Number(stats.lastUpdate)).toISOString() : 'N/A',
    },
  });
});

router.get('/logs', (_req: Request, res: Response) => {
  const store = getDashboardStore();
  const logs = store.getLogs(100);
  res.render('logs', { title: 'Scanner Logs', logs });
});

export default router;
