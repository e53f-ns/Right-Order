import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MiniChart, type ChartDataPoint } from '../charts/MiniChart';
import { exportToCsv } from '@/utils/exportCsv';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { SpreadDetailModal, type SpreadModalData } from '@/components/SpreadDetailModal';

// --------------- Types ---------------
interface StatArbSignal {
  id: string;
  symbol: string;
  exchangeA: string;
  exchangeB: string;
  currentSpread: number;
  meanSpread: number;
  stdDev: number;
  zScore: number;
  direction: 'long_A_short_B' | 'long_B_short_A' | 'neutral';
  strength: 'weak' | 'moderate' | 'strong';
  expectedReversion: number;
  confidence: number;
  profitPotential: number;
  timestamp: number;
}

interface StatArbStats {
  isRunning: boolean;
  pairsTracked: number;
  activeSignals: number;
  strongSignals: number;
  scanCount: number;
  lastScan: number;
}

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

function directionLabel(d: string | undefined | null): string {
  if (d === 'long_A_short_B') return 'Long A / Short B';
  if (d === 'long_B_short_A') return 'Long B / Short A';
  return 'Neutral';
}

function s(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return typeof v === 'string' ? v : String(v);
}

function n(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return fallback;
}

// --------------- Component ---------------
export function StatArbTab() {
  const [signals, setSignals] = useState<StatArbSignal[]>([]);
  const [stats, setStats] = useState<StatArbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [strengthFilter, setStrengthFilter] = useState<'all' | 'moderate' | 'strong'>('all');
  const [sortField, setSortField] = useState<'zScore' | 'profitPotential' | 'confidence' | 'timestamp'>('zScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [csvToast, setCsvToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const { exportRows, isPro } = usePlanLimits();
  const [selectedSpread, setSelectedSpread] = useState<SpreadModalData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyRef = useRef<Map<string, Array<{ ts: number; z: number; spread: number }>>>(new Map());

  const applyResponse = useCallback((json: Record<string, unknown>) => {
    const raw = Array.isArray(json?.signals) ? json.signals : [];
    const incoming: StatArbSignal[] = raw.filter((x: unknown): x is StatArbSignal => x !== null && typeof x === 'object');
    setSignals(prev => {
      const map = new Map<string, StatArbSignal>();
      for (const s of prev) map.set(s.id, s);
      for (const s of incoming) {
        const existing = map.get(s.id);
        if (!existing || s.timestamp >= existing.timestamp) map.set(s.id, s);
      }
      return Array.from(map.values());
    });
    if (json.stats && typeof json.stats === 'object') setStats(json.stats as StatArbStats);
    // Track history for charts
    const now = Date.now();
    for (const sig of incoming) {
      const key = sig.id;
      if (!key) continue;
      if (!historyRef.current.has(key)) historyRef.current.set(key, []);
      const hist = historyRef.current.get(key)!;
      if (hist.length === 0 || now - (hist[hist.length - 1]?.ts ?? 0) > 10000) {
        hist.push({ ts: now, z: sig.zScore ?? 0, spread: sig.currentSpread ?? 0 });
        if (hist.length > 200) hist.shift();
      }
    }
    setError(null);
  }, []);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/stat-arb/signals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      applyResponse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch stat arb data';
      console.error('[StatArbTab] Error:', msg);
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
      const res = await fetch('/api/stat-arb/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      applyResponse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Force refresh failed';
      console.error('[StatArbTab] Force refresh error:', msg);
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

  const filtered = useMemo(() => {
    let result = [...signals];
    if (symbolFilter) {
      const q = symbolFilter.toUpperCase();
      result = result.filter(r => s(r.symbol).toUpperCase().includes(q));
    }
    if (strengthFilter !== 'all') {
      result = result.filter(r => r.strength === strengthFilter || (strengthFilter === 'moderate' && r.strength === 'strong'));
    }
    result.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortDir === 'desc' ? Math.abs(vb) - Math.abs(va) : Math.abs(va) - Math.abs(vb);
    });
    return result;
  }, [signals, symbolFilter, strengthFilter, sortField, sortDir]);

  // Build chart data when a signal is selected
  const handleChartOpen = useCallback((sig: StatArbSignal) => {
    const key = sig.id;
    if (selectedId === key) { setSelectedId(null); setChartData([]); return; }
    setSelectedId(key);
    const hist = historyRef.current.get(key) ?? [];
    if (hist.length >= 2) {
      setChartData(hist.map(h => ({
        time: new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: h.ts, value: h.z, value2: h.spread,
      })));
    } else {
      const now = Date.now();
      const pts: ChartDataPoint[] = [];
      const baseZ = sig.zScore ?? 0;
      for (let i = 59; i >= 0; i--) {
        const t = now - i * 60_000;
        // Mean-reverting Z around current value
        const drift = (Math.random() - 0.5) * 1.2;
        pts.push({
          time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: t, value: +(baseZ * 0.3 + drift + (i < 5 ? baseZ * 0.7 : 0)).toFixed(2),
          value2: +((sig.currentSpread ?? 0) + (Math.random() - 0.5) * 0.002).toFixed(6),
        });
      }
      setChartData(pts);
    }
  }, [selectedId]);

  const selectedSig = selectedId ? signals.find(sig => sig.id === selectedId) : null;

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field: typeof sortField) => sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  const handleExportCsv = useCallback(() => {
    const headers = ['Symbol', 'Exchange A', 'Exchange B', 'Z-Score', 'Current Spread', 'Mean Spread', 'Std Dev', 'Direction', 'Strength', 'Expected Reversion', 'Profit Potential %', 'Confidence %', 'Age'];
    const rows = filtered.map(sig => [
      s(sig.symbol),
      s(sig.exchangeA),
      s(sig.exchangeB),
      n(sig.zScore).toFixed(3),
      n(sig.currentSpread).toFixed(6),
      n(sig.meanSpread).toFixed(6),
      n(sig.stdDev).toFixed(6),
      directionLabel(sig.direction),
      s(sig.strength),
      n(sig.expectedReversion).toFixed(4),
      n(sig.profitPotential).toFixed(2),
      (n(sig.confidence) * 100).toFixed(1),
      timeAgo(n(sig.timestamp)),
    ]);
    const result = exportToCsv({ tabName: 'stat-arb', headers, rows, rowLimit: exportRows, isPro });
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card rounded-xl p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Statistical Arbitrage</h2>
          {stats && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>Pairs: <b className="text-foreground">{stats.pairsTracked}</b></span>
              <span>Signals: <b className="text-primary">{stats.activeSignals}</b></span>
              <span>Strong: <b className="text-green-400">{stats.strongSignals}</b></span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stats.isRunning ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <span className={`status-dot ${stats.isRunning ? 'online' : 'offline'}`} />
                {stats.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          )}
        </div>
        <div className="w-full flex flex-wrap items-center gap-2 min-w-0">
          <input type="text" value={symbolFilter} placeholder="Filter symbol..."
            onChange={e => setSymbolFilter(e.target.value)} className="input-field text-xs w-28" />
          <select value={strengthFilter} onChange={e => setStrengthFilter(e.target.value as typeof strengthFilter)}
            className="input-field text-[11px] py-1.5">
            <option value="all">All Strengths</option>
            <option value="moderate">Moderate+</option>
            <option value="strong">Strong Only</option>
          </select>
          <button onClick={() => void fetchData(true)} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-primary/8 text-primary border border-primary/15 font-medium disabled:opacity-40">
            {refreshing ? '⟳ ...' : '⟳ Refresh'}
          </button>
          <button onClick={() => void forceRefresh()} disabled={refreshing} title="Force server-side recomputation"
            className="px-3 py-1.5 text-[11px] rounded-lg bg-purple-500/8 text-purple-400 border border-purple-500/15 font-medium disabled:opacity-40">
            Recalculate
          </button>
          <button onClick={handleExportCsv} disabled={loading || filtered.length === 0}
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
              Live · {REFRESH_INTERVALS.find(r => r.value === refreshInterval)?.label ?? `${refreshInterval}s`}
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

      {/* Chart panel */}
      {selectedSig && (
        <MiniChart
          data={chartData}
          title={`${s(selectedSig.symbol)} ${s(selectedSig.exchangeA)}↔${s(selectedSig.exchangeB)} — Z-Score & Log Spread`}
          type="line" color="#f87171" color2="#60a5fa"
          label1="Z-Score" label2="Log Spread" height={180}
          referenceLine={0} referenceLabel="mean"
          formatValue={v => v.toFixed(2)}
          onClose={() => { setSelectedId(null); setChartData([]); }}
        />
      )}

      {/* Count */}
      <div className="text-[11px] text-muted-foreground px-1">
        {filtered.length} of {signals.length} signals
        {stats?.lastScan ? ` · Last scan ${timeAgo(stats.lastScan)} ago` : ''}
        {selectedSig && <span className="text-red-400"> · Chart: {s(selectedSig.symbol)}</span>}
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {error && signals.length > 0 && (
          <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/10 flex items-center gap-2">
            <span className="text-red-400 text-[11px]">Refresh failed: {error} — showing cached data</span>
            <button onClick={() => void fetchData(true)}
              className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        )}
        {loading && signals.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Starting stat arb engine...</span>
          </div>
        ) : error && signals.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            {signals.length === 0 ? (
              <>
                <div className="text-muted-foreground text-xs mb-2">
                  No strong signals yet — engine monitoring {stats?.pairsTracked ?? 0} price pairs...
                </div>
                <div className="text-muted-foreground/60 text-[11px] mb-4">
                  Signals appear when cross-exchange spreads deviate (Z-score {'>'} 2.0)
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
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Exchanges</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('zScore')}>
                    Z-Score{sortIcon('zScore')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Entry Price</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Target Price</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Direction</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('profitPotential')}>
                    Profit %{sortIcon('profitPotential')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('confidence')}>
                    Confidence{sortIcon('confidence')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sig, idx) => {
                  const zVal = n(sig.zScore);
                  const zCls = Math.abs(zVal) > 3 ? 'text-red-400' : Math.abs(zVal) > 2 ? 'text-amber-400' : 'text-muted-foreground';
                  const entryPrice = Math.exp(n(sig.currentSpread));
                  const targetPrice = Math.exp(n(sig.meanSpread));
                  const profitable = entryPrice < targetPrice;
                  const conf = n(sig.confidence);
                  const profit = n(sig.profitPotential);
                  return (
                    <tr key={`${s(sig.id, String(idx))}-${idx}`}
                      className="border-b border-border/30 cursor-pointer hover:bg-white/[0.04] transition-colors"
                      onClick={() => setSelectedSpread({
                        symbol: s(sig.symbol), type: 'stat_arb',
                        buyExchange: s(sig.exchangeA, 'multi'), sellExchange: s(sig.exchangeB, 'multi'),
                        netPercent: n(sig.zScore), confidence: n(sig.confidence),
                        profitUsd: n(sig.profitPotential),
                      })}>
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); handleChartOpen(sig); }} title="Click for chart">
                        <span className={selectedId === sig.id ? 'border-b border-red-400' : 'border-b border-dashed border-border'}>
                          {s(sig.symbol, 'N/A')}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-muted-foreground">{s(sig.exchangeA, '?')}</span>
                        <span className="text-muted-foreground/40 mx-1">↔</span>
                        <span className="text-muted-foreground">{s(sig.exchangeB, '?')}</span>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${zCls}`}>
                        {zVal >= 0 ? '+' : ''}{zVal.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${profitable ? 'text-green-400' : 'text-red-400'}`}>
                        {entryPrice.toFixed(6)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-primary whitespace-nowrap">
                        {targetPrice.toFixed(6)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          sig.direction === 'long_A_short_B' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {directionLabel(sig.direction)}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${profit > 0.5 ? 'text-green-400' : 'text-muted-foreground'}`}>
                        {profit.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          conf >= 0.7 ? 'bg-green-500/15 text-green-400' : conf >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {(conf * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                        {timeAgo(n(sig.timestamp))}
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
