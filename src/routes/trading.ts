import { Router, type Request, type Response } from 'express';
import { nowMs } from '../utils/time.js';
import { createLogger } from '../utils/logger.js';
import {
  getFundingSnapshot,
  getFundingStats,
  startFundingMonitor,
  isFundingMonitorRunning,
} from '../analysis/funding-rates.js';
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

const logger = createLogger('routes/trading');
const router = Router();

// Funding rates
router.get('/api/funding/rates', (_req: Request, res: Response) => {
  if (!isFundingMonitorRunning()) {
    startFundingMonitor().catch(err => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start funding monitor');
    });
  }
  const snapshot = getFundingSnapshot();
  const stats = getFundingStats();
  if (snapshot) {
    res.json({ success: true, timestamp: nowMs(), snapshot, stats });
  } else {
    res.json({
      success: true, timestamp: nowMs(),
      snapshot: { rates: [], yields: [], arbitrages: [], topPositive: [], topNegative: [], timestamp: nowMs() },
      stats,
      message: 'Funding monitor initializing...',
    });
  }
});

router.get('/api/funding/stats', (_req: Request, res: Response) => {
  const stats = getFundingStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

// Statistical arbitrage
router.get('/api/stat-arb/signals', (_req: Request, res: Response) => {
  if (!isStatArbRunning()) { startStatArb(); seedStatArbData(); }
  const signals = getStatArbSignals();
  const stats = getStatArbStats();
  res.json({ success: true, timestamp: nowMs(), signals, stats });
});

router.post('/api/stat-arb/refresh', (_req: Request, res: Response) => {
  if (!isStatArbRunning()) { startStatArb(); seedStatArbData(); }
  const signals = forceStatArbCompute();
  const stats = getStatArbStats();
  res.json({ success: true, timestamp: nowMs(), signals, stats, recomputed: true });
});

router.get('/api/stat-arb/stats', (_req: Request, res: Response) => {
  const stats = getStatArbStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

// Pairs trading
router.get('/api/pairs/signals', (_req: Request, res: Response) => {
  if (!isPairsTradingRunning()) { startPairsTrading(); seedPairsData(); }
  const signals = getPairsSignals();
  const cointegrated = getCointegratedPairs();
  const allCandidates = getAllPairCandidates();
  const stats = getPairsTradingStats();
  res.json({ success: true, timestamp: nowMs(), signals, cointegratedPairs: cointegrated, allCandidates, stats });
});

router.post('/api/pairs/refresh', (_req: Request, res: Response) => {
  if (!isPairsTradingRunning()) { startPairsTrading(); seedPairsData(); }
  const signals = forcePairsAnalyze();
  const cointegrated = getCointegratedPairs();
  const stats = getPairsTradingStats();
  res.json({ success: true, timestamp: nowMs(), signals, cointegratedPairs: cointegrated, stats, recomputed: true });
});

router.get('/api/pairs/stats', (_req: Request, res: Response) => {
  const stats = getPairsTradingStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

// Futures arbitrage
router.get('/api/futures/arb', (_req: Request, res: Response) => {
  if (!isFuturesArbRunning()) {
    startFuturesArb().catch(err => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start futures arb');
    });
  }
  const signals = getFuturesArbSignals();
  const stats = getFuturesArbStats();
  res.json({ success: true, timestamp: nowMs(), signals, stats });
});

router.get('/api/futures/arb/stats', (_req: Request, res: Response) => {
  const stats = getFuturesArbStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

// P2P arbitrage
router.get('/api/p2p/signals', (_req: Request, res: Response) => {
  if (!isP2PArbRunning()) startP2PArb();
  const signals = getP2PSignals();
  const stats = getP2PStats();
  res.json({ success: true, timestamp: nowMs(), signals, stats });
});

router.post('/api/p2p/refresh', (_req: Request, res: Response) => {
  if (!isP2PArbRunning()) startP2PArb();
  const signals = forceP2PScan();
  const stats = getP2PStats();
  res.json({ success: true, timestamp: nowMs(), signals, stats, recomputed: true });
});

router.get('/api/p2p/stats', (_req: Request, res: Response) => {
  const stats = getP2PStats();
  res.json({ success: true, timestamp: nowMs(), stats });
});

export default router;
