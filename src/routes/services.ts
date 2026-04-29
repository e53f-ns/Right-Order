import { Router, type Request, type Response } from 'express';
import { nowMs } from '../utils/time.js';
import { createLogger } from '../utils/logger.js';
import {
  analyzeWallet,
  getCachedAnalysis,
  isValidAddress,
} from '../analysis/wallet-analysis.js';
import {
  startDexScanner,
  getDexScannerStats,
  isDexScannerRunning,
  getDexConfigs,
} from '../scanner/dex-scanner.js';
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
import { getDashboardStore } from '../dashboard/store.js';

const logger = createLogger('routes/services');
const router = Router();

// Wallet
router.post('/api/wallet/analyze', async (req: Request, res: Response) => {
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
    const cached = getCachedAnalysis(address);
    if (cached && Date.now() - cached.analyzedAt < 300000) {
      res.json({ success: true, result: cached, cached: true });
      return;
    }
    const result = await analyzeWallet(address);
    res.json({ success: true, result, cached: false });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Wallet analysis error');
    res.status(500).json({ success: false, error: 'Analysis failed' });
  }
});

router.get('/api/wallet/:address', (req: Request, res: Response) => {
  const address = req.params['address'] ?? '';
  const cached = getCachedAnalysis(address);
  if (cached) {
    res.json({ success: true, result: cached });
  } else {
    res.status(404).json({ success: false, error: 'No cached analysis found' });
  }
});

// DEX
router.get('/api/dex/opportunities', (req: Request, res: Response) => {
  if (!isDexScannerRunning()) {
    startDexScanner().catch(err => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start DEX scanner');
    });
  }

  const store = getDashboardStore();
  const allSpreads = store.getSpreads();

  const dexKeywords = [
    'uniswap', 'sushiswap', 'pancakeswap', 'quickswap', 'trader_joe', 'camelot',
    'aerodrome', 'velodrome', 'balancer', 'curve', '1inch', 'oneinch', 'kyberswap',
    'raydium', 'orca', 'jupiter', 'dex', 'flash',
  ];
  const isDexSpread = (exchange: string): boolean => {
    const lower = exchange.toLowerCase();
    return dexKeywords.some(kw => lower.includes(kw)) || lower.includes(':');
  };

  let dexSpreads = allSpreads.filter(s => isDexSpread(s.buyExchange) || isDexSpread(s.sellExchange));

  const chainParam = req.query['chain'];
  const dexParam = req.query['dex'];
  const typeParam = req.query['type'];
  const minNetParam = req.query['minNet'];

  if (typeof chainParam === 'string' && chainParam) {
    dexSpreads = dexSpreads.filter(s => `${s.buyExchange}|${s.sellExchange}`.toLowerCase().includes(chainParam.toLowerCase()));
  }
  if (typeof dexParam === 'string' && dexParam) {
    dexSpreads = dexSpreads.filter(s => `${s.buyExchange}|${s.sellExchange}`.toLowerCase().includes(dexParam.toLowerCase()));
  }
  if (typeof typeParam === 'string' && typeParam) {
    dexSpreads = dexSpreads.filter(s => (s.pathDescription ?? '').toLowerCase().includes(typeParam.toLowerCase()));
  }
  if (typeof minNetParam === 'string') {
    const minNet = parseFloat(minNetParam);
    if (!isNaN(minNet)) dexSpreads = dexSpreads.filter(s => s.netPercent >= minNet);
  }

  const stats = getDexScannerStats();
  res.json({
    success: true, timestamp: nowMs(),
    opportunities: dexSpreads.sort((a, b) => b.netPercent - a.netPercent),
    count: dexSpreads.length,
    scannerStats: stats,
  });
});

router.get('/api/dex/stats', (_req: Request, res: Response) => {
  const stats = getDexScannerStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

router.get('/api/dex/configs', (_req: Request, res: Response) => {
  const configs = getDexConfigs();
  res.json({ success: true, timestamp: nowMs(), configs });
});

// Messages
router.get('/api/messages/alerts', (req: Request, res: Response) => {
  if (!isMessageMonitorRunning()) {
    startMessageMonitor().catch(err => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start message monitor');
    });
  }

  type AlertCategory = 'listing' | 'pump' | 'airdrop' | 'hack' | 'partnership' | 'launch' | 'whale' | 'general';
  type AlertPriority = 'high' | 'medium' | 'low';

  const filter: { category?: AlertCategory; priority?: AlertPriority; limit?: number } = {};
  const categoryParam = req.query['category'];
  const priorityParam = req.query['priority'];
  const limitParam = req.query['limit'];

  if (typeof categoryParam === 'string' && categoryParam) filter.category = categoryParam as AlertCategory;
  if (typeof priorityParam === 'string' && priorityParam) filter.priority = priorityParam as AlertPriority;
  if (typeof limitParam === 'string') filter.limit = parseInt(limitParam, 10);

  const alerts = getAlerts(filter);
  const stats = getMessageStats();
  res.json({ success: true, timestamp: nowMs(), alerts, stats });
});

router.get('/api/messages/stats', (_req: Request, res: Response) => {
  const stats = getMessageStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

router.get('/api/messages/channels', (_req: Request, res: Response) => {
  const channels = getChannels();
  res.json({ success: true, timestamp: nowMs(), channels });
});

// NFTs
router.post('/api/nfts/scan', async (req: Request, res: Response) => {
  try {
    const { chain, minProfit } = req.body as { chain?: string; minProfit?: number };
    const nftChain = (chain || 'ethereum') as NFTChain;
    const result = await scanNFTs(nftChain, minProfit || 10);
    res.json({ success: true, timestamp: nowMs(), result });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'NFT scan error');
    res.status(500).json({ success: false, error: 'Scan failed' });
  }
});

router.get('/api/nfts/opportunities', (req: Request, res: Response) => {
  const filter: { chain?: NFTChain; minProfit?: number } = {};
  const chainParam = req.query['chain'];
  const minProfitParam = req.query['minProfit'];
  if (typeof chainParam === 'string' && chainParam) filter.chain = chainParam as NFTChain;
  if (typeof minProfitParam === 'string') filter.minProfit = parseFloat(minProfitParam);

  const opportunities = getNFTOpportunities(filter);
  const stats = getNFTScannerStats();
  res.json({ success: true, timestamp: nowMs(), opportunities, stats });
});

router.get('/api/nfts/stats', (_req: Request, res: Response) => {
  const stats = getNFTScannerStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

// AI assistant — lazy-initialized once per process
let aiInitialized = false;

router.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    if (!aiInitialized) { initAIAssistant(); aiInitialized = true; }
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

router.get('/api/ai/history/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params['sessionId'];
  if (!sessionId) { res.status(400).json({ success: false, error: 'Session ID required' }); return; }
  const history = getChatHistory(sessionId);
  res.json({ success: true, timestamp: nowMs(), history });
});

router.delete('/api/ai/session/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params['sessionId'];
  if (!sessionId) { res.status(400).json({ success: false, error: 'Session ID required' }); return; }
  clearSession(sessionId);
  res.json({ success: true, timestamp: nowMs(), message: 'Session cleared' });
});

router.get('/api/ai/status', (_req: Request, res: Response) => {
  if (!aiInitialized) { initAIAssistant(); aiInitialized = true; }
  const status = getAIStatus();
  res.json({ success: true, timestamp: nowMs(), status });
});

export default router;
