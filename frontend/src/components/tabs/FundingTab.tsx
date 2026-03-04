import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// --------------- Types ---------------
interface FundingRate {
  exchange: string;
  symbol: string;
  rate: number;
  predictedRate: number;
  markPrice: number;
  indexPrice: number;
  openInterest: number;
  volume24h: number;
  nextFundingTime: number;
}

interface FundingYield {
  symbol: string;
  exchange: string;
  currentRate: number;
  annualizedYield: number;
  dailyYield: number;
  direction: 'long' | 'short';
  fundingInterval: number;
  nextFunding: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface FundingArbitrage {
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

interface FundingSnapshot {
  timestamp: number;
  rates: FundingRate[];
  yields: FundingYield[];
  arbitrages: FundingArbitrage[];
  topPositive: FundingRate[];
  topNegative: FundingRate[];
}

type ViewMode = 'rates' | 'yields' | 'arbitrages';

// --------------- Constants ---------------
const EXCHANGES = ['All', 'binance', 'bybit', 'okx', 'bitget', 'gateio', 'kucoin'];

const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 1800, label: '30m' },
];

// --------------- Helpers ---------------
function formatRate(r: number): string {
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`;
}

function apyFromRate(r: number): number {
  return r * 3 * 365 * 100;
}

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function timeUntil(ts: number): string {
  const diff = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

// --------------- Component ---------------
export function FundingTab() {
  const [snapshot, setSnapshot] = useState<FundingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('rates');
  const [exchangeFilter, setExchangeFilter] = useState('All');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [sortField, setSortField] = useState<string>('rate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [minRate, setMinRate] = useState(0);
  const [positiveOnly, setPositiveOnly] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/funding/rates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const snap: FundingSnapshot = json.snapshot ?? json;
      if (snap && Array.isArray(snap.rates)) {
        setSnapshot(snap);
        setError(null);
        console.log(`[FundingTab] Loaded ${snap.rates.length} rates, ${snap.arbitrages?.length ?? 0} arbs`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch funding data';
      console.error('[FundingTab] Error:', msg);
      setError(msg);
      // Keep old snapshot — do NOT clear data
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

  // Filtered & sorted rates
  const filteredRates = useMemo(() => {
    if (!snapshot) return [];
    let result = [...snapshot.rates];
    if (exchangeFilter !== 'All') result = result.filter(r => r.exchange === exchangeFilter);
    if (symbolFilter) {
      const s = symbolFilter.toUpperCase();
      result = result.filter(r => (r.symbol ?? '').includes(s));
    }
    if (positiveOnly) result = result.filter(r => (r.rate ?? 0) > 0);
    if (minRate > 0) result = result.filter(r => Math.abs(r.rate) >= minRate / 10000);
    result.sort((a, b) => {
      const va = sortField === 'rate' ? a.rate : sortField === 'volume' ? a.volume24h : sortField === 'oi' ? a.openInterest : 0;
      const vb = sortField === 'rate' ? b.rate : sortField === 'volume' ? b.volume24h : sortField === 'oi' ? b.openInterest : 0;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return result;
  }, [snapshot, exchangeFilter, symbolFilter, sortField, sortDir, positiveOnly, minRate]);

  const filteredArbs = useMemo(() => {
    if (!snapshot?.arbitrages) return [];
    let result = [...snapshot.arbitrages];
    if (symbolFilter) {
      const s = symbolFilter.toUpperCase();
      result = result.filter(r => (r.symbol ?? '').includes(s));
    }
    result.sort((a, b) => (b.annualizedSpread ?? 0) - (a.annualizedSpread ?? 0));
    return result;
  }, [snapshot, symbolFilter]);

  const filteredYields = useMemo(() => {
    if (!snapshot?.yields) return [];
    let result = [...snapshot.yields];
    if (exchangeFilter !== 'All') result = result.filter(r => r.exchange === exchangeFilter);
    if (symbolFilter) {
      const s = symbolFilter.toUpperCase();
      result = result.filter(r => (r.symbol ?? '').includes(s));
    }
    if (positiveOnly) result = result.filter(r => (r.annualizedYield ?? 0) > 0);
    result.sort((a, b) => Math.abs(b.annualizedYield) - Math.abs(a.annualizedYield));
    return result;
  }, [snapshot, exchangeFilter, symbolFilter, positiveOnly]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field: string) => sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  const thCls = "px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap";
  const thR = `${thCls} text-right`;
  const thSort = `${thR} cursor-pointer hover:text-foreground`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Funding Rates</h2>
          {snapshot && (
            <span className="text-[11px] text-muted-foreground">
              {snapshot.rates.length} rates · {snapshot.arbitrages?.length ?? 0} arb opps
            </span>
          )}
        </div>
        <div className="flex w-full lg:w-auto flex-wrap items-center justify-start lg:justify-end gap-2 min-w-0">
          {(['rates', 'arbitrages', 'yields'] as ViewMode[]).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-[11px] rounded-lg font-medium transition-all ${
                viewMode === mode ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-white/[0.02] text-muted-foreground border border-border hover:text-foreground'
              }`}>
              {mode === 'rates' ? 'Rates' : mode === 'arbitrages' ? 'Funding Arb' : 'Yields'}
            </button>
          ))}
          <button onClick={() => void fetchData(true)} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-primary/8 text-primary border border-primary/15 font-medium disabled:opacity-40">
            {refreshing ? '⟳ ...' : '⟳ Refresh'}
          </button>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
            className="input-field text-[11px] w-[88px] py-1.5">
            {REFRESH_INTERVALS.map(ri => <option key={ri.value} value={ri.value}>{ri.label}</option>)}
          </select>
          {refreshInterval > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400">
              <span className="status-dot online" /> Live
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 sm:gap-3 items-center px-1">
        <select value={exchangeFilter} onChange={e => setExchangeFilter(e.target.value)}
          className="input-field text-[11px] py-1.5 w-full sm:w-auto sm:min-w-[170px]">
          {EXCHANGES.map(ex => <option key={ex} value={ex}>{ex === 'All' ? 'All Exchanges' : (ex ?? '').charAt(0).toUpperCase() + (ex ?? '').slice(1)}</option>)}
        </select>
        <input type="text" value={symbolFilter} placeholder="Filter symbol..."
          onChange={e => setSymbolFilter(e.target.value)} className="input-field text-xs w-full sm:w-40" />
        <button onClick={() => setShowMoreFilters(v => !v)}
          className="px-3 py-1.5 text-[11px] rounded-lg bg-white/[0.02] text-muted-foreground border border-border hover:text-foreground">
          {showMoreFilters ? 'Hide Filters' : 'More Filters'}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {viewMode === 'rates' ? `${filteredRates.length} rates` :
           viewMode === 'arbitrages' ? `${filteredArbs.length} arb opportunities` :
           `${filteredYields.length} yield positions`}
        </span>
      </div>

      {/* More Filters panel */}
      {showMoreFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 glass-card rounded-xl p-4">
          <label className="text-[11px] text-muted-foreground">
            Min Rate (bps)
            <input type="number" value={minRate} step={1} onChange={e => setMinRate(Number(e.target.value) || 0)}
              className="input-field text-xs mt-1 block w-full" />
          </label>
          <label className="text-[11px] text-muted-foreground flex items-center gap-2 pt-5">
            <input type="checkbox" checked={positiveOnly} onChange={e => setPositiveOnly(e.target.checked)} className="rounded" />
            Positive rates only
          </label>
          <div className="pt-5">
            <button onClick={() => { setMinRate(0); setPositiveOnly(false); setExchangeFilter('All'); setSymbolFilter(''); }}
              className="px-3 py-1.5 text-[11px] rounded-lg bg-white/[0.02] text-muted-foreground border border-border">Reset All</button>
          </div>
        </div>
      )}

      {/* Table container */}
      <div className="glass-card rounded-xl overflow-hidden">
        {error && snapshot && (
          <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/10 flex items-center gap-2">
            <span className="text-red-400 text-[11px]">Refresh failed: {error} — cached data</span>
            <button onClick={() => void fetchData(true)}
              className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        )}
        {loading && !snapshot ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Loading funding rates...</span>
          </div>
        ) : error && !snapshot ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : viewMode === 'rates' ? (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className={thCls}>Exchange</th>
                  <th className={thCls}>Symbol</th>
                  <th className={thSort} onClick={() => handleSort('rate')}>Rate{sortIcon('rate')}</th>
                  <th className={thR}>APY (Long)</th>
                  <th className={thR}>APY (Short)</th>
                  <th className={thR}>Predicted</th>
                  <th className={thSort} onClick={() => handleSort('oi')}>Open Int.{sortIcon('oi')}</th>
                  <th className={thSort} onClick={() => handleSort('volume')}>Vol 24h{sortIcon('volume')}</th>
                  <th className={thR}>Next</th>
                </tr>
              </thead>
              <tbody>
                {filteredRates.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-xs">
                    {snapshot?.rates.length === 0 ? 'Funding monitor initializing...' : 'No rates match filters'}
                  </td></tr>
                ) : filteredRates.map((r, idx) => {
                  const rateCls = r.rate > 0 ? 'text-green-400' : r.rate < 0 ? 'text-red-400' : 'text-muted-foreground';
                  const longApy = apyFromRate(-r.rate);
                  const shortApy = apyFromRate(r.rate);
                  return (
                    <tr key={`${r.exchange}-${r.symbol}-${idx}`} className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{r.exchange}</td>
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{r.symbol}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${rateCls}`}>{formatRate(r.rate)}</td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${longApy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {longApy >= 0 ? '+' : ''}{longApy.toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${shortApy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {shortApy >= 0 ? '+' : ''}{shortApy.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatRate(r.predictedRate ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{r.openInterest > 0 ? formatUsd(r.openInterest) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{r.volume24h > 0 ? formatUsd(r.volume24h) : '—'}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{r.nextFundingTime > 0 ? timeUntil(r.nextFundingTime) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : viewMode === 'arbitrages' ? (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className={thCls}>Symbol</th>
                  <th className={thCls}>Long @</th>
                  <th className={thCls}>Short @</th>
                  <th className={thR}>Long Rate</th>
                  <th className={thR}>Short Rate</th>
                  <th className={thR}>Spread</th>
                  <th className={thR}>APY</th>
                  <th className={thR}>Daily $</th>
                  <th className={thR}>Conf</th>
                </tr>
              </thead>
              <tbody>
                {filteredArbs.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-xs">No funding arbitrage opportunities found</td></tr>
                ) : filteredArbs.map((arb, idx) => {
                  const apyCls = arb.annualizedSpread > 20 ? 'text-green-400' : arb.annualizedSpread > 5 ? 'text-amber-400' : 'text-muted-foreground';
                  return (
                    <tr key={`${arb.symbol}-${arb.longExchange}-${arb.shortExchange}-${idx}`} className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{arb.symbol}</td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-green-400">{arb.longExchange}</td>
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-red-400">{arb.shortExchange}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatRate(arb.longRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatRate(arb.shortRate)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${apyCls}`}>{formatRate(arb.spreadRate)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${apyCls}`}>{(arb.annualizedSpread ?? 0).toFixed(1)}%</td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${arb.dailyProfit > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
                        {(arb.dailyProfit ?? 0) > 0 ? `+$${(arb.dailyProfit ?? 0).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          arb.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : arb.confidence >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>{((arb.confidence ?? 0) * 100).toFixed(0)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className={thCls}>Exchange</th>
                  <th className={thCls}>Symbol</th>
                  <th className={thCls}>Direction</th>
                  <th className={thR}>Rate</th>
                  <th className={thR}>Daily</th>
                  <th className={thR}>APY</th>
                  <th className={thR}>Risk</th>
                  <th className={thR}>Next</th>
                </tr>
              </thead>
              <tbody>
                {filteredYields.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-xs">No yield positions available</td></tr>
                ) : filteredYields.map((y, idx) => {
                  const apyCls = Math.abs(y.annualizedYield) > 20 ? 'text-green-400' : Math.abs(y.annualizedYield) > 5 ? 'text-amber-400' : 'text-muted-foreground';
                  return (
                    <tr key={`${y.exchange}-${y.symbol}-${y.direction}-${idx}`} className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap capitalize text-muted-foreground">{y.exchange}</td>
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{y.symbol}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${y.direction === 'long' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {(y.direction ?? 'N/A').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatRate(y.currentRate)}</td>
                      <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${apyCls}`}>
                        {y.dailyYield >= 0 ? '+' : ''}{(y.dailyYield * 100).toFixed(3)}%
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${apyCls}`}>
                        {y.annualizedYield >= 0 ? '+' : ''}{y.annualizedYield.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          y.riskLevel === 'low' ? 'bg-green-500/15 text-green-400' : y.riskLevel === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>{y.riskLevel}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{y.nextFunding > 0 ? timeUntil(y.nextFunding) : '—'}</td>
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
