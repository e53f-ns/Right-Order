/**
 * Dashboard Server
 * Express + WebSocket server for real-time arbitrage spread visualization
 */

import { createServer, type Server as HttpServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import express, { type Express, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';

import { createLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';

import { getDashboardStore } from './store.js';
import { getSymbolManagerStats } from '../utils/symbol-manager.js';
import {
  analyzeWallet,
  getCachedAnalysis,
  isValidAddress,
} from '../analysis/wallet-analysis.js';
import {
  getFundingSnapshot,
  getFundingStats,
  startFundingMonitor,
  isFundingMonitorRunning,
} from '../analysis/funding-rates.js';
import {
  getAlerts,
  getMessageStats,
  startMessageMonitor,
  isMessageMonitorRunning,
  getChannels,
} from '../analysis/message-monitor.js';
import {
  scanNFTs,
  getNFTOpportunities,
  getNFTScannerStats,
  type NFTChain,
} from '../analysis/nft-scanner.js';
import {
  initAIAssistant,
  chat,
  getChatHistory,
  clearSession,
  getAIStatus,
} from '../analysis/ai-assistant.js';
import {
  startDexScanner,
  getDexScannerStats,
  isDexScannerRunning,
  getDexConfigs,
} from '../scanner/dex-scanner.js';
import {
  register,
  login,
  refreshAccessToken,
  logout,
  logoutAll,
  updatePreferences,
  getAuthStats,
  updateSubscription,
  getUserById,
  getAllUsers,
  setUserRole,
  cleanupExpiredTokens,
  type SubscriptionPlan,
} from '../auth/auth-db.js';
import {
  getAllPlans,
  getPlanLimits,
  getPlanInfo,
} from '../auth/subscription.js';
import {
  applySecurityMiddleware,
  requireAuth,
  requireAdmin,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
} from '../auth/security.js';
import { setup2FA, verify2FA, confirm2FA, remove2FA } from '../auth/two-factor.js';
import {
  createCheckoutSession,
  handleStripeWebhook,
  createCryptoPayment,
  confirmCryptoPayment,
  stubUpgrade,
  getPaymentHistory,
  getAllPayments,
  getPendingCryptoPayments,
} from '../payments/stripe-service.js';
import { connectDatabase } from '../db/prisma.js';
import {
  setupTelegram,
  getTelegramStatus,
  toggleTelegram,
  updateMinNet,
  sendTestMessage,
} from '../telegram/telegram-bot.js';
import {
  startStatArb,
  isStatArbRunning,
  getStatArbSignals,
  getStatArbStats,
  forceCompute as forceStatArbCompute,
  seedHistoricalData as seedStatArbData,
} from '../strategies/stat-arb.js';
import {
  startPairsTrading,
  isPairsTradingRunning,
  getPairsSignals,
  getCointegratedPairs,
  getAllCandidates as getAllPairCandidates,
  getPairsTradingStats,
  forceAnalyze as forcePairsAnalyze,
  seedPairsData,
} from '../strategies/pairs-trading.js';
import {
  startFuturesArb,
  isFuturesArbRunning,
  getFuturesArbSignals,
  getFuturesArbStats,
} from '../strategies/futures-arb.js';
import {
  startP2PArb,
  isP2PArbRunning,
  getP2PSignals,
  getP2PStats,
  forceP2PScan,
} from '../strategies/p2p-arb.js';

const logger = createLogger('dashboard-server');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Server configuration
 */
export interface DashboardServerConfig {
  port: number;
  host: string;
}

const DEFAULT_CONFIG: DashboardServerConfig = {
  port: 3000,
  host: 'localhost',
};

/**
 * Dashboard Server class
 */
export class DashboardServer {
  private readonly config: DashboardServerConfig;
  private readonly app: Express;
  private readonly server: HttpServer;
  private readonly wss: WebSocketServer;
  private isRunning = false;

  constructor(config: Partial<DashboardServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize Express
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Stripe webhook needs raw body BEFORE json parser
    this.app.post('/api/payment/webhook', express.raw({ type: 'application/json' }));

    // JSON parsing (all other routes)
    this.app.use(express.json());

    // Security middleware (helmet, cors, rate limiting, cookie parser, extractUser)
    applySecurityMiddleware(this.app);

    // Static files from public directory
    const publicPath = join(__dirname, '../../public');
    this.app.use(express.static(publicPath));

    // EJS view engine
    const viewsPath = join(__dirname, '../../views');
    this.app.set('view engine', 'ejs');
    this.app.set('views', viewsPath);

    // Request logging
    this.app.use((req, _res, next) => {
      logger.debug({ method: req.method, path: req.path }, 'HTTP request');
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Main dashboard page
    this.app.get('/', (_req: Request, res: Response) => {
      const store = getDashboardStore();
      const spreads = store.getSpreads();
      const stats = store.getStats();

      res.render('index', {
        title: 'Arbitrage Dashboard',
        spreads,
        stats: {
          activeExchanges: Array.from(stats.activeExchanges),
          activeSymbols: stats.activeSymbols.size,
          totalCalculations: stats.totalCalculations,
          bestGrossPercent: stats.bestGrossPercent.toFixed(4),
          bestNetPercent: stats.bestNetPercent.toFixed(4),
          opportunitiesCount: stats.opportunitiesCount,
          uptime: stats.uptime,
        },
        refreshInterval: 5000,
      });
    });

    // API: Get spreads
    this.app.get('/api/spreads', (req: Request, res: Response) => {
      const store = getDashboardStore();

      // Parse query filters
      const symbolParam = req.query['symbol'];
      const exchangesParam = req.query['exchanges'];
      const minGrossParam = req.query['minGross'];
      const minNetParam = req.query['minNet'];

      const filter: {
        symbol?: string;
        exchanges?: string[];
        minGross?: number;
        minNet?: number;
      } = {};

      if (typeof symbolParam === 'string' && symbolParam.length > 0) {
        filter.symbol = symbolParam;
      }
      if (typeof exchangesParam === 'string' && exchangesParam.length > 0) {
        filter.exchanges = exchangesParam.split(',');
      }
      if (typeof minGrossParam === 'string') {
        filter.minGross = parseFloat(minGrossParam);
      }
      if (typeof minNetParam === 'string') {
        filter.minNet = parseFloat(minNetParam);
      }

      const spreads = store.getSpreads(filter);

      res.json({
        success: true,
        count: spreads.length,
        timestamp: nowMs(),
        spreads,
      });
    });

    // API: Spread detail (orderbook + networks + enhanced multi-hop variants)
    this.app.get('/api/spread/detail', (req: Request, res: Response) => {
      const { symbol, buyExchange, sellExchange } = req.query;
      if (!symbol || !buyExchange || !sellExchange) {
        res.status(400).json({ success: false, error: 'Missing symbol, buyExchange, or sellExchange' });
        return;
      }
      const sym = String(symbol);
      const buyEx = String(buyExchange);
      const sellEx = String(sellExchange);

      const store = getDashboardStore();
      const all = store.getSpreads();
      const spread = all.find(s => s.symbol === sym && s.buyExchange === buyEx && s.sellExchange === sellEx);

      // ── Network definitions (simulated — production: CCXT fetchCurrencies) ──
      const NETWORK_DB: Record<string, { withdrawFee: number; depositFee: number; confirmations: number; minTime: number; maxTime: number; enabled: boolean }> = {
        TRC20:   { withdrawFee: 1.0,  depositFee: 0, confirmations: 20,  minTime: 2,  maxTime: 5,  enabled: true },
        ERC20:   { withdrawFee: 5.0,  depositFee: 0, confirmations: 12,  minTime: 5,  maxTime: 30, enabled: true },
        BEP20:   { withdrawFee: 0.5,  depositFee: 0, confirmations: 15,  minTime: 2,  maxTime: 5,  enabled: true },
        SOL:     { withdrawFee: 0.01, depositFee: 0, confirmations: 32,  minTime: 1,  maxTime: 2,  enabled: true },
        ARB:     { withdrawFee: 0.3,  depositFee: 0, confirmations: 12,  minTime: 2,  maxTime: 5,  enabled: true },
        POLYGON: { withdrawFee: 0.5,  depositFee: 0, confirmations: 128, minTime: 3,  maxTime: 7,  enabled: true },
        ALGO:    { withdrawFee: 0.01, depositFee: 0, confirmations: 10,  minTime: 1,  maxTime: 3,  enabled: false },
        TON:     { withdrawFee: 0.1,  depositFee: 0, confirmations: 1,   minTime: 1,  maxTime: 3,  enabled: false },
        BASE:    { withdrawFee: 0.2,  depositFee: 0, confirmations: 12,  minTime: 2,  maxTime: 5,  enabled: true },
        AVAX:    { withdrawFee: 0.1,  depositFee: 0, confirmations: 26,  minTime: 1,  maxTime: 3,  enabled: true },
      };

      const deposit = 1000;
      const netPct = spread?.netPercent ?? 0;

      // Networks table
      const networks = Object.entries(NETWORK_DB).map(([network, n]) => {
        const grossProfit = (Math.abs(netPct) / 100) * deposit;
        const profitAfterFees = grossProfit - n.withdrawFee - n.depositFee;
        return {
          network,
          withdrawFee: n.withdrawFee,
          depositFee: n.depositFee,
          confirmations: n.confirmations,
          speed: `${n.minTime}-${n.maxTime} min`,
          enabled: n.enabled,
          profitAfterFees: +profitAfterFees.toFixed(2),
        };
      });

      // ── Orderbook (simulated top-5 levels) ──
      const basePrice = spread?.buyPrice ?? 1;
      const asks = Array.from({ length: 5 }, (_, i) => {
        const price = +(basePrice * (1 + (i + 1) * 0.0005)).toFixed(6);
        const amount = +(Math.random() * 50 + 5).toFixed(4);
        const total = +(price * amount).toFixed(2);
        return { price, amount, total };
      });
      const bids = Array.from({ length: 5 }, (_, i) => {
        const price = +(basePrice * (1 - (i + 1) * 0.0005)).toFixed(6);
        const amount = +(Math.random() * 50 + 5).toFixed(4);
        const total = +(price * amount).toFixed(2);
        return { price, amount, total };
      });
      const orderbook = {
        buyExchange: buyEx,
        sellExchange: sellEx,
        asks,
        bids,
        askDepthUsd: +asks.reduce((s, a) => s + a.total, 0).toFixed(2),
        bidDepthUsd: +bids.reduce((s, b) => s + b.total, 0).toFixed(2),
      };

      // ── Enhanced multi-hop variants ──

      // Exchange fee schedule (taker)
      const EX_FEES: Record<string, number> = {
        binance: 0.001, bybit: 0.001, okx: 0.001, kucoin: 0.001,
        gateio: 0.0015, mexc: 0.001, htx: 0.0015, bitget: 0.001,
        poloniex: 0.002, bitfinex: 0.002, kraken: 0.0026,
      };
      const getFee = (ex: string): number => EX_FEES[ex] ?? 0.002;

      // Fast networks ranked by preference (cheapest + fastest first)
      const FAST_NETS = ['SOL', 'TRC20', 'BEP20', 'ARB', 'BASE', 'AVAX', 'POLYGON', 'TON', 'ERC20'] as const;
      const pickNetwork = (): string => {
        const enabled = FAST_NETS.filter(n => NETWORK_DB[n]?.enabled);
        return enabled[Math.floor(Math.random() * Math.min(3, enabled.length))] ?? 'TRC20';
      };

      // Intermediate pairs used in multi-hop routing
      const baseAsset = sym.split('/')[0] ?? sym.replace(/USDT|USD|BUSD/, '');
      const quoteAsset = sym.split('/')[1] ?? 'USDT';

      interface PathStep {
        exchange: string;
        action: 'buy' | 'sell' | 'transfer';
        pair: string;
        network?: string;
      }
      interface EnhancedVariant {
        id: string;
        hops: number;
        steps: PathStep[];
        networks: string[];
        profitPercent: number;
        profitUsd: number;
        tradingFees: number;
        networkFees: number;
        totalFees: number;
        timeMinMin: number;
        timeMaxMin: number;
        transferTime: string;
        risk: 'low' | 'medium' | 'high';
        riskReasons: string[];
      }

      const buildVariant = (
        exchangePath: string[],
        intermediatePairs: string[],
      ): EnhancedVariant | null => {
        if (exchangePath.length < 2) return null;
        const hops = exchangePath.length - 1;
        const steps: PathStep[] = [];
        const networksUsed: string[] = [];
        let tradingFees = 0;
        let networkFees = 0;
        let timeMin = 0;
        let timeMax = 0;

        for (let i = 0; i < exchangePath.length; i++) {
          const ex = exchangePath[i]!;

          if (i === 0) {
            // First exchange: buy the asset
            const pair = `${baseAsset}/${quoteAsset}`;
            steps.push({ exchange: ex, action: 'buy', pair });
            tradingFees += deposit * getFee(ex);
          } else {
            // Transfer from previous exchange
            const net = pickNetwork();
            const netInfo = NETWORK_DB[net];
            networksUsed.push(net);
            steps.push({
              exchange: `${exchangePath[i - 1]!} → ${ex}`,
              action: 'transfer',
              pair: intermediatePairs[i - 1] ?? baseAsset,
              network: net,
            });
            if (netInfo) {
              networkFees += netInfo.withdrawFee;
              timeMin += netInfo.minTime;
              timeMax += netInfo.maxTime;
            }

            if (i < exchangePath.length - 1) {
              // Intermediate exchange: swap to next intermediate pair
              const fromAsset = intermediatePairs[i - 1] ?? baseAsset;
              const toAsset = intermediatePairs[i] ?? baseAsset;
              if (fromAsset !== toAsset) {
                steps.push({ exchange: ex, action: 'sell', pair: `${fromAsset}/${toAsset}` });
                tradingFees += deposit * getFee(ex);
              }
            } else {
              // Last exchange: sell
              const lastAsset = intermediatePairs[i - 1] ?? baseAsset;
              const finalPair = lastAsset === quoteAsset
                ? `${baseAsset}/${quoteAsset}`
                : `${lastAsset}/${quoteAsset}`;
              steps.push({ exchange: ex, action: 'sell', pair: finalPair });
              tradingFees += deposit * getFee(ex);
            }
          }
        }

        const totalFees = tradingFees + networkFees;

        // Spread improvement factor for multi-hop (simulated: more hops can find better rates)
        const spreadBonus = 1 + (hops - 1) * (Math.random() * 0.15 + 0.05);
        const profitPercent = Math.abs(netPct) * spreadBonus;
        const profitUsd = (profitPercent / 100) * deposit - totalFees;

        // Risk assessment
        const riskReasons: string[] = [];
        if (hops >= 4) riskReasons.push('Many hops increase slippage risk');
        if (hops >= 3) riskReasons.push('Extended transfer time');
        if (networkFees > 5) riskReasons.push('High network fees');
        if (timeMax > 20) riskReasons.push('Slow transfer, price may move');
        if (networksUsed.includes('ERC20')) riskReasons.push('ERC20 gas fees volatile');
        if (profitUsd < 2) riskReasons.push('Thin margin, fees may exceed profit');

        const risk: 'low' | 'medium' | 'high' =
          riskReasons.length >= 3 || hops >= 4 ? 'high' :
          riskReasons.length >= 1 || hops >= 3 ? 'medium' : 'low';

        const uniqueNets = [...new Set(networksUsed)];

        return {
          id: `${exchangePath.join('-')}-${hops}`,
          hops,
          steps,
          networks: uniqueNets,
          profitPercent: +profitPercent.toFixed(3),
          profitUsd: +profitUsd.toFixed(2),
          tradingFees: +tradingFees.toFixed(2),
          networkFees: +networkFees.toFixed(2),
          totalFees: +totalFees.toFixed(2),
          timeMinMin: timeMin,
          timeMaxMin: timeMax,
          transferTime: timeMin === 0 ? '< 1 min' : `${timeMin}-${timeMax} min`,
          risk,
          riskReasons,
        };
      };

      const exchanges = ['binance', 'bybit', 'okx', 'kucoin', 'gateio', 'mexc', 'htx', 'bitget'];
      const variants: EnhancedVariant[] = [];

      // 1-hop (direct transfer)
      const v1 = buildVariant([buyEx, sellEx], [baseAsset]);
      if (v1) variants.push(v1);

      // 2-hop (via intermediate exchange)
      const otherExs = exchanges.filter(e => e !== buyEx && e !== sellEx);
      for (const mid of otherExs.slice(0, 4)) {
        const v = buildVariant([buyEx, mid, sellEx], [baseAsset, baseAsset]);
        if (v) variants.push(v);
      }

      // 2-hop with pair swap (buy BTC, transfer, sell BTC→USDT)
      for (const interPair of ['BTC', 'ETH'] as const) {
        if (interPair === baseAsset) continue;
        const mid = otherExs[0];
        if (!mid) continue;
        const v = buildVariant([buyEx, mid, sellEx], [interPair, interPair]);
        if (v) variants.push(v);
      }

      // 3-hop
      if (otherExs.length >= 2) {
        for (let i = 0; i < Math.min(3, otherExs.length - 1); i++) {
          const v = buildVariant(
            [buyEx, otherExs[i]!, otherExs[i + 1]!, sellEx],
            [baseAsset, 'BTC', baseAsset],
          );
          if (v) variants.push(v);
        }
      }

      // 4-hop
      if (otherExs.length >= 3) {
        const v = buildVariant(
          [buyEx, otherExs[0]!, otherExs[1]!, otherExs[2]!, sellEx],
          [baseAsset, 'BTC', 'ETH', baseAsset],
        );
        if (v) variants.push(v);
      }

      // Sort by profit descending, take top 6
      variants.sort((a, b) => b.profitUsd - a.profitUsd);
      const topVariants = variants.slice(0, 6);

      logger.debug({ symbol: sym, variantCount: topVariants.length }, 'Spread detail generated');

      res.json({
        success: true,
        timestamp: nowMs(),
        spread: spread ?? null,
        networks,
        orderbook,
        variants: topVariants,
      });
    });

    // API: Get stats
    this.app.get('/api/stats', (_req: Request, res: Response) => {
      const store = getDashboardStore();
      const stats = store.getStats();
      const symbolStats = getSymbolManagerStats();

      res.json({
        success: true,
        timestamp: nowMs(),
        stats: {
          // Exchange counts (from store.updateExchangeCounts called by main loop)
          connectedExchanges: stats.connectedExchanges,
          totalExchanges: stats.totalExchanges,
          // Symbol count: use symbol-manager total (all symbols being scanned)
          // Falls back to symbols-with-spreads if symbol-manager not yet initialized
          activeSymbols: symbolStats.totalSymbols > 0
            ? symbolStats.totalSymbols
            : stats.activeSymbols.size,
          // Spread counts
          uniqueSpreads: stats.uniqueSpreads,
          opportunitiesCount: stats.opportunitiesCount,
          // Performance
          bestGrossPercent: stats.bestGrossPercent,
          bestNetPercent: stats.bestNetPercent,
          totalCalculations: stats.totalCalculations,
          lastUpdate: stats.lastUpdate,
          uptime: stats.uptime,
          // Legacy fields for backward compat
          activeExchanges: Array.from(stats.activeExchanges),
          activeExchangesCount: stats.activeExchanges.size,
          // Symbol manager detail
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

    // Stats page
    this.app.get('/stats', (_req: Request, res: Response) => {
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

    // Logs page
    this.app.get('/logs', (_req: Request, res: Response) => {
      const store = getDashboardStore();
      const logs = store.getLogs(100);

      res.render('logs', {
        title: 'Scanner Logs',
        logs,
      });
    });

    // API: Get logs
    this.app.get('/api/logs', (req: Request, res: Response) => {
      const store = getDashboardStore();
      const limitParam = req.query['limit'];
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 100;
      const logs = store.getLogs(Math.min(limit, 500));

      res.json({
        success: true,
        count: logs.length,
        timestamp: nowMs(),
        logs,
      });
    });

    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: nowMs(),
        uptime: process.uptime(),
      });
    });

    // Clear all spreads
    this.app.post('/api/clear', (_req: Request, res: Response) => {
      const store = getDashboardStore();
      store.clearAll();
      res.json({ success: true, message: 'All spreads cleared' });
    });

    // Generate test data (5 simple + 5 triangular)
    this.app.post('/api/test-data', (_req: Request, res: Response) => {
      const store = getDashboardStore();
      const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
      const exchanges = ['binance', 'bybit', 'okx', 'kucoin', 'gateio'];

      // Generate 5 simple arbitrage spreads
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

      // Generate 5 triangular arbitrage spreads
      const triPaths = [
        { path: 'USDT → BTC → ETH → USDT', symbol: 'BTC/USDT', exchange: 'binance' },
        { path: 'USDT → ETH → SOL → USDT', symbol: 'ETH/USDT', exchange: 'bybit' },
        { path: 'USDT → XRP → BTC → USDT', symbol: 'XRP/USDT', exchange: 'okx' },
        { path: 'USDT → SOL → ETH → USDT', symbol: 'SOL/USDT', exchange: 'kucoin' },
        { path: 'USDT → DOGE → BTC → USDT', symbol: 'DOGE/USDT', exchange: 'gateio' },
      ];

      for (let i = 0; i < 5; i++) {
        const triConfig = triPaths[i]!;
        const grossPercent = (Math.random() * 0.4) - 0.1; // -0.1% to 0.3%
        const fees = 0.3; // 3 trades = 0.3% fees
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

    // ========================================
    // Wallet Analysis API
    // ========================================

    // Analyze wallet
    this.app.post('/api/wallet/analyze', async (req: Request, res: Response) => {
      try {
        const { address } = req.body as { address?: string };

        if (!address || typeof address !== 'string') {
          res.status(400).json({ success: false, error: 'Address is required' });
          return;
        }

        if (!isValidAddress(address)) {
          res.status(400).json({ success: false, error: 'Invalid wallet address format' });
          return;
        }

        // Check cache first
        const cached = getCachedAnalysis(address);
        if (cached && Date.now() - cached.analyzedAt < 300000) {
          res.json({ success: true, result: cached, cached: true });
          return;
        }

        // Perform analysis
        const result = await analyzeWallet(address);
        res.json({ success: true, result, cached: false });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Wallet analysis error');
        res.status(500).json({ success: false, error: 'Analysis failed' });
      }
    });

    // Get cached wallet analysis
    this.app.get('/api/wallet/:address', (req: Request, res: Response) => {
      const address = req.params['address'] ?? '';
      const cached = getCachedAnalysis(address);

      if (cached) {
        res.json({ success: true, result: cached });
      } else {
        res.status(404).json({ success: false, error: 'No cached analysis found' });
      }
    });

    // ========================================
    // DEX Scanner API
    // ========================================

    // Get DEX opportunities — returns spreads that have DEX source in buyExchange or sellExchange
    this.app.get('/api/dex/opportunities', (req: Request, res: Response) => {
      // Auto-start DEX scanner if not running
      if (!isDexScannerRunning()) {
        startDexScanner().catch(err => {
          logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start DEX scanner');
        });
      }

      const store = getDashboardStore();
      const allSpreads = store.getSpreads();

      // Filter to DEX-related spreads (buyExchange or sellExchange contains a DEX name or chain marker)
      const dexKeywords = [
        'uniswap', 'sushiswap', 'pancakeswap', 'quickswap', 'trader_joe', 'camelot',
        'aerodrome', 'velodrome', 'balancer', 'curve', '1inch', 'oneinch', 'kyberswap',
        'raydium', 'orca', 'jupiter', 'dex', 'flash',
      ];
      const isDexSpread = (exchange: string): boolean => {
        const lower = exchange.toLowerCase();
        return dexKeywords.some(kw => lower.includes(kw)) || lower.includes(':');
      };

      let dexSpreads = allSpreads.filter(s =>
        isDexSpread(s.buyExchange) || isDexSpread(s.sellExchange)
      );

      // Apply query filters
      const chainParam = req.query['chain'];
      const dexParam = req.query['dex'];
      const typeParam = req.query['type'];
      const minNetParam = req.query['minNet'];

      if (typeof chainParam === 'string' && chainParam) {
        dexSpreads = dexSpreads.filter(s => {
          const combined = `${s.buyExchange}|${s.sellExchange}`.toLowerCase();
          return combined.includes(chainParam.toLowerCase());
        });
      }
      if (typeof dexParam === 'string' && dexParam) {
        dexSpreads = dexSpreads.filter(s => {
          const combined = `${s.buyExchange}|${s.sellExchange}`.toLowerCase();
          return combined.includes(dexParam.toLowerCase());
        });
      }
      if (typeof typeParam === 'string' && typeParam) {
        // cex_to_dex, dex_to_cex, flash_loan, new_pool
        dexSpreads = dexSpreads.filter(s => {
          const pathDesc = (s.pathDescription ?? '').toLowerCase();
          return pathDesc.includes(typeParam.toLowerCase());
        });
      }
      if (typeof minNetParam === 'string') {
        const minNet = parseFloat(minNetParam);
        if (!isNaN(minNet)) {
          dexSpreads = dexSpreads.filter(s => s.netPercent >= minNet);
        }
      }

      const stats = getDexScannerStats();

      res.json({
        success: true,
        timestamp: nowMs(),
        opportunities: dexSpreads.sort((a, b) => b.netPercent - a.netPercent),
        count: dexSpreads.length,
        scannerStats: stats,
      });
    });

    // Get DEX scanner stats
    this.app.get('/api/dex/stats', (_req: Request, res: Response) => {
      const stats = getDexScannerStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // Get DEX configurations (available DEXes)
    this.app.get('/api/dex/configs', (_req: Request, res: Response) => {
      const configs = getDexConfigs();
      res.json({ success: true, timestamp: nowMs(), configs });
    });

    // ========================================
    // Funding Rates API
    // ========================================

    // Get funding rates snapshot
    this.app.get('/api/funding/rates', (_req: Request, res: Response) => {
      // Auto-start funding monitor if not running
      if (!isFundingMonitorRunning()) {
        startFundingMonitor().catch(err => {
          logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start funding monitor');
        });
      }

      const snapshot = getFundingSnapshot();
      const stats = getFundingStats();

      if (snapshot) {
        res.json({
          success: true,
          timestamp: nowMs(),
          snapshot,
          stats,
        });
      } else {
        res.json({
          success: true,
          timestamp: nowMs(),
          snapshot: { rates: [], yields: [], arbitrages: [], topPositive: [], topNegative: [], timestamp: nowMs() },
          stats,
          message: 'Funding monitor initializing...',
        });
      }
    });

    // Get funding stats
    this.app.get('/api/funding/stats', (_req: Request, res: Response) => {
      const stats = getFundingStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // ========================================
    // Statistical Arbitrage API
    // ========================================

    this.app.get('/api/stat-arb/signals', (_req: Request, res: Response) => {
      if (!isStatArbRunning()) {
        startStatArb();
        seedStatArbData();
      }
      const signals = getStatArbSignals();
      const stats = getStatArbStats();
      res.json({ success: true, timestamp: nowMs(), signals, stats });
    });

    this.app.post('/api/stat-arb/refresh', (_req: Request, res: Response) => {
      if (!isStatArbRunning()) {
        startStatArb();
        seedStatArbData();
      }
      const signals = forceStatArbCompute();
      const stats = getStatArbStats();
      res.json({ success: true, timestamp: nowMs(), signals, stats, recomputed: true });
    });

    this.app.get('/api/stat-arb/stats', (_req: Request, res: Response) => {
      const stats = getStatArbStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // ========================================
    // Pairs Trading API
    // ========================================

    this.app.get('/api/pairs/signals', (_req: Request, res: Response) => {
      if (!isPairsTradingRunning()) {
        startPairsTrading();
        seedPairsData();
      }
      const signals = getPairsSignals();
      const cointegrated = getCointegratedPairs();
      const allCandidates = getAllPairCandidates();
      const stats = getPairsTradingStats();
      res.json({ success: true, timestamp: nowMs(), signals, cointegratedPairs: cointegrated, allCandidates, stats });
    });

    this.app.post('/api/pairs/refresh', (_req: Request, res: Response) => {
      if (!isPairsTradingRunning()) {
        startPairsTrading();
        seedPairsData();
      }
      const signals = forcePairsAnalyze();
      const cointegrated = getCointegratedPairs();
      const stats = getPairsTradingStats();
      res.json({ success: true, timestamp: nowMs(), signals, cointegratedPairs: cointegrated, stats, recomputed: true });
    });

    this.app.get('/api/pairs/stats', (_req: Request, res: Response) => {
      const stats = getPairsTradingStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // ========================================
    // Futures Arbitrage API
    // ========================================

    this.app.get('/api/futures/arb', (_req: Request, res: Response) => {
      if (!isFuturesArbRunning()) {
        startFuturesArb().catch(err => {
          logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start futures arb');
        });
      }
      const signals = getFuturesArbSignals();
      const stats = getFuturesArbStats();
      res.json({ success: true, timestamp: nowMs(), signals, stats });
    });

    this.app.get('/api/futures/arb/stats', (_req: Request, res: Response) => {
      const stats = getFuturesArbStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // ========================================
    // Message Monitor API
    // ========================================

    // Get message alerts
    this.app.get('/api/messages/alerts', (req: Request, res: Response) => {
      // Auto-start message monitor if not running
      if (!isMessageMonitorRunning()) {
        startMessageMonitor().catch(err => {
          logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start message monitor');
        });
      }

      const categoryParam = req.query['category'];
      const priorityParam = req.query['priority'];
      const limitParam = req.query['limit'];

      type AlertCategory = 'listing' | 'pump' | 'airdrop' | 'hack' | 'partnership' | 'launch' | 'whale' | 'general';
      type AlertPriority = 'high' | 'medium' | 'low';

      const filter: {
        category?: AlertCategory;
        priority?: AlertPriority;
        limit?: number;
      } = {};

      if (typeof categoryParam === 'string' && categoryParam) {
        filter.category = categoryParam as AlertCategory;
      }
      if (typeof priorityParam === 'string' && priorityParam) {
        filter.priority = priorityParam as AlertPriority;
      }
      if (typeof limitParam === 'string') {
        filter.limit = parseInt(limitParam, 10);
      }

      const alerts = getAlerts(filter);
      const stats = getMessageStats();

      res.json({
        success: true,
        timestamp: nowMs(),
        alerts,
        stats,
      });
    });

    // Get message stats
    this.app.get('/api/messages/stats', (_req: Request, res: Response) => {
      const stats = getMessageStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // Get monitored channels
    this.app.get('/api/messages/channels', (_req: Request, res: Response) => {
      const channels = getChannels();
      res.json({ success: true, timestamp: nowMs(), channels });
    });

    // ========================================
    // NFT Scanner API
    // ========================================

    // Scan for NFT opportunities
    this.app.post('/api/nfts/scan', async (req: Request, res: Response) => {
      try {
        const { chain, minProfit } = req.body as { chain?: string; minProfit?: number };
        const nftChain = (chain || 'ethereum') as NFTChain;
        const minProfitPercent = minProfit || 10;

        const result = await scanNFTs(nftChain, minProfitPercent);
        res.json({ success: true, timestamp: nowMs(), result });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'NFT scan error');
        res.status(500).json({ success: false, error: 'Scan failed' });
      }
    });

    // Get NFT opportunities
    this.app.get('/api/nfts/opportunities', (req: Request, res: Response) => {
      const chainParam = req.query['chain'];
      const minProfitParam = req.query['minProfit'];

      const filter: { chain?: NFTChain; minProfit?: number } = {};
      if (typeof chainParam === 'string' && chainParam) {
        filter.chain = chainParam as NFTChain;
      }
      if (typeof minProfitParam === 'string') {
        filter.minProfit = parseFloat(minProfitParam);
      }

      const opportunities = getNFTOpportunities(filter);
      const stats = getNFTScannerStats();

      res.json({
        success: true,
        timestamp: nowMs(),
        opportunities,
        stats,
      });
    });

    // Get NFT scanner stats
    this.app.get('/api/nfts/stats', (_req: Request, res: Response) => {
      const stats = getNFTScannerStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // ========================================
    // AI Assistant API
    // ========================================

    // Initialize AI assistant on first request
    let aiInitialized = false;

    // Chat with AI
    this.app.post('/api/ai/chat', async (req: Request, res: Response) => {
      try {
        if (!aiInitialized) {
          initAIAssistant();
          aiInitialized = true;
        }

        const { message, sessionId } = req.body as { message?: string; sessionId?: string };
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          res.status(400).json({ success: false, error: 'Message is required' });
          return;
        }

        const response = await chat(message.trim(), sessionId);
        res.json({
          success: !response.error,
          timestamp: nowMs(),
          response: response.content,
          sessionId: response.sessionId,
          model: response.model,
          tokensUsed: response.tokensUsed,
          ...(response.error ? { error: response.error } : {}),
          ...(response.rateLimited ? { rateLimited: true, retryAfter: response.retryAfter ?? 60 } : {}),
        });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'AI chat error');
        res.status(500).json({ success: false, error: 'Chat failed' });
      }
    });

    // Get chat history
    this.app.get('/api/ai/history/:sessionId', (req: Request, res: Response) => {
      const sessionId = req.params['sessionId'];
      if (!sessionId) {
        res.status(400).json({ success: false, error: 'Session ID required' });
        return;
      }
      const history = getChatHistory(sessionId);
      res.json({ success: true, timestamp: nowMs(), history });
    });

    // Clear chat session
    this.app.delete('/api/ai/session/:sessionId', (req: Request, res: Response) => {
      const sessionId = req.params['sessionId'];
      if (!sessionId) {
        res.status(400).json({ success: false, error: 'Session ID required' });
        return;
      }
      clearSession(sessionId);
      res.json({ success: true, timestamp: nowMs(), message: 'Session cleared' });
    });

    // Get AI status
    this.app.get('/api/ai/status', (_req: Request, res: Response) => {
      if (!aiInitialized) {
        initAIAssistant();
        aiInitialized = true;
      }
      const status = getAIStatus();
      res.json({ success: true, timestamp: nowMs(), status });
    });

    // ========================================
    // Auth API (Prisma + bcrypt + JWT + refresh tokens)
    // ========================================

    this.app.post('/api/auth/register', async (req: Request, res: Response) => {
      try {
        const { email, password } = req.body as { email?: string; password?: string };
        if (!email || !password) {
          res.status(400).json({ success: false, error: 'Email and password required' });
          return;
        }
        const ip = req.ip ?? req.socket.remoteAddress;
        const ua = req.headers['user-agent'];
        const result = await register(email, password, ip, ua);
        if (!result.success) {
          res.status(400).json(result);
          return;
        }
        // Set refresh token as HttpOnly cookie
        if (result.refreshToken) {
          res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
        }
        res.json({ success: true, timestamp: nowMs(), token: result.accessToken, user: result.user });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Register error');
        res.status(500).json({ success: false, error: 'Registration failed' });
      }
    });

    this.app.post('/api/auth/login', async (req: Request, res: Response) => {
      try {
        const { email, password } = req.body as { email?: string; password?: string };
        if (!email || !password) {
          res.status(400).json({ success: false, error: 'Email and password required' });
          return;
        }
        const ip = req.ip ?? req.socket.remoteAddress;
        const ua = req.headers['user-agent'];
        const result = await login(email, password, ip, ua);
        if (!result.success) {
          res.status(401).json(result);
          return;
        }
        if (result.refreshToken) {
          res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
        }
        res.json({ success: true, timestamp: nowMs(), token: result.accessToken, user: result.user });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Login error');
        res.status(500).json({ success: false, error: 'Login failed' });
      }
    });

    // Refresh access token using HttpOnly cookie
    this.app.post('/api/auth/refresh', async (req: Request, res: Response) => {
      try {
        const refreshToken = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE_NAME];
        if (!refreshToken) {
          res.status(401).json({ success: false, error: 'No refresh token' });
          return;
        }
        const ip = req.ip ?? req.socket.remoteAddress;
        const ua = req.headers['user-agent'];
        const result = await refreshAccessToken(refreshToken, ip, ua);
        if (!result.success) {
          res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
          res.status(401).json(result);
          return;
        }
        if (result.refreshToken) {
          res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
        }
        res.json({ success: true, timestamp: nowMs(), token: result.accessToken, user: result.user });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Refresh error');
        res.status(500).json({ success: false, error: 'Token refresh failed' });
      }
    });

    this.app.get('/api/auth/me', (req: Request, res: Response) => {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }
      res.json({ success: true, timestamp: nowMs(), user: req.user });
    });

    this.app.post('/api/auth/logout', async (req: Request, res: Response) => {
      const refreshToken = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE_NAME];
      if (refreshToken) await logout(refreshToken);
      res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
      res.json({ success: true, timestamp: nowMs(), message: 'Logged out' });
    });

    this.app.post('/api/auth/logout-all', requireAuth, async (req: Request, res: Response) => {
      await logoutAll(req.user!.id);
      res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
      res.json({ success: true, timestamp: nowMs(), message: 'All sessions revoked' });
    });

    this.app.put('/api/auth/preferences', requireAuth, async (req: Request, res: Response) => {
      const prefs = req.body as Record<string, unknown>;
      const updated = await updatePreferences(req.user!.id, prefs);
      if (!updated) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      res.json({ success: true, timestamp: nowMs(), user: updated });
    });

    this.app.get('/api/auth/stats', async (_req: Request, res: Response) => {
      const stats = await getAuthStats();
      res.json({ success: true, timestamp: nowMs(), ...stats });
    });

    // ========================================
    // 2FA API
    // ========================================

    this.app.post('/api/auth/2fa/setup', requireAuth, async (req: Request, res: Response) => {
      const result = await setup2FA(req.user!.id, req.user!.email);
      if (!result) {
        res.status(500).json({ success: false, error: 'Failed to setup 2FA' });
        return;
      }
      res.json({ success: true, timestamp: nowMs(), ...result });
    });

    this.app.post('/api/auth/2fa/confirm', requireAuth, async (req: Request, res: Response) => {
      const { token } = req.body as { token?: string };
      if (!token) {
        res.status(400).json({ success: false, error: 'TOTP token required' });
        return;
      }
      const ok = await confirm2FA(req.user!.id, token);
      if (!ok) {
        res.status(400).json({ success: false, error: 'Invalid TOTP token' });
        return;
      }
      res.json({ success: true, timestamp: nowMs(), message: '2FA enabled' });
    });

    this.app.post('/api/auth/2fa/verify', requireAuth, async (req: Request, res: Response) => {
      const { token } = req.body as { token?: string };
      if (!token) {
        res.status(400).json({ success: false, error: 'TOTP token required' });
        return;
      }
      const ok = await verify2FA(req.user!.id, token);
      res.json({ success: ok, timestamp: nowMs() });
    });

    this.app.post('/api/auth/2fa/disable', requireAuth, async (req: Request, res: Response) => {
      await remove2FA(req.user!.id);
      res.json({ success: true, timestamp: nowMs(), message: '2FA disabled' });
    });

    // ========================================
    // P2P Arbitrage API
    // ========================================

    this.app.get('/api/p2p/signals', (_req: Request, res: Response) => {
      if (!isP2PArbRunning()) {
        startP2PArb();
      }
      const signals = getP2PSignals();
      const stats = getP2PStats();
      res.json({ success: true, timestamp: nowMs(), signals, stats });
    });

    this.app.post('/api/p2p/refresh', (_req: Request, res: Response) => {
      if (!isP2PArbRunning()) {
        startP2PArb();
      }
      const signals = forceP2PScan();
      const stats = getP2PStats();
      res.json({ success: true, timestamp: nowMs(), signals, stats, recomputed: true });
    });

    this.app.get('/api/p2p/stats', (_req: Request, res: Response) => {
      const stats = getP2PStats();
      res.json({ success: true, timestamp: nowMs(), stats });
    });

    // ========================================
    // Subscription API
    // ========================================

    this.app.get('/api/subscription/plans', (_req: Request, res: Response) => {
      res.json({ success: true, timestamp: nowMs(), plans: getAllPlans() });
    });

    this.app.get('/api/subscription/status', requireAuth, (req: Request, res: Response) => {
      const plan = req.user!.subscription ?? 'free';
      const info = getPlanInfo(plan as SubscriptionPlan);
      const limits = getPlanLimits(plan as SubscriptionPlan);
      res.json({
        success: true, timestamp: nowMs(),
        subscription: { plan, planInfo: info, limits, expiresAt: req.user!.subscriptionExpiresAt, isPro: plan !== 'free' },
      });
    });

    // Stub upgrade (no payment — for testing / free-to-pro flow)
    this.app.post('/api/subscription/upgrade', requireAuth, async (req: Request, res: Response) => {
      const { plan, billing } = req.body as { plan?: string; billing?: 'monthly' | 'yearly' };
      const validPlans: SubscriptionPlan[] = ['free', 'pro', 'elite', 'ultimate'];
      if (!plan || !validPlans.includes(plan as SubscriptionPlan)) {
        res.status(400).json({ success: false, error: 'Invalid plan' });
        return;
      }
      const result = await stubUpgrade(req.user!.id, plan, billing ?? 'monthly');
      if (!result.success) { res.status(400).json(result); return; }

      const updated = await getUserById(req.user!.id);
      const info = getPlanInfo(plan as SubscriptionPlan);
      logger.info({ userId: req.user!.id, plan, billing }, 'Subscription upgrade (stub)');
      res.json({ success: true, timestamp: nowMs(), message: `Upgraded to ${info.name}`, user: updated, planInfo: info });
    });

    // ========================================
    // Payment API (Stripe + Crypto)
    // ========================================

    this.app.post('/api/payment/checkout', requireAuth, async (req: Request, res: Response) => {
      const { plan, billing } = req.body as { plan?: string; billing?: 'monthly' | 'yearly' };
      if (!plan || !billing) { res.status(400).json({ success: false, error: 'plan and billing required' }); return; }
      const baseUrl = `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
      const result = await createCheckoutSession(req.user!.id, req.user!.email, plan, billing, `${baseUrl}/dashboard?payment=success`, `${baseUrl}/pricing?payment=cancelled`);
      res.json({ ...result, timestamp: nowMs() });
    });

    this.app.post('/api/payment/webhook', async (req: Request, res: Response) => {
      const sig = req.headers['stripe-signature'] as string | undefined;
      if (!sig) { res.status(400).json({ success: false, error: 'No signature' }); return; }
      const result = await handleStripeWebhook(req.body as Buffer, sig);
      res.status(result.success ? 200 : 400).json(result);
    });

    this.app.post('/api/payment/crypto', requireAuth, async (req: Request, res: Response) => {
      const { plan, billing, network } = req.body as { plan?: string; billing?: 'monthly' | 'yearly'; network?: 'trc20' | 'erc20' };
      if (!plan || !billing || !network) { res.status(400).json({ success: false, error: 'plan, billing, network required' }); return; }
      const result = await createCryptoPayment(req.user!.id, plan, billing, network);
      res.json({ ...result, timestamp: nowMs() });
    });

    this.app.post('/api/payment/crypto/confirm', requireAdmin, async (req: Request, res: Response) => {
      const { paymentId, txHash } = req.body as { paymentId?: string; txHash?: string };
      if (!paymentId || !txHash) { res.status(400).json({ success: false, error: 'paymentId and txHash required' }); return; }
      const result = await confirmCryptoPayment(paymentId, txHash, req.user!.id);
      res.json({ ...result, timestamp: nowMs() });
    });

    this.app.get('/api/payment/history', requireAuth, async (req: Request, res: Response) => {
      const page = parseInt(String(req.query['page'] ?? '1'), 10);
      const result = await getPaymentHistory(req.user!.id, page);
      res.json({ success: true, timestamp: nowMs(), ...result });
    });

    // ========================================
    // Admin API
    // ========================================

    this.app.get('/api/admin/users', requireAdmin, async (req: Request, res: Response) => {
      const page = parseInt(String(req.query['page'] ?? '1'), 10);
      const limit = parseInt(String(req.query['limit'] ?? '50'), 10);
      const result = await getAllUsers(page, limit);
      res.json({ success: true, timestamp: nowMs(), ...result });
    });

    this.app.post('/api/admin/user/role', requireAdmin, async (req: Request, res: Response) => {
      const { userId, role } = req.body as { userId?: string; role?: string };
      if (!userId || !role || !['user', 'admin'].includes(role)) {
        res.status(400).json({ success: false, error: 'userId and role (user|admin) required' });
        return;
      }
      const updated = await setUserRole(userId, role as 'user' | 'admin');
      if (!updated) { res.status(404).json({ success: false, error: 'User not found' }); return; }
      res.json({ success: true, timestamp: nowMs(), user: updated });
    });

    this.app.post('/api/admin/user/subscription', requireAdmin, async (req: Request, res: Response) => {
      const { userId, plan } = req.body as { userId?: string; plan?: string };
      if (!userId || !plan) { res.status(400).json({ success: false, error: 'userId and plan required' }); return; }
      const expiresAt = plan === 'free' ? undefined : Date.now() + 365 * 24 * 60 * 60 * 1000;
      const updated = await updateSubscription(userId, plan as SubscriptionPlan, expiresAt);
      if (!updated) { res.status(404).json({ success: false, error: 'User not found' }); return; }
      res.json({ success: true, timestamp: nowMs(), user: updated });
    });

    this.app.post('/api/admin/cleanup-tokens', requireAdmin, async (_req: Request, res: Response) => {
      const count = await cleanupExpiredTokens();
      res.json({ success: true, timestamp: nowMs(), cleaned: count });
    });

    this.app.get('/api/admin/payments', requireAdmin, async (req: Request, res: Response) => {
      const page = parseInt(String(req.query['page'] ?? '1'), 10);
      const result = await getAllPayments(page);
      res.json({ success: true, timestamp: nowMs(), ...result });
    });

    this.app.get('/api/admin/payments/pending-crypto', requireAdmin, async (_req: Request, res: Response) => {
      const payments = await getPendingCryptoPayments();
      res.json({ success: true, timestamp: nowMs(), payments });
    });

    // ========================================
    // Telegram API
    // ========================================

    this.app.post('/api/telegram/setup', requireAuth, (req: Request, res: Response) => {
      const { chatId, minNetPercent } = req.body as { chatId?: string; minNetPercent?: number };
      if (!chatId) { res.status(400).json({ success: false, error: 'chatId is required' }); return; }
      const result = setupTelegram(req.user!.id, chatId, minNetPercent);
      res.json({ ...result, timestamp: nowMs() });
    });

    this.app.get('/api/telegram/status', requireAuth, (req: Request, res: Response) => {
      const result = getTelegramStatus(req.user!.id);
      res.json({ ...result, timestamp: nowMs() });
    });

    this.app.post('/api/telegram/toggle', requireAuth, (req: Request, res: Response) => {
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') { res.status(400).json({ success: false, error: 'enabled (boolean) is required' }); return; }
      const result = toggleTelegram(req.user!.id, enabled);
      res.json({ ...result, timestamp: nowMs() });
    });

    this.app.put('/api/telegram/min-net', requireAuth, (req: Request, res: Response) => {
      const { minNetPercent } = req.body as { minNetPercent?: number };
      if (typeof minNetPercent !== 'number' || minNetPercent < 0) { res.status(400).json({ success: false, error: 'minNetPercent (number >= 0) is required' }); return; }
      const result = updateMinNet(req.user!.id, minNetPercent);
      res.json({ ...result, timestamp: nowMs() });
    });

    const handleTelegramTest = async (req: Request, res: Response): Promise<void> => {
      if (!req.user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
      try {
        const result = await sendTestMessage(req.user.id);
        res.json({ ...result, timestamp: nowMs() });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Telegram test error');
        res.status(500).json({ success: false, error: 'Failed to send test message' });
      }
    };

    this.app.post('/api/telegram/test', handleTelegramTest);
    this.app.post('/api/telegram/send-test', handleTelegramTest);
  }

  /**
   * Setup WebSocket handling with ping/pong keep-alive
   */
  private setupWebSocket(): void {
    // Track alive status for each client
    const clientAliveMap = new Map<WebSocket, boolean>();

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress;
      logger.info({ clientIp }, 'WebSocket client connected');

      const store = getDashboardStore();
      store.addClient(ws);
      clientAliveMap.set(ws, true);

      // Handle incoming messages (including ping from client)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            // Respond with pong
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            clientAliveMap.set(ws, true);
          }
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      });

      ws.on('close', () => {
        store.removeClient(ws);
        clientAliveMap.delete(ws);
        logger.debug({ clientIp }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error(
          { error: error.message, clientIp },
          'WebSocket error'
        );
        store.removeClient(ws);
        clientAliveMap.delete(ws);
      });

      // Handle native ping/pong for keep-alive
      ws.on('pong', () => {
        clientAliveMap.set(ws, true);
        logger.debug({ clientIp }, 'WS pong received');
      });

      // Send initial data to client
      const spreads = store.getSpreads();
      const rawStats = store.getStats();
      
      // Serialize stats safely: Sets cannot be JSON.stringify'd (they become {})
      const safeStats = {
        connectedExchanges: rawStats.connectedExchanges,
        totalExchanges: rawStats.totalExchanges,
        activeSymbols: rawStats.activeSymbols instanceof Set ? rawStats.activeSymbols.size : (typeof rawStats.activeSymbols === 'number' ? rawStats.activeSymbols : 0),
        uniqueSpreads: rawStats.uniqueSpreads,
        bestNetPercent: rawStats.bestNetPercent,
        bestGrossPercent: rawStats.bestGrossPercent,
        totalCalculations: rawStats.totalCalculations,
        opportunitiesCount: rawStats.opportunitiesCount,
        uptime: rawStats.uptime,
      };

      logger.info({ count: spreads.length }, `WS initial send: ${spreads.length} spreads`);
      if (spreads.length > 0) {
        ws.send(JSON.stringify({ type: 'spreads', data: spreads, timestamp: Date.now() }));
      }
      ws.send(JSON.stringify({ type: 'stats', data: safeStats, timestamp: Date.now() }));
    });

    // Ping all clients every 15s, terminate if no pong within 45s (3 missed pings)
    let missedPongCount = new Map<WebSocket, number>();
    setInterval(() => {
      let alive = 0;
      let dead = 0;
      for (const ws of this.wss.clients) {
        if (ws.readyState === 1) {
          const isAlive = clientAliveMap.get(ws);
          if (isAlive === false) {
            const missed = (missedPongCount.get(ws) ?? 0) + 1;
            missedPongCount.set(ws, missed);
            if (missed >= 3) {
              // 3 missed pings (45s) — terminate
              logger.warn({ missed }, 'Terminating unresponsive WebSocket client (45s no pong)');
              ws.terminate();
              clientAliveMap.delete(ws);
              missedPongCount.delete(ws);
              dead++;
              continue;
            }
          } else {
            missedPongCount.set(ws, 0);
          }
          clientAliveMap.set(ws, false);
          ws.ping();
          alive++;
        }
      }
      logger.debug({ alive, dead }, 'WS ping sent to all clients');
    }, 15000);

    logger.info('WebSocket server configured with ping/pong keep-alive (15s interval, 45s timeout)');
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Server already running');
      return;
    }

    // Connect to PostgreSQL
    try {
      await connectDatabase();
    } catch (err: unknown) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'PostgreSQL not available — falling back to degraded mode (auth will fail)');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.config.port, this.config.host, () => {
          this.isRunning = true;
          logger.info(
            {
              host: this.config.host,
              port: this.config.port,
              url: `http://${this.config.host}:${this.config.port}`,
            },
            `Dashboard server started on http://${this.config.host}:${this.config.port}`
          );
          resolve();
        });

        this.server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            logger.error(
              { port: this.config.port },
              `Port ${this.config.port} is already in use`
            );
          }
          reject(error);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const ws of this.wss.clients) {
        ws.close();
      }

      this.server.close(() => {
        this.isRunning = false;
        logger.info('Dashboard server stopped');
        resolve();
      });
    });
  }

  /**
   * Get WebSocket server instance (for external integration)
   */
  getWss(): WebSocketServer {
    return this.wss;
  }

  /**
   * Check if server is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
let serverInstance: DashboardServer | null = null;

/**
 * Get dashboard server singleton
 */
export function getDashboardServer(
  config?: Partial<DashboardServerConfig>
): DashboardServer {
  serverInstance ??= new DashboardServer(config);
  return serverInstance;
}

/**
 * Reset server singleton (for testing)
 */
export function resetDashboardServer(): void {
  if (serverInstance !== null) {
    void serverInstance.stop();
    serverInstance = null;
  }
}
