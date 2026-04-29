import { Router, type Request, type Response } from 'express';
import { getDashboardStore } from '../dashboard/store.js';
import { nowMs } from '../utils/time.js';
import { fetchOrderbook, emptyOrderbook } from '../services/orderbook-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('routes/spreads');
const router = Router();

router.get('/api/spreads', (req: Request, res: Response) => {
  const store = getDashboardStore();

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
  res.json({ success: true, count: spreads.length, timestamp: nowMs(), spreads });
});

router.get('/api/spread/detail', async (req: Request, res: Response) => {
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

  // ── Orderbook (real data from CCXT) ──
  const realOb = await fetchOrderbook(buyEx, sym, 5);
  const obData = realOb ?? emptyOrderbook();
  const orderbook = {
    buyExchange: buyEx,
    sellExchange: sellEx,
    asks: obData.asks,
    bids: obData.bids,
    askDepthUsd: +obData.asks.reduce((s, a) => s + a.total, 0).toFixed(2),
    bidDepthUsd: +obData.bids.reduce((s, b) => s + b.total, 0).toFixed(2),
    realtime: obData.realtime,
    timestamp: obData.timestamp,
  };

  // ── Enhanced multi-hop variants ──

  const EX_FEES: Record<string, number> = {
    binance: 0.001, bybit: 0.001, okx: 0.001, kucoin: 0.001,
    gateio: 0.0015, mexc: 0.001, htx: 0.0015, bitget: 0.001,
    poloniex: 0.002, bitfinex: 0.002, kraken: 0.0026,
  };
  const getFee = (ex: string): number => EX_FEES[ex] ?? 0.002;

  const FAST_NETS = ['SOL', 'TRC20', 'BEP20', 'ARB', 'BASE', 'AVAX', 'POLYGON', 'TON', 'ERC20'] as const;
  const pickNetwork = (): string => {
    const enabled = FAST_NETS.filter(n => NETWORK_DB[n]?.enabled);
    return enabled[0] ?? 'TRC20';
  };

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
        const pair = `${baseAsset}/${quoteAsset}`;
        steps.push({ exchange: ex, action: 'buy', pair });
        tradingFees += deposit * getFee(ex);
      } else {
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
          const fromAsset = intermediatePairs[i - 1] ?? baseAsset;
          const toAsset = intermediatePairs[i] ?? baseAsset;
          if (fromAsset !== toAsset) {
            steps.push({ exchange: ex, action: 'sell', pair: `${fromAsset}/${toAsset}` });
            tradingFees += deposit * getFee(ex);
          }
        } else {
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

    // TODO: Calculate real spread from intermediate pair prices instead of flat multiplier
    const spreadBonus = 1.0;
    const profitPercent = Math.abs(netPct) * spreadBonus;
    const profitUsd = (profitPercent / 100) * deposit - totalFees;

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

  const v1 = buildVariant([buyEx, sellEx], [baseAsset]);
  if (v1) variants.push(v1);

  const otherExs = exchanges.filter(e => e !== buyEx && e !== sellEx);
  for (const mid of otherExs.slice(0, 4)) {
    const v = buildVariant([buyEx, mid, sellEx], [baseAsset, baseAsset]);
    if (v) variants.push(v);
  }

  for (const interPair of ['BTC', 'ETH'] as const) {
    if (interPair === baseAsset) continue;
    const mid = otherExs[0];
    if (!mid) continue;
    const v = buildVariant([buyEx, mid, sellEx], [interPair, interPair]);
    if (v) variants.push(v);
  }

  if (otherExs.length >= 2) {
    for (let i = 0; i < Math.min(3, otherExs.length - 1); i++) {
      const v = buildVariant(
        [buyEx, otherExs[i]!, otherExs[i + 1]!, sellEx],
        [baseAsset, 'BTC', baseAsset],
      );
      if (v) variants.push(v);
    }
  }

  if (otherExs.length >= 3) {
    const v = buildVariant(
      [buyEx, otherExs[0]!, otherExs[1]!, otherExs[2]!, sellEx],
      [baseAsset, 'BTC', 'ETH', baseAsset],
    );
    if (v) variants.push(v);
  }

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

export default router;
