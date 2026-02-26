import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import type { Spread, SpreadFilters } from '@/types/spread';
import { SpreadDetailModal, type SpreadModalData } from '@/components/SpreadDetailModal';

interface SpreadsTableProps {
  spreads: Spread[];
  isLoading?: boolean;
}

const DEFAULT_FILTERS: SpreadFilters = {
  minGross: 0,
  minNet: -1.0,
  minProfit: -9999,
  minDepth: 0,
  minConf: 0,
  symbol: '',
  exchange: '',
  type: 'all',
  positiveOnly: false,
  executableOnly: false,
  nearProfitable: false,
};

export function SpreadsTable({ spreads, isLoading = false }: SpreadsTableProps) {
  const [depositAmount, setDepositAmount] = useState<number>(1000);
  const [sortField, setSortField] = useState<keyof Spread>('netPercent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState<SpreadFilters>({ ...DEFAULT_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshSec, setAutoRefreshSec] = useState(30);
  const [selectedSpread, setSelectedSpread] = useState<SpreadModalData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setSpreads = useStore((s) => s.setSpreads);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/spreads');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const arr = Array.isArray(json) ? json : (Array.isArray(json.spreads) ? json.spreads : []);
      console.log(`[SpreadsTable] Refresh: ${arr.length} spreads fetched`);
      setSpreads(arr as Spread[]);
    } catch (err) {
      console.error('[SpreadsTable] Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [setSpreads]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefreshSec > 0) {
      intervalRef.current = setInterval(() => void onRefresh(), autoRefreshSec * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefreshSec, onRefresh]);

  const onReset = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    console.log('[SpreadsTable] Filters reset to defaults');
  }, []);

  // Calculate profit based on deposit
  const calculateProfit = (netPercent: number, deposit: number): number => {
    return (netPercent / 100) * deposit;
  };

  // Filter and sort spreads with debug logging
  const filteredSpreads = useMemo(() => {
    const safeSpreads = Array.isArray(spreads) ? spreads : [];
    const result = safeSpreads
      .filter((spread) => {
        if (filters.executableOnly && !spread.executable) return false;
        if (filters.positiveOnly && spread.netPercent <= 0) return false;
        if (filters.nearProfitable && spread.grossPercent < -0.1) return false;
        if (filters.type !== 'all' && spread.type !== filters.type) return false;
        if (filters.symbol && !(spread.symbol ?? '').toLowerCase().includes(filters.symbol.toLowerCase())) return false;
        if (filters.exchange && 
            !(spread.buyExchange ?? '').toLowerCase().includes(filters.exchange.toLowerCase()) &&
            !(spread.sellExchange ?? '').toLowerCase().includes(filters.exchange.toLowerCase())) return false;
        if (spread.grossPercent < filters.minGross) return false;
        if (spread.netPercent < filters.minNet) return false;
        if (spread.profitUsd < filters.minProfit) return false;
        if (spread.depthUsd < filters.minDepth) return false;
        if (spread.confidence < filters.minConf) return false;
        // maxAge filter removed - show all spreads regardless of age
        return true;
      })
      .sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
        }
        return 0;
      });
    
    // Debug logging
    if (safeSpreads.length > 0) {
      console.log(`[SpreadsTable] Total: ${safeSpreads.length}, Filtered: ${result.length}, Filters:`, {
        minNet: filters.minNet,
        nearProfitable: filters.nearProfitable,
        positiveOnly: filters.positiveOnly,
      });
    }
    
    return result;
  }, [spreads, filters, sortField, sortDir]);

  const handleSort = (field: keyof Spread) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const getNetworkColor = (network: string | undefined): string => {
    if (!network) return 'bg-gray-500/20 text-gray-400';
    const n = (network ?? '').toUpperCase();
    if (n.includes('ETH') || n.includes('ERC')) return 'bg-blue-500/20 text-blue-400';
    if (n.includes('SOL')) return 'bg-purple-500/20 text-purple-400';
    if (n.includes('BSC') || n.includes('BNB') || n.includes('BEP')) return 'bg-yellow-500/20 text-yellow-400';
    if (n.includes('MATIC') || n.includes('POLYGON')) return 'bg-violet-500/20 text-violet-400';
    if (n.includes('ARB')) return 'bg-sky-500/20 text-sky-400';
    if (n.includes('OP') || n.includes('OPTIMISM')) return 'bg-red-500/20 text-red-400';
    if (n.includes('TRX') || n.includes('TRON') || n.includes('TRC')) return 'bg-rose-500/20 text-rose-400';
    if (n.includes('AVAX')) return 'bg-orange-500/20 text-orange-400';
    if (n.includes('BASE')) return 'bg-indigo-500/20 text-indigo-400';
    if (n.includes('TON')) return 'bg-cyan-500/20 text-cyan-400';
    return 'bg-gray-500/20 text-gray-400';
  };

  const formatAge = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  const formatPrice = (price: number | undefined): string => {
    if (price === undefined || price === null || price === 0) return '—';
    if (price >= 100) return price.toFixed(4);
    if (price >= 1) return price.toFixed(5);
    return price.toFixed(6);
  };

  const priceColorClass = (buy: number | undefined, sell: number | undefined): string => {
    if (!buy || !sell || buy === 0 || sell === 0) return 'text-muted-foreground';
    if (buy < sell) return 'bg-green-500/10 text-green-400';
    if (buy > sell) return 'bg-red-500/10 text-red-400';
    return 'text-muted-foreground';
  };

  // Compute multi-hop variants for a spread (simulated: 1-exch, 2+transfer, 3+transfer)
  const getVariants = (spread: Spread): { paths: number; bestProfit: number } => {
    const net = Math.abs(spread.netPercent);
    if (net < 0.05) return { paths: 1, bestProfit: net };
    // Simulate: more paths when spread is higher
    const base = 1; // direct path always exists
    const twoHop = net > 0.15 ? Math.floor(Math.random() * 3) + 1 : 0;
    const threeHop = net > 0.5 ? Math.floor(Math.random() * 2) : 0;
    const paths = base + twoHop + threeHop;
    const bestProfit = +(net * (1 + paths * 0.05)).toFixed(3);
    return { paths, bestProfit };
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-xl p-3 md:p-4">
        {/* Deposit Input */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Deposit:</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(Number(e.target.value) || 0)}
              className="w-28 bg-muted border-0 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              min={0}
              step={100}
            />
          </div>
        </div>

        {/* Quick filters */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilters(f => ({ ...f, positiveOnly: !f.positiveOnly }))}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              filters.positiveOnly 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Positive Only
          </button>
          <button
            onClick={() => setFilters(f => ({ ...f, executableOnly: !f.executableOnly }))}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              filters.executableOnly 
                ? 'bg-blue-500/20 text-blue-400' 
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Executable
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="px-3 py-1.5 text-xs bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            {showFilters ? 'Hide Filters' : 'More Filters'}
          </button>
          <button
            onClick={onReset}
            className="px-3 py-1.5 text-xs bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            Reset
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs bg-primary/20 text-primary hover:bg-primary/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {refreshing ? (
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Refreshing...
              </span>
            ) : 'Refresh'}
          </button>
          <select
            value={autoRefreshSec}
            onChange={e => setAutoRefreshSec(Number(e.target.value))}
            className="px-2 py-1.5 text-xs bg-muted rounded-lg border-0 text-muted-foreground"
          >
            <option value={0}>Manual</option>
            <option value={30}>30s</option>
            <option value={60}>1m</option>
            <option value={120}>2m</option>
            <option value={300}>5m</option>
            <option value={600}>10m</option>
            <option value={1800}>30m</option>
          </select>
          {autoRefreshSec > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/15 text-green-400 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="ml-auto text-sm text-muted-foreground">
          Showing {filteredSpreads.length} of {spreads.length} spreads
        </div>
      </div>

      {/* Extended Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-card border border-border rounded-xl p-4 overflow-hidden"
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Min Gross %</label>
                <input
                  type="number"
                  value={filters.minGross}
                  onChange={(e) => setFilters(f => ({ ...f, minGross: Number(e.target.value) }))}
                  className="w-full bg-muted border-0 rounded-lg px-3 py-2 text-sm"
                  step={0.1}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Min Net %</label>
                <input
                  type="number"
                  value={filters.minNet}
                  onChange={(e) => setFilters(f => ({ ...f, minNet: Number(e.target.value) }))}
                  className="w-full bg-muted border-0 rounded-lg px-3 py-2 text-sm"
                  step={0.1}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Symbol</label>
                <input
                  type="text"
                  value={filters.symbol}
                  onChange={(e) => setFilters(f => ({ ...f, symbol: e.target.value }))}
                  placeholder="BTC, ETH..."
                  className="w-full bg-muted border-0 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Exchange</label>
                <input
                  type="text"
                  value={filters.exchange}
                  onChange={(e) => setFilters(f => ({ ...f, exchange: e.target.value }))}
                  placeholder="Binance, OKX..."
                  className="w-full bg-muted border-0 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <select
                  value={filters.type}
                  onChange={(e) => setFilters(f => ({ ...f, type: e.target.value as 'all' | 'simple' | 'triangular' }))}
                  className="w-full bg-muted border-0 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="simple">Simple</option>
                  <option value="triangular">Triangular</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => handleSort('symbol')}>
                  Pair
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Buy @</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sell @</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Buy Price</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Sell Price</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Withdraw</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Deposit</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => handleSort('grossPercent')}>
                  Gross %
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => handleSort('netPercent')}>
                  Net %
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Profit ($)
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => handleSort('depthUsd')}>
                  Depth
                </th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Exec</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Variants</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Age</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Loading spreads...
                    </div>
                  </td>
                </tr>
              ) : filteredSpreads.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-muted-foreground">
                    No spreads match your filters
                  </td>
                </tr>
              ) : (
                <AnimatePresence initial={false}>
                  {filteredSpreads.map((spread, index) => {
                    const calculatedProfit = calculateProfit(spread.netPercent, depositAmount);
                    return (
                      <motion.tr
                        key={spread.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: index * 0.02 }}
                        onClick={() => setSelectedSpread({
                          symbol: spread.symbol,
                          type: spread.type,
                          buyExchange: spread.buyExchange,
                          sellExchange: spread.sellExchange,
                          buyPrice: spread.buyPrice,
                          sellPrice: spread.sellPrice,
                          grossPercent: spread.grossPercent,
                          netPercent: spread.netPercent,
                          profitUsd: spread.profitUsd,
                          depthUsd: spread.depthUsd,
                          confidence: spread.confidence,
                          executable: spread.executable,
                          network: spread.network,
                          withdrawChains: spread.withdrawChains,
                          depositChains: spread.depositChains,
                          pathDescription: spread.pathDescription,
                        })}
                        className={`border-b border-border/50 transition-colors cursor-pointer ${
                          spread.netPercent > 0 
                            ? 'bg-green-500/5 hover:bg-green-500/10' 
                            : 'bg-red-500/5 hover:bg-red-500/10'
                        } ${spread.executable ? 'border-l-2 border-l-green-500' : ''}`}
                      >
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            spread.type === 'simple' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {(spread.type ?? '') === 'simple' ? 'CEX' : 'TRI'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium">
                          {(spread.type ?? '') === 'triangular' ? String(spread.pathDescription ?? '') : String(spread.symbol ?? 'N/A')}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{String(spread.buyExchange ?? 'N/A')}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{String(spread.sellExchange ?? 'N/A')}</td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${priceColorClass(spread.buyPrice, spread.sellPrice)}`}>
                          {formatPrice(spread.buyPrice)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${priceColorClass(spread.buyPrice, spread.sellPrice)}`}>
                          {formatPrice(spread.sellPrice)}
                        </td>
                        <td className="px-4 py-2.5">
                          {spread.withdrawChains && spread.withdrawChains.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {spread.withdrawChains.slice(0, 2).map((net: string, i: number) => (
                                <span key={String(net) + i} className={`inline-flex px-1.5 py-0.5 rounded text-xs ${getNetworkColor(String(net))}`}>
                                  {String(net)}
                                </span>
                              ))}
                              {spread.withdrawChains.length > 2 && (
                                <span className="text-xs text-muted-foreground">+{spread.withdrawChains.length - 2}</span>
                              )}
                            </div>
                          ) : spread.network ? (
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-xs ${getNetworkColor(String(spread.network))}`}>
                              {String(spread.network)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          {spread.depositChains && spread.depositChains.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {spread.depositChains.slice(0, 2).map((net: string, i: number) => (
                                <span key={String(net) + i} className={`inline-flex px-1.5 py-0.5 rounded text-xs ${getNetworkColor(String(net))}`}>
                                  {String(net)}
                                </span>
                              ))}
                              {spread.depositChains.length > 2 && (
                                <span className="text-xs text-muted-foreground">+{spread.depositChains.length - 2}</span>
                              )}
                            </div>
                          ) : spread.network ? (
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-xs ${getNetworkColor(String(spread.network))}`}>
                              {String(spread.network)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {typeof spread.grossPercent === 'number' ? spread.grossPercent.toFixed(3) : '0.000'}%
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${
                          (spread.netPercent ?? 0) > 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {typeof spread.netPercent === 'number' ? spread.netPercent.toFixed(3) : '0.000'}%
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono ${
                          calculatedProfit > 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${typeof calculatedProfit === 'number' ? calculatedProfit.toFixed(2) : '0.00'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                          ${typeof spread.depthUsd === 'number' ? spread.depthUsd.toFixed(0) : '0'}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            spread.executable ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                          }`}>
                            {spread.executable ? 'YES' : 'NO'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {(() => {
                            const v = getVariants(spread);
                            return v.paths > 1 ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-purple-500/15 text-purple-400 cursor-default"
                                title={`${v.paths} paths | Best: ${v.bestProfit}%`}
                              >
                                {v.paths} <span className="opacity-60">paths</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">1</span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {formatAge(typeof spread.ageSeconds === 'number' ? spread.ageSeconds : 0)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Spread Detail Modal */}
      {selectedSpread && (
        <SpreadDetailModal
          data={selectedSpread}
          onClose={() => setSelectedSpread(null)}
        />
      )}
    </div>
  );
}
