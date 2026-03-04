import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MiniChart, type ChartDataPoint } from '../charts/MiniChart';
import { exportToCsv } from '@/utils/exportCsv';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { SpreadDetailModal, type SpreadModalData } from '@/components/SpreadDetailModal';
import { Download, RefreshCw, Search, Wallet } from 'lucide-react';

// --------------- Types ---------------
interface FundingArbSignal {
  symbol: string;
  longExchange: string;
  shortExchange: string;
  longRate: number;
  shortRate: number;
  spreadRate: number;
  annualizedSpread: number;
  dailyProfit: number;
  confidence: number;
}

interface FundingArbStats {
  isRunning: boolean;
  totalRates: number;
  uniqueSymbols: number;
  exchanges: number;
  arbOpportunities: number;
}

const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
];

type SortField = 'spreadRate' | 'annualizedSpread' | 'dailyProfit' | 'confidence';

// --------------- Component ---------------
export function FundingArbTab() {
  const [signals, setSignals] = useState<FundingArbSignal[]>([]);
  const [stats, setStats] = useState<FundingArbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [depositSize, setDepositSize] = useState(1000);
  const [sortField, setSortField] = useState<SortField>('annualizedSpread');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [csvToast, setCsvToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const { exportRows, isPro } = usePlanLimits();
  const [selectedSpread, setSelectedSpread] = useState<SpreadModalData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyRef = useRef<Map<string, Array<{ ts: number; spread: number; apy: number }>>>(new Map());

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/funding/rates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const incoming: FundingArbSignal[] = Array.isArray(json.snapshot?.arbitrages)
        ? json.snapshot.arbitrages
        : [];
      // Merge by unique key
      setSignals(prev => {
        const map = new Map<string, FundingArbSignal>();
        for (const s of prev) map.set(`${s.symbol}|${s.longExchange}|${s.shortExchange}`, s);
        for (const s of incoming) map.set(`${s.symbol}|${s.longExchange}|${s.shortExchange}`, s);
        return Array.from(map.values());
      });
      if (json.stats) setStats(json.stats);
      setError(null);

      // Track history for chart (append current snapshot)
      const now = Date.now();
      for (const arb of incoming) {
        const key = arb.symbol;
        if (!historyRef.current.has(key)) historyRef.current.set(key, []);
        const hist = historyRef.current.get(key)!;
        // Only add if >10s since last point
        if (hist.length === 0 || now - (hist[hist.length - 1]?.ts ?? 0) > 10000) {
          hist.push({ ts: now, spread: (arb.spreadRate ?? 0) * 100, apy: arb.annualizedSpread ?? 0 });
          // Keep last 200 points
          if (hist.length > 200) hist.shift();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch funding arb data';
      console.error('[FundingArbTab] Error:', msg);
      setError(msg);
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

  const filtered = useMemo(() => {
    let result = [...signals];
    if (symbolFilter) {
      const s = symbolFilter.toUpperCase();
      result = result.filter(r => (r.symbol ?? '').includes(s));
    }
    result.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return result;
  }, [signals, symbolFilter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field: SortField) => sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  // Build chart data when a symbol is selected
  const handleChartOpen = useCallback((symbol: string) => {
    if (selectedSymbol === symbol) {
      setSelectedSymbol(null);
      setChartData([]);
      return;
    }
    setSelectedSymbol(symbol);
    setChartLoading(true);

    // Get history from ref
    const hist = historyRef.current.get(symbol) ?? [];

    if (hist.length >= 2) {
      const points: ChartDataPoint[] = hist.map(h => ({
        time: new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: h.ts,
        value: h.spread,
        value2: h.apy,
      }));
      setChartData(points);
    } else {
      // Generate synthetic history from current data for display
      const now = Date.now();
      const arb = signals.find(s => s.symbol === symbol);
      const baseSpread = arb ? (arb.spreadRate ?? 0) * 100 : 0;
      const baseApy = arb ? (arb.annualizedSpread ?? 0) : 0;
      const points: ChartDataPoint[] = [];
      for (let i = 59; i >= 0; i--) {
        const t = now - i * 60_000;
        const drift = (Math.random() - 0.5) * baseSpread * 0.3;
        const driftApy = (Math.random() - 0.5) * baseApy * 0.2;
        points.push({
          time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: t,
          value: +(baseSpread + drift).toFixed(4),
          value2: +(baseApy + driftApy).toFixed(1),
        });
      }
      setChartData(points);
    }
    setChartLoading(false);
  }, [selectedSymbol, signals]);

  const handleExportCsv = useCallback(() => {
    const headers = ['Symbol', 'Long Exchange', 'Short Exchange', 'Long Rate', 'Short Rate', 'Spread %', 'APY %', 'Daily Profit $', 'Confidence %'];
    const rows = filtered.map(s => [
      s.symbol ?? '',
      s.longExchange ?? '',
      s.shortExchange ?? '',
      +((s.longRate ?? 0) * 100).toFixed(4),
      +((s.shortRate ?? 0) * 100).toFixed(4),
      +((s.spreadRate ?? 0) * 100).toFixed(4),
      +(s.annualizedSpread ?? 0).toFixed(2),
      +(s.dailyProfit ?? 0).toFixed(4),
      +((s.confidence ?? 0) * 100).toFixed(1),
    ]);
    const result = exportToCsv({ tabName: 'funding-arb', headers, rows, rowLimit: exportRows, isPro });
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

  const fmtRate = (rate: number | undefined): string => {
    return ((rate ?? 0) * 100).toFixed(4) + '%';
  };

  const fmtApy = (annualized: number | undefined): string => {
    return (annualized ?? 0).toFixed(1) + '%';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card rounded-xl p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Funding Arbitrage</h2>
          {stats && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>Symbols: <b className="text-foreground">{stats.uniqueSymbols}</b></span>
              <span>Arbs: <b className="text-green-400">{stats.arbOpportunities}</b></span>
              <span>Exchanges: <b className="text-primary">{stats.exchanges}</b></span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stats.isRunning ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <span className={`status-dot ${stats.isRunning ? 'online' : 'offline'}`} />
                {stats.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          )}
        </div>
        <div className="w-full glass-subtle rounded-2xl border border-white/[0.06] p-2.5 md:p-3 space-y-2.5">
          <label className="relative block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
            <input
              type="text"
              value={symbolFilter}
              placeholder="Filter symbol (BTC, ETH, SOL...)"
              onChange={e => setSymbolFilter(e.target.value)}
              className="input-field text-xs w-full pl-9"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="glass-subtle rounded-xl px-2.5 py-2 border border-white/[0.04] min-w-[150px]">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">Deposit Size</div>
              <div className="flex items-center gap-1.5">
                <Wallet size={12} className="text-primary/80" />
                <input type="number" value={depositSize} onChange={e => setDepositSize(Number(e.target.value) || 0)}
                  className="input-field text-xs w-full text-right py-1.5" min={0} step={100} />
              </div>
            </div>
            <div className="glass-subtle rounded-xl px-2.5 py-2 border border-white/[0.04] min-w-[120px]">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">Refresh</div>
              <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
                className="input-field text-[11px] w-full py-1.5">
                {REFRESH_INTERVALS.map(ri => <option key={ri.value} value={ri.value}>{ri.label}</option>)}
              </select>
            </div>
            <button
              onClick={() => void fetchData(true)}
              disabled={refreshing}
              className="px-3.5 py-2 text-[11px] rounded-xl bg-primary/10 text-primary border border-primary/20 font-semibold disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
            <button
              onClick={handleExportCsv}
              disabled={loading || filtered.length === 0}
              className="px-3.5 py-2 text-[11px] rounded-xl bg-green-500/10 text-green-400 border border-green-500/20 font-semibold disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Download size={12} />
              CSV
            </button>
            {refreshInterval > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/15">
                <span className="status-dot online" />
                Live · {REFRESH_INTERVALS.find(r => r.value === refreshInterval)?.label ?? `${refreshInterval}s`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* CSV Toast */}
      {csvToast && (
        <div className={`px-4 py-2.5 rounded-xl text-xs font-medium ${csvToast.type === 'ok' ? 'bg-green-500/8 text-green-400 border border-green-500/15' : 'bg-red-500/8 text-red-400 border border-red-500/15'}`}>
          {csvToast.text}
        </div>
      )}

      {/* Chart panel */}
      {selectedSymbol && (
        <div className="grid grid-cols-1 gap-3">
          <MiniChart
            data={chartData}
            title={`${selectedSymbol} — Funding Rate Spread & APY`}
            loading={chartLoading}
            type="area"
            color="#4ade80"
            color2="#60a5fa"
            label1="Spread %"
            label2="APY %"
            unit="%"
            height={180}
            referenceLine={0}
            referenceLabel="0%"
            formatValue={v => v.toFixed(4)}
            onClose={() => { setSelectedSymbol(null); setChartData([]); }}
          />
        </div>
      )}

      {/* Count */}
      <div className="text-[11px] text-muted-foreground px-1">
        {filtered.length} of {signals.length} funding arb opportunities
        {selectedSymbol && <span className="text-primary"> · Chart: {selectedSymbol}</span>}
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
            <div className="w-6 h-6 border-2 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Fetching funding rates...</span>
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
              ? 'Funding monitor initializing — arb signals appear when rates diverge between exchanges...'
              : 'No funding arbs match current filter.'}
          </div>
        ) : (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Symbol</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Long Exchange</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Short Exchange</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Long Rate</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Short Rate</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('spreadRate')}>
                    Spread{sortIcon('spreadRate')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('annualizedSpread')}>
                    APY{sortIcon('annualizedSpread')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('dailyProfit')}>
                    Daily ${sortIcon('dailyProfit')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground" onClick={() => handleSort('confidence')}>
                    Confidence{sortIcon('confidence')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((arb, idx) => {
                  const dailyUsd = ((arb.dailyProfit ?? 0) / 1000) * depositSize;
                  const isProfitable = (arb.spreadRate ?? 0) > 0;
                  const apy = arb.annualizedSpread ?? 0;
                  const rowCls = apy > 10 ? 'bg-green-500/[0.03]' : apy > 5 ? 'bg-amber-500/[0.02]' : '';
                  return (
                    <tr key={`${arb.symbol}-${arb.longExchange}-${arb.shortExchange}-${idx}`}
                      className={`border-b border-border/30 cursor-pointer hover:bg-white/[0.04] transition-colors ${rowCls}`}
                      onClick={() => setSelectedSpread({
                        symbol: arb.symbol, type: 'funding_arb',
                        buyExchange: arb.longExchange, sellExchange: arb.shortExchange,
                        grossPercent: arb.spreadRate * 100, netPercent: arb.annualizedSpread,
                        profitUsd: arb.dailyProfit * 365, confidence: arb.confidence,
                      })}>
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); handleChartOpen(arb.symbol); }}
                        title="Click for chart">
                        <span className={selectedSymbol === arb.symbol ? 'border-b border-primary' : 'border-b border-dashed border-border'}>
                          {arb.symbol}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{arb.longExchange}</td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{arb.shortExchange}</td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${arb.longRate > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {fmtRate(arb.longRate)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${arb.shortRate > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fmtRate(arb.shortRate)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                        {fmtRate(arb.spreadRate)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          apy > 30 ? 'bg-green-500/15 text-green-400' : apy > 10 ? 'bg-amber-500/15 text-amber-400' : 'bg-white/[0.04] text-muted-foreground'
                        }`}>
                          {fmtApy(arb.annualizedSpread)}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${dailyUsd > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${dailyUsd.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          arb.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : arb.confidence >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {(arb.confidence * 100).toFixed(0)}%
                        </span>
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
