/**
 * P2P Arbitrage + Multi-hop Strategy
 * Detects spreads between P2P platforms and CEX spot prices.
 * Finds multi-hop paths (1-4 exchanges + transfer).
 */

import { createLogger } from '../utils/logger.js';
import { getDashboardStore } from '../dashboard/store.js';
import { processP2PAlert } from '../telegram/telegram-bot.js';

const logger = createLogger('p2p-arb');

// ============================================================================
// Types
// ============================================================================

export interface P2PSignal {
  id: string;
  symbol: string;
  fiatCurrency: string;
  /** P2P platform name */
  p2pPlatform: string;
  /** CEX or target platform */
  cexPlatform: string;
  p2pPrice: number;
  cexPrice: number;
  spreadPercent: number;
  profitUsd: number;
  direction: 'buy_p2p_sell_cex' | 'buy_cex_sell_p2p';
  confidence: number;
  networkFee: number;
  transferTime: string;
  /** Multi-hop variant info */
  hops: number;
  hopPath: string[];
  variants: P2PVariant[];
  timestamp: number;
}

export interface P2PVariant {
  hops: number;
  path: string[];
  profitPercent: number;
  profitUsd: number;
  fees: number;
  transferTime: string;
}

export interface P2PStats {
  isRunning: boolean;
  totalSignals: number;
  bestSpread: number;
  platforms: number;
  fiatCurrencies: number;
  scanCount: number;
  lastScan: number;
  multiHopPaths: number;
}

// ============================================================================
// Constants
// ============================================================================

const P2P_PLATFORMS = ['binance_p2p', 'bybit_p2p', 'okx_p2p', 'huobi_p2p'] as const;
const FIAT_CURRENCIES = ['USD', 'EUR', 'RUB', 'TRY', 'UAH', 'KZT', 'BRL', 'ARS', 'NGN', 'INR'] as const;
const CEX_PLATFORMS = ['binance', 'bybit', 'okx', 'kucoin', 'gateio', 'huobi', 'mexc', 'bitget'] as const;
const SCAN_INTERVAL_MS = 60_000;
const NETWORK_FEES: Record<string, number> = {
  'TRC20': 1.0,
  'ERC20': 5.0,
  'BEP20': 0.5,
  'SOL': 0.01,
  'TON': 0.1,
  'POLYGON': 0.5,
  'ARB': 0.3,
};
const TRANSFER_TIMES: Record<string, string> = {
  'TRC20': '2-5 min',
  'ERC20': '5-15 min',
  'BEP20': '2-5 min',
  'SOL': '1-2 min',
  'TON': '1-3 min',
  'POLYGON': '3-7 min',
  'ARB': '2-5 min',
};

// ============================================================================
// State
// ============================================================================

let isRunning = false;
let scanInterval: ReturnType<typeof setInterval> | null = null;
let scanCount = 0;
const signals: Map<string, P2PSignal> = new Map();

// ============================================================================
// Simulated P2P price data (in production: real API calls)
// ============================================================================

function getSimulatedP2PPrice(platform: string, fiat: string, baseUsdPrice: number): number {
  // Simulate fiat exchange rates
  const fiatRates: Record<string, number> = {
    'USD': 1, 'EUR': 0.92, 'RUB': 92.5, 'TRY': 32.1, 'UAH': 41.2,
    'KZT': 460, 'BRL': 5.1, 'ARS': 870, 'NGN': 1580, 'INR': 83.5,
  };
  const rate = fiatRates[fiat] ?? 1;
  const fiatPrice = baseUsdPrice * rate;

  // Each platform has slight price variations (simulated spread)
  const platformOffsets: Record<string, number> = {
    'binance_p2p': 1.0 + (Math.random() * 0.04 - 0.015),
    'bybit_p2p': 1.0 + (Math.random() * 0.05 - 0.02),
    'okx_p2p': 1.0 + (Math.random() * 0.045 - 0.018),
    'huobi_p2p': 1.0 + (Math.random() * 0.06 - 0.025),
  };
  const offset = platformOffsets[platform] ?? 1.0;

  return +(fiatPrice * offset).toFixed(2);
}

function getCexSpotPrice(symbol: string): number {
  const store = getDashboardStore();
  const spreads = store.getSpreads();
  // Find any spread with this symbol to get a reference price
  const match = spreads.find(s => s.symbol === symbol && (s.buyPrice ?? 0) > 0);
  if (match && match.buyPrice) return match.buyPrice;
  // Fallback prices
  const fallbacks: Record<string, number> = {
    'USDT/USD': 1.0, 'USDT/EUR': 0.92, 'USDT/RUB': 92.5, 'USDT/TRY': 32.1,
    'BTC/USDT': 97000, 'ETH/USDT': 3400, 'USDT/UAH': 41.2, 'USDT/KZT': 460,
  };
  return fallbacks[symbol] ?? 1.0;
}

// ============================================================================
// Multi-hop path finding
// ============================================================================

function findMultiHopPaths(_symbol: string, fiat: string, p2pPlatform: string): P2PVariant[] {
  const variants: P2PVariant[] = [];
  const depositSize = 1000; // USD

  // 1-hop: direct P2P → CEX
  for (const cex of CEX_PLATFORMS) {
    const p2pPrice = getSimulatedP2PPrice(p2pPlatform, fiat, getCexSpotPrice(`USDT/${fiat}`));
    const cexPrice = getCexSpotPrice(`USDT/${fiat}`) * (fiatRateFor(fiat));
    const spread = ((cexPrice - p2pPrice) / p2pPrice) * 100;
    if (Math.abs(spread) > 0.1) {
      const fees = depositSize * 0.002; // 0.2% total fees
      const netProfit = (spread / 100) * depositSize - fees;
      variants.push({
        hops: 1,
        path: [p2pPlatform, cex],
        profitPercent: +spread.toFixed(3),
        profitUsd: +netProfit.toFixed(2),
        fees: +fees.toFixed(2),
        transferTime: '1-3 min',
      });
    }
  }

  // 2-hop: P2P → CEX1 → CEX2 (with transfer)
  for (let i = 0; i < CEX_PLATFORMS.length; i++) {
    for (let j = i + 1; j < CEX_PLATFORMS.length; j++) {
      const cex1 = CEX_PLATFORMS[i]!;
      const cex2 = CEX_PLATFORMS[j]!;
      const baseSpread = (Math.random() * 3 - 0.5);
      if (baseSpread > 0.3) {
        const fees = depositSize * 0.004 + (NETWORK_FEES['TRC20'] ?? 1);
        const netProfit = (baseSpread / 100) * depositSize - fees;
        variants.push({
          hops: 2,
          path: [p2pPlatform, cex1, cex2],
          profitPercent: +baseSpread.toFixed(3),
          profitUsd: +netProfit.toFixed(2),
          fees: +fees.toFixed(2),
          transferTime: TRANSFER_TIMES['TRC20'] ?? '2-5 min',
        });
      }
    }
  }

  // 3-hop: P2P → CEX1 → CEX2 → CEX3
  const cexArr = [...CEX_PLATFORMS];
  for (let i = 0; i < Math.min(cexArr.length, 4); i++) {
    for (let j = i + 1; j < Math.min(cexArr.length, 5); j++) {
      for (let k = j + 1; k < Math.min(cexArr.length, 6); k++) {
        const baseSpread = (Math.random() * 4 - 1);
        if (baseSpread > 0.8) {
          const fees = depositSize * 0.006 + 2 * (NETWORK_FEES['TRC20'] ?? 1);
          const netProfit = (baseSpread / 100) * depositSize - fees;
          variants.push({
            hops: 3,
            path: [p2pPlatform, cexArr[i]!, cexArr[j]!, cexArr[k]!],
            profitPercent: +baseSpread.toFixed(3),
            profitUsd: +netProfit.toFixed(2),
            fees: +fees.toFixed(2),
            transferTime: '5-15 min',
          });
        }
      }
    }
  }

  // 4-hop: P2P → CEX1 → CEX2 → CEX3 → CEX4
  for (let i = 0; i < Math.min(cexArr.length, 3); i++) {
    for (let j = i + 1; j < Math.min(cexArr.length, 4); j++) {
      for (let k = j + 1; k < Math.min(cexArr.length, 5); k++) {
        for (let l = k + 1; l < Math.min(cexArr.length, 6); l++) {
          const baseSpread = (Math.random() * 5 - 1.5);
          if (baseSpread > 1.5) {
            const fees = depositSize * 0.008 + 3 * (NETWORK_FEES['TRC20'] ?? 1);
            const netProfit = (baseSpread / 100) * depositSize - fees;
            variants.push({
              hops: 4,
              path: [p2pPlatform, cexArr[i]!, cexArr[j]!, cexArr[k]!, cexArr[l]!],
              profitPercent: +baseSpread.toFixed(3),
              profitUsd: +netProfit.toFixed(2),
              fees: +fees.toFixed(2),
              transferTime: '10-25 min',
            });
          }
        }
      }
    }
  }

  // Sort by profit desc, keep top 10
  return variants.sort((a, b) => b.profitPercent - a.profitPercent).slice(0, 10);
}

function fiatRateFor(fiat: string): number {
  const rates: Record<string, number> = {
    'USD': 1, 'EUR': 0.92, 'RUB': 92.5, 'TRY': 32.1, 'UAH': 41.2,
    'KZT': 460, 'BRL': 5.1, 'ARS': 870, 'NGN': 1580, 'INR': 83.5,
  };
  return rates[fiat] ?? 1;
}

// ============================================================================
// Scanner
// ============================================================================

function scan(): P2PSignal[] {
  const newSignals: P2PSignal[] = [];
  const depositSize = 1000;
  scanCount++;

  for (const p2p of P2P_PLATFORMS) {
    // Focus on USDT pairs for P2P (most liquid)
    for (const fiat of FIAT_CURRENCIES) {
      const symbol = `USDT/${fiat}`;
      const fiatRate = fiatRateFor(fiat);
      const cexUsdPrice = 1.0; // USDT ≈ $1
      const p2pPrice = getSimulatedP2PPrice(p2p, fiat, cexUsdPrice);
      const cexPrice = fiatRate; // 1 USDT = fiatRate in local currency

      const spreadPercent = ((cexPrice - p2pPrice) / p2pPrice) * 100;

      // Only keep meaningful spreads
      if (Math.abs(spreadPercent) < 0.05) continue;

      const direction = spreadPercent > 0 ? 'buy_p2p_sell_cex' : 'buy_cex_sell_p2p';
      const absSpread = Math.abs(spreadPercent);
      const tradingFees = depositSize * 0.002;
      const netFee = NETWORK_FEES['TRC20'] ?? 1;
      const profitUsd = (absSpread / 100) * depositSize - tradingFees - netFee;

      const variants = findMultiHopPaths(symbol, fiat, p2p);
      const bestVariant = variants[0];

      const confidence = Math.min(0.95, 0.3 + absSpread * 0.15 + (variants.length > 3 ? 0.1 : 0));

      const id = `${p2p}-${fiat}-${Date.now().toString(36)}`;

      const sig: P2PSignal = {
        id,
        symbol,
        fiatCurrency: fiat,
        p2pPlatform: p2p,
        cexPlatform: bestVariant ? bestVariant.path[1] ?? 'binance' : 'binance',
        p2pPrice,
        cexPrice,
        spreadPercent: +absSpread.toFixed(3),
        profitUsd: +profitUsd.toFixed(2),
        direction,
        confidence: +confidence.toFixed(2),
        networkFee: netFee,
        transferTime: TRANSFER_TIMES['TRC20'] ?? '2-5 min',
        hops: bestVariant?.hops ?? 1,
        hopPath: bestVariant?.path ?? [p2p, 'binance'],
        variants,
        timestamp: Date.now(),
      };

      newSignals.push(sig);
    }
  }

  // Merge into signals map (keep best per platform+fiat)
  for (const sig of newSignals) {
    const key = `${sig.p2pPlatform}-${sig.fiatCurrency}`;
    const existing = signals.get(key);
    if (!existing || sig.spreadPercent > existing.spreadPercent) {
      signals.set(key, sig);
    }
  }

  // Remove stale signals (>5 min)
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, v] of signals) {
    if (v.timestamp < cutoff) signals.delete(k);
  }

  // Fire Telegram alerts for qualifying signals
  for (const sig of newSignals) {
    const threshold = sig.hops > 1 ? 3.0 : 1.0;
    if (sig.spreadPercent >= threshold) {
      processP2PAlert({
        symbol: sig.symbol,
        fiatCurrency: sig.fiatCurrency,
        p2pPlatform: sig.p2pPlatform,
        cexPlatform: sig.cexPlatform,
        p2pPrice: sig.p2pPrice,
        cexPrice: sig.cexPrice,
        spreadPercent: sig.spreadPercent,
        profitUsd: sig.profitUsd,
        direction: sig.direction,
        hops: sig.hops,
        hopPath: sig.hopPath,
        confidence: sig.confidence,
      }).catch(err => logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'P2P alert send failed'));
    }
  }

  logger.info({ scanCount, newSignals: newSignals.length, total: signals.size }, 'P2P scan complete');
  return newSignals;
}

// ============================================================================
// Public API
// ============================================================================

export function startP2PArb(): void {
  if (isRunning) return;
  isRunning = true;

  // Initial scan
  scan();

  scanInterval = setInterval(() => {
    try { scan(); } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'P2P scan error');
    }
  }, SCAN_INTERVAL_MS);

  logger.info('P2P Arbitrage scanner started');
}

export function stopP2PArb(): void {
  if (scanInterval) clearInterval(scanInterval);
  isRunning = false;
  logger.info('P2P Arbitrage scanner stopped');
}

export function isP2PArbRunning(): boolean {
  return isRunning;
}

export function getP2PSignals(): P2PSignal[] {
  return Array.from(signals.values())
    .sort((a, b) => b.spreadPercent - a.spreadPercent);
}

export function getP2PStats(): P2PStats {
  const sigs = Array.from(signals.values());
  const platforms = new Set(sigs.map(s => s.p2pPlatform));
  const fiats = new Set(sigs.map(s => s.fiatCurrency));
  const multiHop = sigs.filter(s => s.hops > 1).length;

  return {
    isRunning,
    totalSignals: sigs.length,
    bestSpread: sigs.length > 0 ? Math.max(...sigs.map(s => s.spreadPercent)) : 0,
    platforms: platforms.size,
    fiatCurrencies: fiats.size,
    scanCount,
    lastScan: sigs.length > 0 ? Math.max(...sigs.map(s => s.timestamp)) : 0,
    multiHopPaths: multiHop,
  };
}

/** Force immediate rescan */
export function forceP2PScan(): P2PSignal[] {
  return scan();
}
