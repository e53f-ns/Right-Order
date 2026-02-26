import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MiniChart, type ChartDataPoint } from '../charts/MiniChart';
import { exportToCsv } from '@/utils/exportCsv';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { SpreadDetailModal, type SpreadModalData } from '@/components/SpreadDetailModal';

// =============== Types ===============
interface FuturesArbSignal {
  id: string;
  symbol: string;
  exchange: string;
  spotPrice: number;
  futuresPrice: number;
  basisPercent: number;
  basisAnnualized: number;
  fundingRate: number;
  fundingApy: number;
  combinedApy: number;
  direction: 'long_basis' | 'short_basis';
  regime: 'contango' | 'backwardation';
  confidence: number;
  openInterest: number;
  volume24h: number;
  nextFundingTime: number;
  timestamp: number;
}

interface FuturesArbStats {
  isRunning: boolean;
  signalCount: number;
  lastScan: number;
  scanCount: number;
  avgBasis: number;
  bestBasis: number;
}

type SortField = 'combinedApy' | 'basisPercent' | 'fundingApy' | 'confidence' | 'openInterest';

// =============== Constants ===============
const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 1800, label: '30m' },
];

const REGIME_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'contango', label: 'Contango' },
  { value: 'backwardation', label: 'Backwardation' },
];

// =============== Helpers ===============
function formatPrice(price: number): string {
  if (price === 0) return '—';
  if (price >= 100) return price.toFixed(4);
  if (price >= 1) return price.toFixed(5);
  return price.toFixed(6);
}

function timeUntil(ts: number): string {
  const diff = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

// =============== Component ===============
export function FuturesArbTab() {
  const [signals, setSignals] = useState<FuturesArbSignal[]>([]);
  const [stats, setStats] = useState<FuturesArbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('all');
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [sortField, setSortField] = useState<SortField>('combinedApy');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [csvToast, setCsvToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const { exportRows, isPro } = usePlanLimits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [selectedSpread, setSelectedSpread] = useState<SpreadModalData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyRef = useRef<Map<string, Array<{ ts: number; basis: number; apy: number }>>>(new Map());

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/futures/arb');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { signals?: FuturesArbSignal[]; stats?: FuturesArbStats };
      if (Array.isArray(data.signals)) {
        setSignals(data.signals);
        // Track history for charts
        const now = Date.now();
        for (const sig of data.signals) {
          const key = sig.id ?? `${sig.symbol}-${sig.exchange}`;
          if (!historyRef.current.has(key)) historyRef.current.set(key, []);
          const hist = historyRef.current.get(key)!;
          if (hist.length === 0 || now - (hist[hist.length - 1]?.ts ?? 0) > 10000) {
            hist.push({ ts: now, basis: sig.basisPercent ?? 0, apy: sig.combinedApy ?? 0 });
            if (hist.length > 200) hist.shift();
          }
        }
      }
      if (data.stats) setStats(data.stats);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[FuturesArbTab] Fetch error:', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => void fetchData(), refreshInterval * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval, fetchData]);

  const filtered = useMemo(() => {
    let result = [...signals];
    if (symbolFilter) {
      const s = symbolFilter.toUpperCase();
      result = result.filter(r => (r.symbol ?? '').includes(s));
    }
    if (regimeFilter !== 'all') {
      result = result.filter(r => r.regime === regimeFilter);
    }
    result.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortDir === 'desc' ? Math.abs(vb) - Math.abs(va) : Math.abs(va) - Math.abs(vb);
    });
    return result;
  }, [signals, symbolFilter, regimeFilter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field: SortField) => sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  const handleExportCsv = useCallback(() => {
    const headers = ['Symbol', 'Exchange', 'Spot Price', 'Futures Price', 'Basis %', 'Basis APY %', 'Funding Rate', 'Funding APY %', 'Combined APY %', 'Direction', 'Regime', 'Confidence %', 'Open Interest', 'Volume 24h'];
    const rows = filtered.map(s => [
      s.symbol ?? '',
      s.exchange ?? '',
      s.spotPrice ?? 0,
      s.futuresPrice ?? 0,
      +(s.basisPercent ?? 0).toFixed(4),
      +(s.basisAnnualized ?? 0).toFixed(2),
      +(s.fundingRate ?? 0).toFixed(6),
      +(s.fundingApy ?? 0).toFixed(2),
      +(s.combinedApy ?? 0).toFixed(2),
      s.direction ?? '',
      s.regime ?? '',
      +((s.confidence ?? 0) * 100).toFixed(1),
      +(s.openInterest ?? 0).toFixed(0),
      +(s.volume24h ?? 0).toFixed(0),
    ]);
    const result = exportToCsv({ tabName: 'futures-arb', headers, rows, rowLimit: exportRows, isPro });
    if (result.success) {
      const msg = result.wasTruncated
        ? `CSV exported (${result.rowsExported} rows — free limit). Upgrade to Pro for unlimited.`
        : `CSV exported successfully (${result.rowsExported} rows)`;
      setCsvToast({ type: 'ok', text: msg });
    } else {
      setCsvToast({ type: 'err', text: result.error ?? 'Export failed' });
    }
    setTimeout(() => setCsvToast(null), 4000);
  }, [filtered, isPro]);

  // Build chart data when a signal is selected
  const handleChartOpen = useCallback((sig: FuturesArbSignal) => {
    const key = sig.id ?? `${sig.symbol}-${sig.exchange}`;
    if (selectedId === key) {
      setSelectedId(null);
      setChartData([]);
      return;
    }
    setSelectedId(key);

    const hist = historyRef.current.get(key) ?? [];
    if (hist.length >= 2) {
      setChartData(hist.map(h => ({
        time: new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: h.ts,
        value: h.basis,
        value2: h.apy,
      })));
    } else {
      // Generate synthetic history
      const now = Date.now();
      const pts: ChartDataPoint[] = [];
      for (let i = 59; i >= 0; i--) {
        const t = now - i * 60_000;
        pts.push({
          time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: t,
          value: +((sig.basisPercent ?? 0) + (Math.random() - 0.5) * 0.02).toFixed(4),
          value2: +((sig.combinedApy ?? 0) + (Math.random() - 0.5) * 3).toFixed(1),
        });
      }
      setChartData(pts);
    }
  }, [selectedId]);

  const selectedSig = selectedId ? signals.find(s => (s.id ?? `${s.symbol}-${s.exchange}`) === selectedId) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Futures Arbitrage</h2>
          {stats && (
            <span className="text-[11px] text-muted-foreground">
              {stats.signalCount} signals · Scan #{stats.scanCount}
              {stats.isRunning && <span className="text-green-400"> · Running</span>}
              {stats.bestBasis > 0 && <span className="text-primary"> · Best: {stats.bestBasis.toFixed(3)}%</span>}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" value={symbolFilter} placeholder="Filter symbol..."
            onChange={e => setSymbolFilter(e.target.value)} className="input-field text-xs w-32" />
          <select value={regimeFilter} onChange={e => setRegimeFilter(e.target.value)}
            className="input-field text-[11px] py-1.5">
            {REGIME_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
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

      {/* Chart panel */}
      {selectedSig && (
        <div className="grid grid-cols-1 gap-3">
          <MiniChart
            data={chartData}
            title={`${selectedSig.symbol} (${selectedSig.exchange}) — Basis % & Combined APY`}
            type="area" color="#fbbf24" color2="#4ade80"
            label1="Basis %" label2="Combined APY %" unit="%"
            height={180} referenceLine={0} referenceLabel="0%"
            formatValue={v => v.toFixed(4)}
            onClose={() => { setSelectedId(null); setChartData([]); }}
          />
        </div>
      )}

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Loading futures arbitrage data...</span>
          </div>
        ) : error && signals.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            {signals.length === 0
              ? 'Futures arb scanner initializing — signals will appear shortly...'
              : 'No signals match current filters. Try adjusting filters.'}
          </div>
        ) : (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Symbol</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Exchange</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Spot</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Futures</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('basisPercent')}>
                    Basis %{sortIcon('basisPercent')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Fund Rate</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('fundingApy')}>
                    Fund APY{sortIcon('fundingApy')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('combinedApy')}>
                    Combined APY{sortIcon('combinedApy')}
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Regime</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Direction</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('confidence')}>
                    Conf{sortIcon('confidence')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Next Fund</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sig, idx) => {
                  const basisCls = (sig.basisPercent ?? 0) > 0.05 ? 'text-green-400' : (sig.basisPercent ?? 0) > 0 ? 'text-amber-400' : 'text-red-400';
                  const apyCls = Math.abs(sig.combinedApy ?? 0) > 20 ? 'text-green-400' : Math.abs(sig.combinedApy ?? 0) > 5 ? 'text-amber-400' : 'text-muted-foreground';
                  const regimeCls = sig.regime === 'contango' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400';
                  const dirLabel = sig.direction === 'short_basis' ? 'Sell Fut / Buy Spot' : 'Buy Fut / Sell Spot';
                  const dirCls = sig.direction === 'short_basis' ? 'text-green-400' : 'text-red-400';
                  const rowCls = Math.abs(sig.combinedApy ?? 0) > 10 ? 'bg-green-500/[0.03]' : Math.abs(sig.combinedApy ?? 0) > 5 ? 'bg-amber-500/[0.02]' : '';

                  return (
                    <tr key={`${sig.id ?? ''}-${idx}`}
                      className={`border-b border-border/30 cursor-pointer hover:bg-white/[0.04] transition-colors ${rowCls}`}
                      onClick={() => setSelectedSpread({
                        symbol: sig.symbol, type: 'futures_arb',
                        buyExchange: sig.exchange, sellExchange: sig.exchange,
                        buyPrice: sig.spotPrice, sellPrice: sig.futuresPrice,
                        grossPercent: sig.basisPercent, netPercent: sig.combinedApy,
                        profitUsd: (Math.abs(sig.combinedApy) / 100) * 1000,
                        confidence: sig.confidence,
                      })}>
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); handleChartOpen(sig); }} title="Click for chart">
                        <span className={selectedId === (sig.id ?? `${sig.symbol}-${sig.exchange}`) ? 'border-b border-amber-400' : 'border-b border-dashed border-border'}>
                          {sig.symbol ?? 'N/A'}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{sig.exchange ?? 'N/A'}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatPrice(sig.spotPrice ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatPrice(sig.futuresPrice ?? 0)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${basisCls}`}>
                        {(sig.basisPercent ?? 0) >= 0 ? '+' : ''}{(sig.basisPercent ?? 0).toFixed(4)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                        {((sig.fundingRate ?? 0) * 100).toFixed(4)}%
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${apyCls}`}>
                        {(sig.fundingApy ?? 0) >= 0 ? '+' : ''}{(sig.fundingApy ?? 0).toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${apyCls}`}>
                        {(sig.combinedApy ?? 0).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${regimeCls}`}>
                          {(sig.regime ?? 'N/A').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] ${dirCls}`}>{dirLabel}</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          (sig.confidence ?? 0) >= 0.7 ? 'bg-green-500/15 text-green-400' : (sig.confidence ?? 0) >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {((sig.confidence ?? 0) * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                        {(sig.nextFundingTime ?? 0) > 0 ? timeUntil(sig.nextFundingTime) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedSpread && (
        <SpreadDetailModal data={selectedSpread} onClose={() => setSelectedSpread(null)} />
      )}
    </div>
  );
}
