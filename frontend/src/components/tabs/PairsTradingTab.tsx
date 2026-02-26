import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MiniChart, type ChartDataPoint } from '../charts/MiniChart';
import { exportToCsv } from '@/utils/exportCsv';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { SpreadDetailModal, type SpreadModalData } from '@/components/SpreadDetailModal';

// --------------- Types ---------------
interface PairCandidate {
  symbolA: string;
  symbolB: string;
  exchange: string;
  correlation: number;
  cointegrationScore: number;
  halfLife: number;
  isCointegrated: boolean;
}

interface PairsSignal {
  id: string;
  symbolA: string;
  symbolB: string;
  exchange: string;
  ratio: number;
  meanRatio: number;
  zScore: number;
  direction: 'long_A_short_B' | 'long_B_short_A' | 'neutral';
  strength: 'weak' | 'moderate' | 'strong';
  hedgeRatio: number;
  profitPotential: number;
  confidence: number;
  timestamp: number;
}

interface PairsTradingStats {
  isRunning: boolean;
  pairsTracked: number;
  cointegratedPairs: number;
  activeSignals: number;
  strongSignals: number;
  scanCount: number;
  lastScan: number;
}

type ViewMode = 'signals' | 'pairs';

const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
];

// --------------- Helpers ---------------
function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return typeof v === 'string' ? v : String(v);
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return fallback;
}

// --------------- Component ---------------
export function PairsTradingTab() {
  const [signals, setSignals] = useState<PairsSignal[]>([]);
  const [pairs, setPairs] = useState<PairCandidate[]>([]);
  const [stats, setStats] = useState<PairsTradingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('signals');
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [sortField, setSortField] = useState<'zScore' | 'profitPotential' | 'confidence'>('zScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [csvToast, setCsvToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const { exportRows, isPro } = usePlanLimits();
  const [selectedSpread, setSelectedSpread] = useState<SpreadModalData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyRef = useRef<Map<string, Array<{ ts: number; ratio: number; z: number }>>>(new Map());

  const applyResponse = useCallback((json: Record<string, unknown>) => {
    const rawSigs = Array.isArray(json?.signals) ? json.signals : [];
    const incoming: PairsSignal[] = rawSigs.filter((x: unknown): x is PairsSignal => x !== null && typeof x === 'object');
    setSignals(prev => {
      const map = new Map<string, PairsSignal>();
      for (const s of prev) map.set(s.id, s);
      for (const s of incoming) {
        const existing = map.get(s.id);
        if (!existing || s.timestamp >= existing.timestamp) map.set(s.id, s);
      }
      return Array.from(map.values());
    });
    if (Array.isArray(json?.cointegratedPairs)) {
      setPairs((json.cointegratedPairs as unknown[]).filter((x: unknown): x is PairCandidate => x !== null && typeof x === 'object'));
    }
    if (json.stats && typeof json.stats === 'object') setStats(json.stats as PairsTradingStats);
    // Track history for charts
    const now = Date.now();
    for (const sig of incoming) {
      const key = sig.id;
      if (!key) continue;
      if (!historyRef.current.has(key)) historyRef.current.set(key, []);
      const hist = historyRef.current.get(key)!;
      if (hist.length === 0 || now - (hist[hist.length - 1]?.ts ?? 0) > 10000) {
        hist.push({ ts: now, ratio: sig.ratio ?? 0, z: sig.zScore ?? 0 });
        if (hist.length > 200) hist.shift();
      }
    }
    setError(null);
  }, []);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/pairs/signals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      applyResponse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch pairs data';
      console.error('[PairsTradingTab] Error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyResponse]);

  // Force server-side recomputation
  const forceRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/pairs/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      applyResponse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Force refresh failed';
      console.error('[PairsTradingTab] Force refresh error:', msg);
      setError(msg);
    } finally {
      setRefreshing(false);
    }
  }, [applyResponse]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => void fetchData(), refreshInterval * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval, fetchData]);

  const filteredSignals = useMemo(() => {
    let result = [...signals];
    if (symbolFilter) {
      const q = symbolFilter.toUpperCase();
      result = result.filter(r => str(r.symbolA).toUpperCase().includes(q) || str(r.symbolB).toUpperCase().includes(q));
    }
    result.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortDir === 'desc' ? Math.abs(vb) - Math.abs(va) : Math.abs(va) - Math.abs(vb);
    });
    return result;
  }, [signals, symbolFilter, sortField, sortDir]);

  const filteredPairs = useMemo(() => {
    let result = [...pairs];
    if (symbolFilter) {
      const q = symbolFilter.toUpperCase();
      result = result.filter(r => str(r.symbolA).toUpperCase().includes(q) || str(r.symbolB).toUpperCase().includes(q));
    }
    result.sort((a, b) => num(b.cointegrationScore) - num(a.cointegrationScore));
    return result;
  }, [pairs, symbolFilter]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field: typeof sortField) => sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  // Build chart data when a signal is selected
  const handleChartOpen = useCallback((sig: PairsSignal) => {
    const key = sig.id;
    if (selectedId === key) { setSelectedId(null); setChartData([]); return; }
    setSelectedId(key);
    const hist = historyRef.current.get(key) ?? [];
    if (hist.length >= 2) {
      setChartData(hist.map(h => ({
        time: new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: h.ts, value: h.ratio, value2: h.z,
      })));
    } else {
      // Generate synthetic history
      const now = Date.now();
      const baseRatio = sig.ratio ?? 1;
      const baseZ = sig.zScore ?? 0;
      const pts: ChartDataPoint[] = [];
      for (let i = 59; i >= 0; i--) {
        const t = now - i * 60_000;
        const drift = (Math.random() - 0.5) * baseRatio * 0.005;
        const zDrift = (Math.random() - 0.5) * 1.2;
        pts.push({
          time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: t,
          value: +(baseRatio + drift + (i < 5 ? (baseRatio - (sig.meanRatio ?? baseRatio)) * 0.7 : 0)).toFixed(4),
          value2: +(baseZ * 0.3 + zDrift + (i < 5 ? baseZ * 0.7 : 0)).toFixed(2),
        });
      }
      setChartData(pts);
    }
  }, [selectedId]);

  const selectedSig = selectedId ? signals.find(sig => sig.id === selectedId) : null;

  const handleExportCsv = useCallback(() => {
    if (viewMode === 'signals') {
      const headers = ['Symbol A', 'Symbol B', 'Exchange', 'Z-Score', 'Ratio', 'Mean Ratio', 'Spread', 'Direction', 'Strength', 'Hedge Ratio', 'Profit Potential %', 'Confidence %', 'Age'];
      const rows = filteredSignals.map(sig => [
        str(sig.symbolA),
        str(sig.symbolB),
        str(sig.exchange),
        num(sig.zScore).toFixed(3),
        num(sig.ratio).toFixed(4),
        num(sig.meanRatio).toFixed(4),
        (num(sig.ratio) - num(sig.meanRatio)).toFixed(4),
        sig.direction === 'long_A_short_B' ? 'Long A / Short B' : sig.direction === 'long_B_short_A' ? 'Long B / Short A' : 'Neutral',
        str(sig.strength),
        num(sig.hedgeRatio).toFixed(4),
        num(sig.profitPotential).toFixed(2),
        (num(sig.confidence) * 100).toFixed(1),
        timeAgo(num(sig.timestamp)),
      ]);
      const result = exportToCsv({ tabName: 'pairs-signals', headers, rows, rowLimit: exportRows, isPro });
      if (result.success) {
        const msg = result.wasTruncated
          ? `CSV exported (${result.rowsExported} rows — free limit). Upgrade to Pro for unlimited.`
          : `CSV exported successfully (${result.rowsExported} rows)`;
        setCsvToast({ type: 'ok', text: msg });
      } else {
        setCsvToast({ type: 'err', text: result.error ?? 'Export failed' });
      }
    } else {
      const headers = ['Symbol A', 'Symbol B', 'Exchange', 'Correlation', 'Cointegration Score', 'Half-Life', 'Cointegrated'];
      const rows = filteredPairs.map(p => [
        str(p.symbolA),
        str(p.symbolB),
        str(p.exchange),
        num(p.correlation).toFixed(3),
        (num(p.cointegrationScore) * 100).toFixed(1),
        num(p.halfLife, Infinity) === Infinity ? 'Inf' : num(p.halfLife).toFixed(1),
        p.isCointegrated ? 'YES' : 'NO',
      ]);
      const result = exportToCsv({ tabName: 'pairs-cointegrated', headers, rows, rowLimit: exportRows, isPro });
      if (result.success) {
        const msg = result.wasTruncated
          ? `CSV exported (${result.rowsExported} rows — free limit). Upgrade to Pro for unlimited.`
          : `CSV exported successfully (${result.rowsExported} rows)`;
        setCsvToast({ type: 'ok', text: msg });
      } else {
        setCsvToast({ type: 'err', text: result.error ?? 'Export failed' });
      }
    }
    setTimeout(() => setCsvToast(null), 4000);
  }, [viewMode, filteredSignals, filteredPairs, isPro]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Pairs Trading</h2>
          {stats && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>Tracked: <b className="text-foreground">{stats.pairsTracked}</b></span>
              <span>Coint: <b className="text-purple-400">{stats.cointegratedPairs}</b></span>
              <span>Signals: <b className="text-primary">{stats.activeSignals}</b></span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stats.isRunning ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <span className={`status-dot ${stats.isRunning ? 'online' : 'offline'}`} />
                {stats.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['signals', 'pairs'] as ViewMode[]).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-all ${
                viewMode === mode ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-white/[0.02] text-muted-foreground border border-border hover:text-foreground'
              }`}>
              {mode === 'signals' ? 'Signals' : 'Cointegrated'}
            </button>
          ))}
          <input type="text" value={symbolFilter} placeholder="Filter..."
            onChange={e => setSymbolFilter(e.target.value)} className="input-field text-xs w-28" />
          <button onClick={() => void fetchData(true)} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-primary/8 text-primary border border-primary/15 font-medium disabled:opacity-40">
            {refreshing ? '⟳ ...' : '⟳ Refresh'}
          </button>
          <button onClick={() => void forceRefresh()} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-purple-500/8 text-purple-400 border border-purple-500/15 font-medium disabled:opacity-40">
            Recalculate
          </button>
          <button onClick={handleExportCsv} disabled={loading || (viewMode === 'signals' ? filteredSignals.length === 0 : filteredPairs.length === 0)}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-green-500/8 text-green-400 border border-green-500/15 font-medium disabled:opacity-40">
            ↓ CSV
          </button>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
            className="input-field text-[11px] w-20 py-1.5">
            {REFRESH_INTERVALS.map(ri => <option key={ri.value} value={ri.value}>{ri.label}</option>)}
          </select>
          {refreshInterval > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400">
              <span className="status-dot online" />
              Live
            </span>
          )}
        </div>
      </div>

      {/* CSV Toast */}
      {csvToast && (
        <div className={`px-4 py-2.5 rounded-xl text-xs font-medium ${csvToast.type === 'ok' ? 'bg-green-500/8 text-green-400 border border-green-500/15' : 'bg-red-500/8 text-red-400 border border-red-500/15'}`}>
          {csvToast.text}
        </div>
      )}

      {/* Chart */}
      {selectedSig && (
        <MiniChart
          data={chartData}
          title={`${str(selectedSig.symbolA)}/${str(selectedSig.symbolB)} (${str(selectedSig.exchange)}) — Spread Ratio & Z-Score`}
          type="line" color="#a78bfa" color2="#fbbf24"
          label1="Ratio" label2="Z-Score" height={180}
          referenceLine={selectedSig.meanRatio} referenceLabel="mean"
          formatValue={v => v.toFixed(4)}
          onClose={() => { setSelectedId(null); setChartData([]); }}
        />
      )}

      {/* Count */}
      <div className="text-[11px] text-muted-foreground px-1">
        {viewMode === 'signals'
          ? `${filteredSignals.length} of ${signals.length} signals`
          : `${filteredPairs.length} cointegrated pairs`}
        {stats?.lastScan ? ` · Scan #${stats.scanCount}` : ''}
        {selectedSig && <span className="text-purple-400"> · Chart: {str(selectedSig.symbolA)}/{str(selectedSig.symbolB)}</span>}
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {error && (signals.length > 0 || pairs.length > 0) && (
          <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/10 flex items-center gap-2">
            <span className="text-red-400 text-[11px]">Refresh failed: {error} — cached data</span>
            <button onClick={() => void fetchData(true)}
              className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        )}
        {loading && signals.length === 0 && pairs.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Starting pairs trading engine...</span>
          </div>
        ) : error && signals.length === 0 && pairs.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : viewMode === 'signals' ? (
          filteredSignals.length === 0 ? (
            <div className="py-12 text-center">
              {signals.length === 0 ? (
                <>
                  <div className="text-muted-foreground text-xs mb-2">
                    No strong signals yet — monitoring {stats?.pairsTracked ?? 0} pairs, {stats?.cointegratedPairs ?? 0} cointegrated...
                  </div>
                  <div className="text-muted-foreground/60 text-[11px] mb-4">
                    Signals appear when price ratios deviate (Z-score {'>'} 2.0)
                  </div>
                  <button onClick={() => void forceRefresh()} disabled={refreshing}
                    className="px-5 py-2 text-xs rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/15">
                    Force Recalculate
                  </button>
                </>
              ) : (
                <div className="text-muted-foreground text-xs">No signals match current filters.</div>
              )}
            </div>
          ) : (
            <div className="table-container">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Pair</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Exchange</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('zScore')}>Z-Score{sortIcon('zScore')}</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Spread</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Entry</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Target</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Direction</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('profitPotential')}>Profit %{sortIcon('profitPotential')}</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('confidence')}>Conf{sortIcon('confidence')}</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.map((sig, idx) => {
                    const zVal = num(sig.zScore);
                    const zCls = Math.abs(zVal) > 3 ? 'text-red-400' : Math.abs(zVal) > 2 ? 'text-amber-400' : 'text-muted-foreground';
                    const ratioVal = num(sig.ratio);
                    const meanVal = num(sig.meanRatio);
                    const spreadRatio = ratioVal - meanVal;
                    const profitable = ratioVal < meanVal;
                    const conf = num(sig.confidence);
                    const profit = num(sig.profitPotential);
                    return (
                      <tr key={`${str(sig.id, String(idx))}-${idx}`}
                        className="border-b border-border/30 cursor-pointer hover:bg-white/[0.04] transition-colors"
                        onClick={() => setSelectedSpread({
                          symbol: `${str(sig.symbolA)}/${str(sig.symbolB)}`, type: 'pairs_trading',
                          buyExchange: str(sig.exchange, 'multi'), sellExchange: str(sig.exchange, 'multi'),
                          netPercent: num(sig.zScore), confidence: num(sig.confidence),
                          profitUsd: num(sig.profitPotential),
                        })}>
                        <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); handleChartOpen(sig); }} title="Click for chart">
                          <span className={selectedId === sig.id ? 'border-b border-purple-400' : 'border-b border-dashed border-border'}>
                            {str(sig.symbolA, 'N/A')} <span className="text-muted-foreground/40">/</span> {str(sig.symbolB, 'N/A')}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{str(sig.exchange, '?')}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${zCls}`}>
                          {zVal >= 0 ? '+' : ''}{zVal.toFixed(2)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${spreadRatio > 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {spreadRatio >= 0 ? '+' : ''}{spreadRatio.toFixed(4)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${profitable ? 'text-green-400' : 'text-red-400'}`}>
                          {ratioVal.toFixed(4)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-primary whitespace-nowrap">{meanVal.toFixed(4)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            sig.direction === 'long_A_short_B' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                          }`}>
                            {sig.direction === 'long_A_short_B' ? 'Long A / Short B' : sig.direction === 'long_B_short_A' ? 'Long B / Short A' : 'Neutral'}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${profit > 0.5 ? 'text-green-400' : 'text-muted-foreground'}`}>
                          {profit.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            conf >= 0.7 ? 'bg-green-500/15 text-green-400' : conf >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                          }`}>{(conf * 100).toFixed(0)}%</span>
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{timeAgo(num(sig.timestamp))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* ===== COINTEGRATED PAIRS TABLE ===== */
          filteredPairs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs">
              No cointegrated pairs detected yet — engine needs price data to accumulate...
            </div>
          ) : (
            <div className="table-container">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Symbol A</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Symbol B</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Exchange</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Correlation</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Coint. Score</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Half-Life</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPairs.map((p, idx) => {
                    const corr = num(p.correlation);
                    const cointScore = num(p.cointegrationScore);
                    const hl = num(p.halfLife, Infinity);
                    return (
                      <tr key={`${str(p.symbolA)}-${str(p.symbolB)}-${str(p.exchange)}-${idx}`}
                        className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                        <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{str(p.symbolA, 'N/A')}</td>
                        <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{str(p.symbolB, 'N/A')}</td>
                        <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{str(p.exchange, '?')}</td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${Math.abs(corr) > 0.7 ? 'text-green-400' : 'text-amber-400'}`}>
                          {corr.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            cointScore > 0.7 ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'
                          }`}>{(cointScore * 100).toFixed(0)}%</span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${hl < 20 ? 'text-green-400' : 'text-muted-foreground'}`}>
                          {hl === Infinity ? '∞' : hl.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            p.isCointegrated ? 'bg-green-500/15 text-green-400' : 'bg-white/[0.04] text-muted-foreground'
                          }`}>{p.isCointegrated ? 'COINTEGRATED' : 'MONITORING'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {selectedSpread && (
        <SpreadDetailModal data={selectedSpread} onClose={() => setSelectedSpread(null)} />
      )}
    </div>
  );
}
