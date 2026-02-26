import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { exportToCsv } from '@/utils/exportCsv';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { SpreadDetailModal, type SpreadModalData } from '@/components/SpreadDetailModal';

// ─── Types ───
interface P2PVariant {
  hops: number;
  path: string[];
  profitPercent: number;
  profitUsd: number;
  fees: number;
  transferTime: string;
}

interface P2PSignal {
  id: string;
  symbol: string;
  fiatCurrency: string;
  p2pPlatform: string;
  cexPlatform: string;
  p2pPrice: number;
  cexPrice: number;
  spreadPercent: number;
  profitUsd: number;
  direction: 'buy_p2p_sell_cex' | 'buy_cex_sell_p2p';
  confidence: number;
  networkFee: number;
  transferTime: string;
  hops: number;
  hopPath: string[];
  variants: P2PVariant[];
  timestamp: number;
}

interface P2PStats {
  isRunning: boolean;
  totalSignals: number;
  bestSpread: number;
  platforms: number;
  fiatCurrencies: number;
  scanCount: number;
  lastScan: number;
  multiHopPaths: number;
}

type SortField = 'spreadPercent' | 'profitUsd' | 'confidence' | 'hops';

// ─── Constants ───
const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
];

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function platformLabel(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Component ───
export function P2PArbTab() {
  const [signals, setSignals] = useState<P2PSignal[]>([]);
  const [stats, setStats] = useState<P2PStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [fiatFilter, setFiatFilter] = useState('all');
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [sortField, setSortField] = useState<SortField>('spreadPercent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [csvToast, setCsvToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const { exportRows, isPro } = usePlanLimits();
  const [selectedSpread, setSelectedSpread] = useState<SpreadModalData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/p2p/signals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { signals?: P2PSignal[]; stats?: P2PStats };
      if (Array.isArray(data.signals)) setSignals(data.signals);
      if (data.stats) setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch P2P data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => void fetchData(), refreshInterval * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval, fetchData]);

  const fiats = useMemo(() => {
    const set = new Set(signals.map(s => s.fiatCurrency));
    return ['all', ...Array.from(set).sort()];
  }, [signals]);

  const filtered = useMemo(() => {
    let result = [...signals];
    if (symbolFilter) {
      const q = symbolFilter.toUpperCase();
      result = result.filter(r => r.symbol.toUpperCase().includes(q) || r.p2pPlatform.toUpperCase().includes(q));
    }
    if (fiatFilter !== 'all') {
      result = result.filter(r => r.fiatCurrency === fiatFilter);
    }
    result.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return result;
  }, [signals, symbolFilter, fiatFilter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };
  const sortIcon = (field: SortField) => sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  const handleExportCsv = useCallback(() => {
    const headers = ['Pair', 'Fiat', 'P2P Platform', 'CEX Platform', 'P2P Price', 'CEX Price', 'Spread %', 'Profit $', 'Direction', 'Confidence %', 'Network Fee', 'Transfer Time', 'Hops', 'Best Path', 'Variants', 'Age'];
    const rows = filtered.map(s => [
      s.symbol, s.fiatCurrency, platformLabel(s.p2pPlatform), s.cexPlatform,
      s.p2pPrice, s.cexPrice, s.spreadPercent, s.profitUsd,
      s.direction === 'buy_p2p_sell_cex' ? 'Buy P2P → Sell CEX' : 'Buy CEX → Sell P2P',
      +(s.confidence * 100).toFixed(1), s.networkFee, s.transferTime,
      s.hops, s.hopPath.join(' → '), s.variants.length, timeAgo(s.timestamp),
    ]);
    const result = exportToCsv({ tabName: 'p2p-arb', headers, rows, rowLimit: exportRows, isPro });
    if (result.success) {
      setCsvToast({ type: 'ok', text: result.wasTruncated
        ? `CSV exported (${result.rowsExported} rows — free limit).`
        : `CSV exported (${result.rowsExported} rows)` });
    } else {
      setCsvToast({ type: 'err', text: result.error ?? 'Export failed' });
    }
    setTimeout(() => setCsvToast(null), 4000);
  }, [filtered, exportRows, isPro]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>P2P Arbitrage</h2>
          {stats && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>Signals: <b className="text-foreground">{stats.totalSignals}</b></span>
              <span>Best: <b className="text-green-400">{stats.bestSpread.toFixed(2)}%</b></span>
              <span>Platforms: <b className="text-primary">{stats.platforms}</b></span>
              <span>Multi-hop: <b className="text-amber-400">{stats.multiHopPaths}</b></span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stats.isRunning ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <span className={`status-dot ${stats.isRunning ? 'online' : 'offline'}`} />
                {stats.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" value={symbolFilter} placeholder="Filter..."
            onChange={e => setSymbolFilter(e.target.value)} className="input-field text-xs w-24" />
          <select value={fiatFilter} onChange={e => setFiatFilter(e.target.value)}
            className="input-field text-[11px] py-1.5">
            {fiats.map(f => <option key={f} value={f}>{f === 'all' ? 'All Fiat' : f}</option>)}
          </select>
          <button onClick={() => void fetchData(true)} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-primary/8 text-primary border border-primary/15 font-medium disabled:opacity-40">
            {refreshing ? '⟳ ...' : '⟳ Refresh'}
          </button>
          <button onClick={handleExportCsv} disabled={loading || filtered.length === 0}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-green-500/8 text-green-400 border border-green-500/15 font-medium disabled:opacity-40">
            ↓ CSV
          </button>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
            className="input-field text-[11px] w-20 py-1.5">
            {REFRESH_INTERVALS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {/* CSV Toast */}
      {csvToast && (
        <div className={`px-4 py-2.5 rounded-xl text-xs font-medium ${csvToast.type === 'ok' ? 'bg-green-500/8 text-green-400 border border-green-500/15' : 'bg-red-500/8 text-red-400 border border-red-500/15'}`}>
          {csvToast.text}
        </div>
      )}

      {/* Count */}
      <div className="text-[11px] text-muted-foreground px-1">
        {filtered.length} of {signals.length} P2P signals
        {stats?.scanCount ? ` · Scan #${stats.scanCount}` : ''}
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Loading P2P arbitrage data...</span>
          </div>
        ) : error && signals.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            No P2P signals match filters. Scanner monitoring {stats?.platforms ?? 0} platforms...
          </div>
        ) : (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Pair</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">P2P</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">CEX</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">P2P Price</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">CEX Price</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('spreadPercent')}>Spread %{sortIcon('spreadPercent')}</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('profitUsd')}>Profit ${sortIcon('profitUsd')}</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Dir</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('confidence')}>Conf{sortIcon('confidence')}</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Fee</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Time</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('hops')}>Hops{sortIcon('hops')}</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Variants</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sig => {
                  const isExpanded = expandedId === sig.id;
                  return (
                    <tr key={sig.id}
                      className="border-b border-border/30 cursor-pointer hover:bg-white/[0.04] transition-colors"
                      onClick={() => setSelectedSpread({
                        symbol: sig.symbol, type: 'p2p',
                        buyExchange: sig.p2pPlatform, sellExchange: sig.cexPlatform,
                        buyPrice: sig.p2pPrice, sellPrice: sig.cexPrice,
                        grossPercent: sig.spreadPercent, netPercent: sig.spreadPercent,
                        profitUsd: sig.profitUsd, confidence: sig.confidence,
                      })}>
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{sig.symbol}</td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{platformLabel(sig.p2pPlatform)}</td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{sig.cexPlatform}</td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{sig.p2pPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{sig.cexPrice.toFixed(2)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${sig.spreadPercent > 1 ? 'text-green-400' : sig.spreadPercent > 0.3 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                        {sig.spreadPercent.toFixed(3)}%
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${sig.profitUsd > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${sig.profitUsd.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${sig.direction === 'buy_p2p_sell_cex' ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 text-primary'}`}>
                          {sig.direction === 'buy_p2p_sell_cex' ? 'P2P→CEX' : 'CEX→P2P'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          sig.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : sig.confidence >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>{(sig.confidence * 100).toFixed(0)}%</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">${sig.networkFee.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{sig.transferTime}</td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          sig.hops >= 3 ? 'bg-purple-500/15 text-purple-400' : sig.hops === 2 ? 'bg-primary/15 text-primary' : 'bg-white/[0.04] text-muted-foreground'
                        }`}>{sig.hops}</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {sig.variants.length > 0 ? (
                          <button onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : sig.id); }}
                            className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/15"
                            title={`${sig.variants.length} paths | Best: ${sig.variants[0]?.profitPercent.toFixed(2)}%`}>
                            {sig.variants.length} {isExpanded ? '▲' : '▼'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{timeAgo(sig.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Expanded variants panel */}
        {expandedId && (() => {
          const sig = filtered.find(s => s.id === expandedId);
          if (!sig || sig.variants.length === 0) return null;
          return (
            <div className="px-4 py-3 bg-background/50 border-t border-border">
              <div className="text-[11px] text-muted-foreground mb-2 font-semibold">
                Multi-hop Variants for {sig.symbol} via {platformLabel(sig.p2pPlatform)}
              </div>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Hops</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Path</th>
                    <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Profit %</th>
                    <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Profit $</th>
                    <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Fees</th>
                    <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {sig.variants.map((v, i) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="px-2 py-1.5 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          v.hops >= 3 ? 'bg-purple-500/15 text-purple-400' : v.hops === 2 ? 'bg-primary/15 text-primary' : 'bg-white/[0.04] text-muted-foreground'
                        }`}>{v.hops}</span>
                      </td>
                      <td className="px-2 py-1.5 text-foreground/80">{v.path.map(p => platformLabel(p)).join(' → ')}</td>
                      <td className={`px-2 py-1.5 text-right font-mono ${v.profitPercent > 1 ? 'text-green-400' : 'text-amber-400'}`}>{v.profitPercent.toFixed(3)}%</td>
                      <td className={`px-2 py-1.5 text-right font-mono ${v.profitUsd > 0 ? 'text-green-400' : 'text-red-400'}`}>${v.profitUsd.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">${v.fees.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">{v.transferTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {selectedSpread && (
        <SpreadDetailModal data={selectedSpread} onClose={() => setSelectedSpread(null)} />
      )}
    </div>
  );
}
