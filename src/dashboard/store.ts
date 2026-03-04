/**
 * Dashboard Store
 * In-memory storage for arbitrage opportunities with WebSocket broadcasting
 */

import type { WebSocket } from 'ws';

import type { ExchangeId } from '../config/schema.js';
import type { TradingSymbol, TimestampMs } from '../types/branded.js';
import type { ArbitrageOpportunity, OpportunityEvent } from '../types/opportunity.js';
import { createLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';
import { processSpreadAlert } from '../telegram/telegram-bot.js';

const logger = createLogger('dashboard-store');

/**
 * Raw spread data (before it becomes a full Opportunity)
 */
export interface RawSpreadData {
  id: string;
  type: 'simple' | 'triangular';
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  depthUsd: number;
  confidence: number;
  fees: number;
  slippage: number;
  timestamp: number;
  // Executable flag: net > 0 and sufficient depth
  executable?: boolean;
  // For triangular
  pathDescription?: string;
  // Transfer network info
  transferNetwork?: string;
  transferCostUsd?: number;
  netAfterTransfer?: number;
  // Chain/network data for old dashboard compatibility
  withdrawChains?: string[];
  depositChains?: string[];
  intersectionChains?: string[];
  minDepositUsd?: number;
  maxDepositUsd?: number;
  network?: string;
}

/**
 * Simplified spread data for dashboard display
 */
export interface DashboardSpread {
  id: string;
  type: 'simple' | 'triangular';
  symbol: TradingSymbol;
  buyExchange: string;
  sellExchange: string;
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  depthUsd: number;
  confidence: number;
  timestamp: TimestampMs;
  ageSeconds: number;
  // Executable flag: net > 0 and sufficient depth
  executable?: boolean;
  // For triangular
  pathDescription?: string;
  // Chain/network data
  withdrawChains?: string[];
  depositChains?: string[];
  intersectionChains?: string[];
  minDepositUsd?: number;
  maxDepositUsd?: number;
  network?: string;
  buyPrice?: number;
  sellPrice?: number;
}

/**
 * Dashboard metrics
 */
export interface DashboardStats {
  activeExchanges: Set<ExchangeId>;
  connectedExchanges: number;
  totalExchanges: number;
  activeSymbols: Set<TradingSymbol>;
  totalCalculations: number;
  bestGrossPercent: number;
  bestNetPercent: number;
  opportunitiesCount: number;
  uniqueSpreads: number;
  lastUpdate: TimestampMs;
  uptime: number;
}

/**
 * Log entry for dashboard
 */
export interface LogEntry {
  timestamp: number;
  level: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Dashboard Store configuration
 */
export interface DashboardStoreConfig {
  maxOpportunities: number;
  maxLogs: number;
  staleThresholdMs: number;
}

const DEFAULT_CONFIG: DashboardStoreConfig = {
  maxOpportunities: 500,
  maxLogs: 200,
  staleThresholdMs: 600000, // 10 minutes — keep spreads much longer
};

/**
 * WebSocket message types
 */
type WsMessageType = 'spread_update' | 'stats_update' | 'spreads_batch' | 'log_entry';

interface WsMessage {
  type: WsMessageType;
  data: unknown;
  timestamp: number;
}

/** Deduplication cooldown in ms (30s per unique route/symbol/type) */
const COOLDOWN_MS = 30000;

/** Price change threshold to consider as "new" even within cooldown */
const PRICE_CHANGE_THRESHOLD = 0.02; // 0.02%

/**
 * Track last seen for deduplication
 */
interface LastSeenEntry {
  timestamp: number;
  netPercent: number;
  grossPercent: number;
  buyPrice: number;
  sellPrice: number;
}

/**
 * Dashboard Store
 * Manages opportunities, stats, and WebSocket broadcasting
 */
class DashboardStore {
  private readonly config: DashboardStoreConfig;
  private readonly spreads: RawSpreadData[] = [];
  private readonly opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private readonly logs: LogEntry[] = [];
  private readonly wsClients: Set<WebSocket> = new Set();
  private readonly startTime: number;
  private spreadIdCounter = 0;

  // Deduplication: key = `${type}:${symbol}:${route}`
  private readonly lastSeen: Map<string, LastSeenEntry> = new Map();
  
  // Track unique routes ever seen (for counter)
  private readonly uniqueRoutes: Set<string> = new Set();

  private stats: DashboardStats = {
    activeExchanges: new Set(),
    connectedExchanges: 0,
    totalExchanges: 0,
    activeSymbols: new Set(),
    totalCalculations: 0,
    bestGrossPercent: 0,
    bestNetPercent: 0,
    opportunitiesCount: 0,
    uniqueSpreads: 0,
    lastUpdate: 0 as TimestampMs,
    uptime: 0,
  };

  constructor(config: Partial<DashboardStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = nowMs();

    // Cleanup stale opportunities and lastSeen periodically
    setInterval(() => {
      this.cleanupStale();
      this.cleanupLastSeen();
    }, 10000);

    logger.info(
      { maxOpportunities: this.config.maxOpportunities, maxLogs: this.config.maxLogs },
      'Dashboard store initialized'
    );
  }

  /**
   * Generate dedup key for a spread
   */
  private getSpreadKey(data: { type: string; symbol: string; buyExchange: string; sellExchange: string; pathDescription?: string }): string {
    if (data.type === 'triangular' && data.pathDescription !== undefined) {
      return `triangular:${data.pathDescription}`;
    }
    return `${data.type}:${data.symbol}:${data.buyExchange}→${data.sellExchange}`;
  }

  /**
   * Check if spread should be added (dedup + cooldown)
   * Uses symbol + route + type as unique key
   * isNew only if: new route OR price change >0.02%
   */
  private shouldAddSpread(
    key: string, 
    netPercent: number, 
    buyPrice: number,
    sellPrice: number,
    now: number
  ): { shouldAdd: boolean; isNew: boolean } {
    const last = this.lastSeen.get(key);
    const isNewRoute = !this.uniqueRoutes.has(key);

    if (last === undefined) {
      return { shouldAdd: true, isNew: true };
    }

    const timeSinceLastMs = now - last.timestamp;
    
    // Check for significant price change (>0.02% in net OR buy/sell price changed)
    const netChanged = Math.abs(netPercent - last.netPercent) > PRICE_CHANGE_THRESHOLD;
    const buyPriceChanged = Math.abs(buyPrice - last.buyPrice) / last.buyPrice > 0.0002; // 0.02%
    const sellPriceChanged = Math.abs(sellPrice - last.sellPrice) / last.sellPrice > 0.0002;
    const priceChanged = netChanged || buyPriceChanged || sellPriceChanged;

    // Within cooldown and no significant price change - skip entirely
    if (timeSinceLastMs < COOLDOWN_MS && !priceChanged) {
      return { shouldAdd: false, isNew: false };
    }

    // Cooldown passed OR price changed significantly -> add
    // isNew only if it's a new route or price actually changed
    return { shouldAdd: true, isNew: isNewRoute || priceChanged };
  }

  /**
   * Cleanup old lastSeen entries
   */
  private cleanupLastSeen(): void {
    const now = nowMs();
    const maxAge = COOLDOWN_MS * 10; // Keep for 80 seconds

    for (const [key, entry] of this.lastSeen) {
      if (now - entry.timestamp > maxAge) {
        this.lastSeen.delete(key);
      }
    }
  }

  /**
   * Add a WebSocket client for broadcasting
   */
  addClient(ws: WebSocket): void {
    this.wsClients.add(ws);
    logger.debug({ clients: this.wsClients.size }, 'WebSocket client connected');

    // Send current spreads on connect
    const recentSpreads = this.getRecent();
    this.sendToClient(ws, {
      type: 'spreads_batch',
      data: recentSpreads,
      timestamp: nowMs(),
    });
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
    logger.debug({ clients: this.wsClients.size }, 'WebSocket client disconnected');
  }

  /**
   * Clear all spreads
   */
  clearAll(): void {
    this.spreads.length = 0;
    this.opportunities.clear();
    this.lastSeen.clear();
    this.stats.opportunitiesCount = 0;
    logger.info('Dashboard cleared');

    // Broadcast clear to clients
    this.broadcast({
      type: 'spreads_batch',
      data: [],
      timestamp: nowMs(),
    });
  }

  /**
   * Add raw spread data (called from detectors for ALL calculations)
   * With deduplication and cooldown
   */
  addSpread(data: Omit<RawSpreadData, 'id' | 'timestamp'>): void {
    this.stats.totalCalculations++;
    const now = nowMs();

    // Generate dedup key
    const key = this.getSpreadKey(data);

    // Check cooldown and dedup
    const { shouldAdd, isNew } = this.shouldAddSpread(
      key, 
      data.netPercent, 
      data.buyPrice,
      data.sellPrice,
      now
    );

    if (!shouldAdd) {
      return; // Skip - within cooldown
    }

    // Track unique route
    this.uniqueRoutes.add(key);

    // Update lastSeen
    this.lastSeen.set(key, {
      timestamp: now,
      netPercent: data.netPercent,
      grossPercent: data.grossPercent,
      buyPrice: data.buyPrice,
      sellPrice: data.sellPrice,
    });

    // Sanity cap: reject unrealistic spreads BEFORE storing
    // > 20% net is not possible for CEX spot arbitrage
    const MAX_REALISTIC_NET = 20;
    if (Math.abs(data.netPercent) > MAX_REALISTIC_NET || Math.abs(data.grossPercent) > MAX_REALISTIC_NET) {
      logger.warn({
        symbol: data.symbol,
        net: data.netPercent.toFixed(4),
        gross: data.grossPercent.toFixed(4),
        route: `${data.buyExchange}->${data.sellExchange}`,
      }, `Rejected unrealistic spread: net=${data.netPercent.toFixed(4)}% gross=${data.grossPercent.toFixed(4)}%`);
      return;
    }

    const spread: RawSpreadData = {
      ...data,
      id: `spread_${++this.spreadIdCounter}`,
      timestamp: now,
    };

    // Dedup on add: remove similar entries (same key) from last 30s
    const dedupCutoff = now - COOLDOWN_MS;
    for (let i = this.spreads.length - 1; i >= 0; i--) {
      const existing = this.spreads[i] as RawSpreadData | undefined;
      if (existing !== undefined && existing.timestamp >= dedupCutoff) {
        const existingKey = this.getSpreadKey(existing);
        if (existingKey === key) {
          this.spreads.splice(i, 1);
        }
      }
    }

    // Add to array (newest first)
    this.spreads.unshift(spread);
    
    // Debug log for spread additions
    logger.debug({
      symbol: spread.symbol,
      net: spread.netPercent.toFixed(3),
      gross: spread.grossPercent.toFixed(3),
      route: `${spread.buyExchange} -> ${spread.sellExchange}`,
      isNew,
    }, `Spread added: ${spread.symbol} net ${spread.netPercent.toFixed(3)}%`);

    // Trim to max size
    if (this.spreads.length > this.config.maxOpportunities) {
      this.spreads.length = this.config.maxOpportunities;
    }

    // Update stats
    this.stats.activeExchanges.add(spread.buyExchange as ExchangeId);
    if (spread.sellExchange !== spread.buyExchange) {
      this.stats.activeExchanges.add(spread.sellExchange as ExchangeId);
    }
    this.stats.activeSymbols.add(spread.symbol as TradingSymbol);
    this.stats.lastUpdate = now as TimestampMs;
    this.stats.opportunitiesCount = this.spreads.length;
    
    // Increment unique spreads counter for new routes
    if (isNew) {
      this.stats.uniqueSpreads++;
    }

    // Log significant spreads
    if (spread.netPercent > -0.1 || spread.grossPercent > 0.1) {
      const typeTag = spread.type === 'simple' ? 'CEX' : 'TRI';
      const routeStr = spread.type === 'triangular' && spread.pathDescription !== undefined && spread.pathDescription.length > 0
        ? spread.pathDescription 
        : `${spread.buyExchange}→${spread.sellExchange}`;
      logger.info(
        {
          type: spread.type,
          symbol: spread.symbol,
          route: routeStr,
          gross: spread.grossPercent.toFixed(4),
          net: spread.netPercent.toFixed(4),
          isNew,
        },
        `[${typeTag}] ${isNew ? 'NEW' : 'UPD'} ${spread.symbol} ${routeStr} net=${spread.netPercent.toFixed(4)}%`
      );
    }

    // Trigger Telegram alerts for profitable spreads
    if (spread.netPercent > 0) {
      void processSpreadAlert({
        symbol: spread.symbol,
        buyExchange: spread.buyExchange,
        sellExchange: spread.sellExchange,
        netPercent: spread.netPercent,
        grossPercent: spread.grossPercent,
        profitUsd: spread.profitUsd,
        buyPrice: spread.buyPrice,
        sellPrice: spread.sellPrice,
      }).catch((err: unknown) => {
        logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Telegram alert error');
      });
    }

    // Broadcast to WebSocket clients (include isNew flag)
    this.broadcast({
      type: 'spread_update',
      data: { ...spread, isNew },
      timestamp: now,
    });
  }

  /**
   * Get recent spreads (top 50, sorted by net descending)
   */
  getRecent(limit = 50): RawSpreadData[] {
    return this.spreads
      .sort((a, b) => b.netPercent - a.netPercent)
      .slice(0, limit);
  }

  /**
   * Push an opportunity event from scanners (legacy method)
   */
  pushOpportunity(event: OpportunityEvent): void {
    const opp = event.opportunity;
    this.stats.totalCalculations++;

    // Store opportunity
    this.opportunities.set(opp.id, opp);

    // Trim if over limit
    if (this.opportunities.size > this.config.maxOpportunities) {
      const oldest = Array.from(this.opportunities.entries())
        .sort((a, b) => Number(a[1].timestamp) - Number(b[1].timestamp))
        .slice(0, Math.floor(this.config.maxOpportunities * 0.1));

      for (const [id] of oldest) {
        this.opportunities.delete(id);
      }
    }

    // Update stats
    this.updateStatsFromOpportunity(opp);

    // Broadcast to WebSocket clients
    const spread = this.opportunityToSpread(opp);
    this.broadcast({
      type: 'spread_update',
      data: spread,
      timestamp: nowMs(),
    });
  }

  /**
   * Push a log entry
   */
  pushLog(entry: LogEntry): void {
    this.logs.push(entry);

    // Trim if over limit
    if (this.logs.length > this.config.maxLogs) {
      this.logs.shift();
    }

    // Broadcast to clients
    this.broadcast({
      type: 'log_entry',
      data: entry,
      timestamp: nowMs(),
    });
  }

  /**
   * Get all spreads sorted by net profit descending
   * Uses both new raw spreads and legacy opportunities
   */
  getSpreads(filter?: {
    symbol?: string;
    exchanges?: string[];
    minGross?: number;
    minNet?: number;
    minProfit?: number;
    minDepth?: number;
    minConfidence?: number;
    maxAge?: number;
    type?: 'simple' | 'triangular' | 'dex' | 'funding';
    positiveNetOnly?: boolean;
    executableOnly?: boolean;
    nearProfitable?: boolean;
  }): DashboardSpread[] {
    const now = nowMs();
    
    // Get ALL raw spreads (no time filter — frontend handles display)
    let allSpreads: DashboardSpread[] = this.spreads
      .map((s) => {
        const spread: DashboardSpread = {
          id: s.id,
          type: s.type,
          symbol: s.symbol as TradingSymbol,
          buyExchange: s.buyExchange,
          sellExchange: s.sellExchange,
          grossPercent: s.grossPercent,
          netPercent: s.netPercent,
          profitUsd: s.profitUsd,
          depthUsd: s.depthUsd,
          confidence: s.confidence,
          timestamp: s.timestamp as TimestampMs,
          ageSeconds: Math.floor((now - s.timestamp) / 1000),
          buyPrice: s.buyPrice,
          sellPrice: s.sellPrice,
        };
        if (s.executable !== undefined) spread.executable = s.executable;
        if (s.pathDescription !== undefined) spread.pathDescription = s.pathDescription;
        if (s.withdrawChains !== undefined) spread.withdrawChains = s.withdrawChains;
        if (s.depositChains !== undefined) spread.depositChains = s.depositChains;
        if (s.intersectionChains !== undefined) spread.intersectionChains = s.intersectionChains;
        if (s.minDepositUsd !== undefined) spread.minDepositUsd = s.minDepositUsd;
        if (s.maxDepositUsd !== undefined) spread.maxDepositUsd = s.maxDepositUsd;
        const netw = s.network ?? s.transferNetwork;
        if (netw !== undefined) spread.network = netw;
        return spread;
      });

    // Also add legacy opportunities if any
    const legacySpreads = Array.from(this.opportunities.values())
      .map((opp) => this.opportunityToSpread(opp, now));
    
    // Merge (raw spreads take priority)
    const seenIds = new Set(allSpreads.map((s) => s.id));
    for (const spread of legacySpreads) {
      if (!seenIds.has(spread.id)) {
        allSpreads.push(spread);
      }
    }

    // Apply filters with defaults for showing all near-profitable spreads
    const minGross = filter?.minGross ?? -999;
    const minNet = filter?.minNet ?? -1.0; // Show spreads down to -1.0%

    allSpreads = allSpreads.filter((s) => {
      // Basic threshold: net > -1.0% OR gross > -0.5%
      if (s.netPercent < minNet && s.grossPercent < Math.max(minGross, -0.5)) {
        return false;
      }
      return true;
    });
    
    logger.info({ totalSpreads: allSpreads.length, minNet, minGross }, `Sending spreads: ${allSpreads.length}`);

    // Apply specific filters
    if (filter !== undefined) {
      if (filter.symbol !== undefined && filter.symbol.length > 0) {
        const symbolLower = filter.symbol.toLowerCase();
        allSpreads = allSpreads.filter((s) => s.symbol.toLowerCase().includes(symbolLower));
      }
      if (filter.exchanges !== undefined && filter.exchanges.length > 0) {
        allSpreads = allSpreads.filter(
          (s) =>
            filter.exchanges!.includes(s.buyExchange) ||
            filter.exchanges!.includes(s.sellExchange)
        );
      }
      if (filter.minGross !== undefined) {
        allSpreads = allSpreads.filter((s) => s.grossPercent >= filter.minGross!);
      }
      if (filter.minNet !== undefined) {
        allSpreads = allSpreads.filter((s) => s.netPercent >= filter.minNet!);
      }
      if (filter.minProfit !== undefined) {
        allSpreads = allSpreads.filter((s) => s.profitUsd >= filter.minProfit!);
      }
      if (filter.minDepth !== undefined) {
        allSpreads = allSpreads.filter((s) => s.depthUsd >= filter.minDepth!);
      }
      if (filter.minConfidence !== undefined) {
        allSpreads = allSpreads.filter((s) => s.confidence >= filter.minConfidence!);
      }
      if (filter.maxAge !== undefined) {
        allSpreads = allSpreads.filter((s) => s.ageSeconds <= filter.maxAge!);
      }
      if (filter.type !== undefined) {
        allSpreads = allSpreads.filter((s) => s.type === filter.type);
      }
      if (filter.positiveNetOnly === true) {
        allSpreads = allSpreads.filter((s) => s.netPercent > 0);
      }
      if (filter.executableOnly === true) {
        allSpreads = allSpreads.filter((s) => s.executable === true);
      }
      if (filter.nearProfitable === true) {
        allSpreads = allSpreads.filter((s) => s.grossPercent > 0.05);
      }
    }

    // Final dedup by route key — keep newest per key
    const dedupMap = new Map<string, DashboardSpread>();
    for (const s of allSpreads) {
      const key = this.getSpreadKey(s);
      const existing = dedupMap.get(key);
      if (!existing || s.timestamp > existing.timestamp) {
        dedupMap.set(key, s);
      }
    }
    const deduped = Array.from(dedupMap.values());
    if (deduped.length < allSpreads.length) {
      logger.debug({ before: allSpreads.length, after: deduped.length }, 'getSpreads deduped');
    }

    // Sort by net profit descending
    return deduped.sort((a, b) => b.netPercent - a.netPercent);
  }

  /**
   * Update connected exchanges count
   */
  updateExchangeCounts(connected: number, total: number): void {
    this.stats.connectedExchanges = connected;
    this.stats.totalExchanges = total;
  }

  /**
   * Get current stats
   */
  getStats(): DashboardStats {
    // Compute best net/gross from CURRENT spreads (not sticky running max)
    const { bestNet, bestGross } = this.computeBestPercents();

    return {
      ...this.stats,
      bestNetPercent: bestNet,
      bestGrossPercent: bestGross,
      opportunitiesCount: this.spreads.length,
      uniqueSpreads: this.uniqueRoutes.size,
      uptime: Math.floor((nowMs() - this.startTime) / 1000),
    };
  }

  /**
   * Compute best net/gross from current (non-stale) spreads
   * Returns 0 if no spreads exist
   */
  private computeBestPercents(): { bestNet: number; bestGross: number } {
    if (this.spreads.length === 0) {
      return { bestNet: 0, bestGross: 0 };
    }
    let bestNet = -Infinity;
    let bestGross = -Infinity;
    for (const s of this.spreads) {
      if (s.netPercent > bestNet) bestNet = s.netPercent;
      if (s.grossPercent > bestGross) bestGross = s.grossPercent;
    }
    return {
      bestNet: bestNet === -Infinity ? 0 : bestNet,
      bestGross: bestGross === -Infinity ? 0 : bestGross,
    };
  }

  /**
   * Get recent logs
   */
  getLogs(limit = 100): LogEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * Convert opportunity to dashboard spread format
   */
  private opportunityToSpread(opp: ArbitrageOpportunity, now: number = nowMs()): DashboardSpread {
    const ageSeconds = Math.floor((now - Number(opp.timestamp)) / 1000);

    if (opp.type === 'simple') {
      return {
        id: opp.id,
        type: 'simple',
        symbol: opp.symbol,
        buyExchange: opp.buyExchange,
        sellExchange: opp.sellExchange,
        grossPercent: parseFloat(opp.grossSpread),
        netPercent: parseFloat(opp.netProfit),
        profitUsd: parseFloat(opp.estimatedProfitUsd),
        depthUsd: parseFloat(opp.volume.tradeSizeUsd),
        confidence: opp.confidence,
        timestamp: opp.timestamp,
        ageSeconds,
      };
    }

    // Triangular opportunity
    // Calculate gross for triangular (net + fees + slippage)
    const gross =
      parseFloat(opp.netProfit) +
      parseFloat(opp.totalFees) +
      parseFloat(opp.estimatedSlippage);
    return {
      id: opp.id,
      type: 'triangular',
      symbol: opp.path[0].pair, // First pair as symbol
      buyExchange: opp.exchange,
      sellExchange: opp.exchange,
      grossPercent: gross,
      netPercent: parseFloat(opp.netProfit),
      profitUsd: parseFloat(opp.estimatedProfitUsd),
      depthUsd: parseFloat(opp.startAmount) * 1, // Rough estimate
      confidence: opp.confidence,
      timestamp: opp.timestamp,
      ageSeconds,
      pathDescription: opp.pathDescription,
    };
  }

  /**
   * Update stats from a new opportunity
   */
  private updateStatsFromOpportunity(opp: ArbitrageOpportunity): void {
    if (opp.type === 'simple') {
      this.stats.activeExchanges.add(opp.buyExchange);
      this.stats.activeExchanges.add(opp.sellExchange);
      this.stats.activeSymbols.add(opp.symbol);
    } else {
      this.stats.activeExchanges.add(opp.exchange);
      this.stats.activeSymbols.add(opp.path[0].pair);
    }

    // bestNetPercent / bestGrossPercent are now computed live in getStats()
    this.stats.lastUpdate = opp.timestamp;
  }

  /**
   * Cleanup stale opportunities
   */
  private cleanupStale(): void {
    const now = nowMs();
    const staleIds: string[] = [];

    for (const [id, opp] of this.opportunities) {
      if (now - Number(opp.timestamp) > this.config.staleThresholdMs) {
        staleIds.push(id);
      }
    }

    for (const id of staleIds) {
      this.opportunities.delete(id);
    }

    if (staleIds.length > 0) {
      logger.debug({ cleaned: staleIds.length }, 'Cleaned stale opportunities');
    }
  }

  /**
   * Broadcast message to all WebSocket clients
   */
  private broadcast(message: WsMessage): void {
    const payload = JSON.stringify(message);

    for (const client of this.wsClients) {
      try {
        if (client.readyState === 1) {
          // WebSocket.OPEN
          client.send(payload);
        }
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to broadcast to WebSocket client'
        );
      }
    }
  }

  /**
   * Send message to a single client
   */
  private sendToClient(client: WebSocket, message: WsMessage): void {
    try {
      if (client.readyState === 1) {
        client.send(JSON.stringify(message));
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to send to WebSocket client'
      );
    }
  }
}

// Singleton instance
let storeInstance: DashboardStore | null = null;

/**
 * Get the dashboard store singleton
 */
export function getDashboardStore(config?: Partial<DashboardStoreConfig>): DashboardStore {
  storeInstance ??= new DashboardStore(config);
  return storeInstance;
}

/**
 * Reset the store (for testing)
 */
export function resetDashboardStore(): void {
  storeInstance = null;
}
