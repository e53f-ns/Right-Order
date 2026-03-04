import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// --------------- Types ---------------
interface DexOpportunity {
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
  executable: boolean;
  fees: number;
  slippage: number;
  timestamp: number;
  type: string;
  pathDescription?: string;
  transferNetwork?: string;
  transferCostUsd?: number;
}

interface DexScannerStats {
  isRunning: boolean;
  poolCount: number;
  scanCount: number;
  opportunityCount: number;
  lastScan: number;
  enabledDexes: string[];
}

interface DexFilters {
  chain: string;
  dex: string;
  type: string;
  minNet: number;
  symbol: string;
}

// --------------- Constants ---------------
const CHAIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ethereum: { bg: '#627eea20', text: '#627eea', label: 'ETH' },
  bsc:      { bg: '#f0b90b20', text: '#f0b90b', label: 'BSC' },
  polygon:  { bg: '#8247e520', text: '#8247e5', label: 'POLY' },
  arbitrum: { bg: '#28a0f020', text: '#28a0f0', label: 'ARB' },
  optimism: { bg: '#ff042020', text: '#ff0420', label: 'OP' },
  base:     { bg: '#0052ff20', text: '#0052ff', label: 'BASE' },
  avalanche:{ bg: '#e8414120', text: '#e84141', label: 'AVAX' },
  solana:   { bg: '#9945ff20', text: '#9945ff', label: 'SOL' },
};

const DEX_LIST = [
  'All', 'Uniswap', 'SushiSwap', 'PancakeSwap', 'QuickSwap',
  'Camelot', 'Aerodrome', 'Velodrome', 'Balancer', 'Curve',
  'Trader Joe', 'Raydium', 'Orca', 'Jupiter', 'KyberSwap',
];

const CHAIN_LIST = [
  'All', 'ethereum', 'bsc', 'polygon', 'arbitrum',
  'optimism', 'base', 'avalanche', 'solana',
];

const TYPE_LIST = [
  { value: 'all', label: 'All Types' },
  { value: 'cex_to_dex', label: 'CEX → DEX' },
  { value: 'dex_to_cex', label: 'DEX → CEX' },
  { value: 'flash', label: 'Flash Loan' },
  { value: 'new_pool', label: 'New Pool' },
];

const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 1800, label: '30m' },
];

const DEFAULT_FILTERS: DexFilters = {
  chain: 'All',
  dex: 'All',
  type: 'all',
  minNet: -5,
  symbol: '',
};

// --------------- Helpers ---------------
function extractChain(opp: DexOpportunity): string {
  const network = opp.transferNetwork ?? '';
  const combined = `${opp.buyExchange ?? ''}|${opp.sellExchange ?? ''}|${network}`.toLowerCase();
  for (const chain of Object.keys(CHAIN_COLORS)) {
    if (combined.includes(chain)) return chain;
  }
  // Check common chain markers
  if (combined.includes('bsc') || combined.includes('pancake') || combined.includes('bnb')) return 'bsc';
  if (combined.includes('arb') || combined.includes('camelot')) return 'arbitrum';
  if (combined.includes('base') || combined.includes('aerodrome')) return 'base';
  if (combined.includes('op') || combined.includes('velodrome')) return 'optimism';
  if (combined.includes('sol') || combined.includes('raydium') || combined.includes('orca') || combined.includes('jupiter')) return 'solana';
  if (combined.includes('avax') || combined.includes('trader')) return 'avalanche';
  if (combined.includes('poly') || combined.includes('quick')) return 'polygon';
  return 'ethereum';
}

function extractDex(opp: DexOpportunity): string {
  const combined = `${opp.buyExchange ?? ''}|${opp.sellExchange ?? ''}`.toLowerCase();
  if (combined.includes('uniswap')) return 'Uniswap V3';
  if (combined.includes('sushi')) return 'SushiSwap';
  if (combined.includes('pancake')) return 'PancakeSwap';
  if (combined.includes('quick')) return 'QuickSwap';
  if (combined.includes('camelot')) return 'Camelot';
  if (combined.includes('aerodrome')) return 'Aerodrome';
  if (combined.includes('velodrome')) return 'Velodrome';
  if (combined.includes('balancer')) return 'Balancer';
  if (combined.includes('curve')) return 'Curve';
  if (combined.includes('trader')) return 'Trader Joe';
  if (combined.includes('raydium')) return 'Raydium';
  if (combined.includes('orca')) return 'Orca';
  if (combined.includes('jupiter')) return 'Jupiter';
  if (combined.includes('kyber')) return 'KyberSwap';
  if (combined.includes('1inch') || combined.includes('oneinch')) return '1inch';
  return (opp.buyExchange ?? '').includes(':') ? (opp.buyExchange ?? '').split('(')[0] ?? 'DEX' : (opp.sellExchange ?? '').split('(')[0] ?? 'DEX';
}

function extractType(opp: DexOpportunity): string {
  const path = (opp.pathDescription ?? '').toLowerCase();
  const combined = `${opp.buyExchange ?? ''}|${opp.sellExchange ?? ''}`.toLowerCase();
  if (path.includes('flash') || combined.includes('flash')) return 'flash_loan';
  if (path.includes('snipe') || path.includes('new_pool') || path.includes('new pool')) return 'new_pool';
  // If buyExchange is a known CEX and sell is DEX → cex_to_dex
  const cexNames = ['binance', 'bybit', 'okx', 'kucoin', 'gateio', 'bitget', 'huobi', 'mexc', 'aggregated'];
  const buyLower = (opp.buyExchange ?? '').toLowerCase();
  const sellLower = (opp.sellExchange ?? '').toLowerCase();
  if (cexNames.some(c => buyLower.includes(c))) return 'cex_to_dex';
  if (cexNames.some(c => sellLower.includes(c))) return 'dex_to_cex';
  return 'cex_to_dex';
}

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// --------------- Component ---------------
export function DexTab() {
  const [opportunities, setOpportunities] = useState<DexOpportunity[]>([]);
  const [scannerStats, setScannerStats] = useState<DexScannerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DexFilters>({ ...DEFAULT_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [sortField, setSortField] = useState<'netPercent' | 'grossPercent' | 'profitUsd' | 'depthUsd' | 'confidence' | 'timestamp'>('netPercent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch opportunities — merge with existing, keep old on error
  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/dex/opportunities');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const incoming: DexOpportunity[] = Array.isArray(json.opportunities) ? json.opportunities : [];
      // Merge: index by unique key, keep newer timestamps
      setOpportunities(prev => {
        const map = new Map<string, DexOpportunity>();
        for (const o of prev) map.set(`${o.symbol}|${o.buyExchange}|${o.sellExchange}`, o);
        for (const o of incoming) {
          const key = `${o.symbol}|${o.buyExchange}|${o.sellExchange}`;
          const existing = map.get(key);
          if (!existing || o.timestamp >= existing.timestamp) map.set(key, o);
        }
        const arr = Array.from(map.values());
        console.log(`[DexTab] Merged: ${incoming.length} incoming, total=${arr.length}`);
        return arr;
      });
      if (json.scannerStats) setScannerStats(json.scannerStats);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch DEX data';
      console.error('[DexTab] Fetch error:', msg);
      setError(msg);
      // Keep old data — do NOT clear opportunities
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => void fetchData(), refreshInterval * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval, fetchData]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = [...opportunities];

    if (filters.chain !== 'All') {
      result = result.filter(o => extractChain(o) === filters.chain);
    }
    if (filters.dex !== 'All') {
      result = result.filter(o => extractDex(o).toLowerCase().includes(filters.dex.toLowerCase()));
    }
    if (filters.type !== 'all') {
      result = result.filter(o => extractType(o) === filters.type);
    }
    if (filters.minNet > -100) {
      result = result.filter(o => o.netPercent >= filters.minNet);
    }
    if (filters.symbol) {
      const s = filters.symbol.toLowerCase();
      result = result.filter(o => o.symbol.toLowerCase().includes(s));
    }

    result.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortDir === 'desc' ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });

    return result;
  }, [opportunities, filters, sortField, sortDir]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIcon = (field: typeof sortField) =>
    sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  // --------------- Render ---------------
  const thCls = "px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap";
  const thSort = `${thCls} text-right cursor-pointer hover:text-foreground`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>DEX Scanner</h2>
          {scannerStats && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>Pools: <b className="text-foreground">{scannerStats.poolCount}</b></span>
              <span>Scans: <b className="text-foreground">{scannerStats.scanCount}</b></span>
              <span>Found: <b className="text-primary">{scannerStats.opportunityCount}</b></span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${scannerStats.isRunning ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <span className={`status-dot ${scannerStats.isRunning ? 'online' : 'offline'}`} />
                {scannerStats.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowFilters(!showFilters)}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-white/[0.02] text-muted-foreground border border-border hover:text-foreground">
            {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
          <button onClick={() => setFilters({ ...DEFAULT_FILTERS })}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-white/[0.02] text-muted-foreground border border-border">Reset</button>
          <button onClick={() => void fetchData(true)} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-primary/8 text-primary border border-primary/15 font-medium disabled:opacity-40">
            {refreshing ? '⟳ ...' : '⟳ Refresh'}
          </button>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
            className="input-field text-[11px] w-20 py-1.5">
            {REFRESH_INTERVALS.map(ri => <option key={ri.value} value={ri.value}>{ri.label}</option>)}
          </select>
          {refreshInterval > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400">
              <span className="status-dot online" /> Live
            </span>
          )}
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 glass-card rounded-xl p-4">
          <label className="text-[11px] text-muted-foreground">
            Chain
            <select value={filters.chain} onChange={e => setFilters(f => ({ ...f, chain: e.target.value }))}
              className="input-field text-xs mt-1 block w-full">{CHAIN_LIST.map(c => <option key={c} value={c}>{c === 'All' ? 'All Chains' : (CHAIN_COLORS[c]?.label ?? c)}</option>)}</select>
          </label>
          <label className="text-[11px] text-muted-foreground">
            DEX
            <select value={filters.dex} onChange={e => setFilters(f => ({ ...f, dex: e.target.value }))}
              className="input-field text-xs mt-1 block w-full">{DEX_LIST.map(d => <option key={d} value={d}>{d === 'All' ? 'All DEXes' : d}</option>)}</select>
          </label>
          <label className="text-[11px] text-muted-foreground">
            Type
            <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
              className="input-field text-xs mt-1 block w-full">{TYPE_LIST.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          </label>
          <label className="text-[11px] text-muted-foreground">
            Min Net %
            <input type="number" value={filters.minNet} step={0.1} onChange={e => setFilters(f => ({ ...f, minNet: parseFloat(e.target.value) || -100 }))}
              className="input-field text-xs mt-1 block w-full" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Symbol
            <input type="text" value={filters.symbol} placeholder="e.g. ETH" onChange={e => setFilters(f => ({ ...f, symbol: e.target.value }))}
              className="input-field text-xs mt-1 block w-full" />
          </label>
        </div>
      )}

      {/* Count */}
      <div className="text-[11px] text-muted-foreground px-1">
        {filtered.length} of {opportunities.length} opportunities
        {scannerStats?.lastScan ? ` · Last scan ${timeAgo(scannerStats.lastScan)} ago` : ''}
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {error && opportunities.length > 0 && (
          <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/10 flex items-center gap-2">
            <span className="text-red-400 text-[11px]">Refresh failed: {error} — cached data</span>
            <button onClick={() => void fetchData(true)}
              className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        )}
        {loading && opportunities.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Loading DEX scanner...</span>
          </div>
        ) : error && opportunities.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            {opportunities.length === 0
              ? 'DEX scanner is initializing — opportunities will appear shortly...'
              : 'No opportunities match current filters. Try adjusting filters.'}
          </div>
        ) : (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className={thCls}>Symbol</th>
                  <th className={thCls}>DEX</th>
                  <th className={thCls}>Chain</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Buy → Sell</th>
                  <th className={thSort} onClick={() => handleSort('grossPercent')}>Gross%{sortIcon('grossPercent')}</th>
                  <th className={thSort} onClick={() => handleSort('netPercent')}>Net%{sortIcon('netPercent')}</th>
                  <th className={`${thCls} text-right`}>Gas $</th>
                  <th className={thSort} onClick={() => handleSort('depthUsd')}>Liquidity{sortIcon('depthUsd')}</th>
                  <th className={thSort} onClick={() => handleSort('confidence')}>Conf{sortIcon('confidence')}</th>
                  <th className={`${thCls} text-right`}>Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((opp, idx) => {
                  const chain = extractChain(opp);
                  const dex = extractDex(opp);
                  const oppType = extractType(opp);
                  const chainColor = CHAIN_COLORS[chain] ?? { bg: '#33415520', text: '#94a3b8', label: (chain ?? '').slice(0, 4).toUpperCase() };
                  const netCls = opp.netPercent > 0 ? 'text-green-400' : opp.netPercent > -0.5 ? 'text-amber-400' : 'text-red-400';
                  const grossCls = opp.grossPercent > 0 ? 'text-green-400' : 'text-red-400';
                  const typeCls = oppType === 'flash_loan' ? 'bg-purple-500/15 text-purple-400' :
                    oppType === 'new_pool' ? 'bg-green-500/15 text-green-400' :
                    oppType === 'cex_to_dex' ? 'bg-primary/15 text-primary' : 'bg-amber-500/15 text-amber-400';
                  const typeLabel = oppType === 'cex_to_dex' ? 'CEX→DEX' :
                    oppType === 'dex_to_cex' ? 'DEX→CEX' :
                    oppType === 'flash_loan' ? 'Flash' : 'New Pool';

                  return (
                    <tr key={`${opp.symbol}-${opp.buyExchange}-${opp.sellExchange}-${idx}`}
                      className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{opp.symbol}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{dex}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: chainColor.bg, color: chainColor.text }}>
                          {chainColor.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${typeCls}`}>{typeLabel}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {(opp.buyExchange ?? '').length > 20 ? shortAddr(opp.buyExchange ?? '') : (opp.buyExchange ?? 'N/A')}
                        <span className="text-muted-foreground/40 mx-1">→</span>
                        {(opp.sellExchange ?? '').length > 20 ? shortAddr(opp.sellExchange ?? '') : (opp.sellExchange ?? 'N/A')}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${grossCls}`}>
                        {(opp.grossPercent ?? 0) >= 0 ? '+' : ''}{(opp.grossPercent ?? 0).toFixed(3)}%
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${netCls}`}>
                        {(opp.netPercent ?? 0) >= 0 ? '+' : ''}{(opp.netPercent ?? 0).toFixed(3)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                        {opp.transferCostUsd != null ? formatUsd(opp.transferCostUsd) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                        {opp.depthUsd > 0 ? formatUsd(opp.depthUsd) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          opp.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : opp.confidence >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>{((opp.confidence ?? 0) * 100).toFixed(0)}%</span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{timeAgo(opp.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
