import { useState, useEffect, useCallback, useRef } from 'react';

interface NFTOpportunity {
  id: string;
  collection: string;
  tokenId: string;
  chain: string;
  buyPrice: number;
  sellPrice: number;
  profitUsd: number;
  profitPercent: number;
  buyMarketplace: string;
  sellMarketplace: string;
  imageUrl?: string;
  rarity?: number;
  confidence: number;
  timestamp: number;
}

interface NFTStats {
  totalScanned: number;
  opportunitiesFound: number;
  collectionsMonitored: number;
  lastScanTime: number;
  isRunning: boolean;
}

const CHAINS = ['all', 'ethereum', 'polygon', 'solana', 'arbitrum', 'base'];

const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
];

const CHAIN_COLORS: Record<string, { bg: string; color: string }> = {
  ethereum: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  polygon:  { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa' },
  solana:   { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
  arbitrum: { bg: 'rgba(56,189,248,0.15)', color: '#38bdf8' },
  base:     { bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
};

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function NftsTab() {
  const [opps, setOpps] = useState<NFTOpportunity[]>([]);
  const [stats, setStats] = useState<NFTStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState('all');
  const [refreshInterval, setRefreshInterval] = useState(60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [oppsRes, statsRes] = await Promise.allSettled([
        fetch('/api/nfts/opportunities'),
        fetch('/api/nfts/stats'),
      ]);
      if (oppsRes.status === 'fulfilled' && oppsRes.value.ok) {
        const json = await oppsRes.value.json();
        const arr = Array.isArray(json) ? json : (Array.isArray(json.opportunities) ? json.opportunities : []);
        setOpps(arr);
      }
      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        const json = await statsRes.value.json();
        setStats(json.stats ?? json);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch NFT data');
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

  const filtered = chainFilter === 'all' ? opps : opps.filter(o => o.chain === chainFilter);

  const thCls = "px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>NFT Scanner</h2>
          {stats && (
            <span className="text-[11px] text-muted-foreground">
              {stats.collectionsMonitored} collections · {stats.opportunitiesFound} opps
              {stats.isRunning && <span className="text-green-400"> · Running</span>}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={chainFilter} onChange={e => setChainFilter(e.target.value)}
            className="input-field text-[11px] py-1.5">
            {CHAINS.map(c => <option key={c} value={c}>{c === 'all' ? 'All Chains' : (c ?? '').charAt(0).toUpperCase() + (c ?? '').slice(1)}</option>)}
          </select>
          <button onClick={() => void fetchData(true)} disabled={refreshing}
            className="px-3 py-1.5 text-[11px] rounded-lg bg-primary/8 text-primary border border-primary/15 font-medium disabled:opacity-40">
            {refreshing ? '⟳ ...' : '⟳ Refresh'}
          </button>
          <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))}
            className="input-field text-[11px] w-20 py-1.5">
            {REFRESH_INTERVALS.map(ri => <option key={ri.value} value={ri.value}>{ri.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Loading NFT data...</span>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <div className="text-2xl mb-2">🖼️</div>
            <div className="text-xs">NFT scanner active — scanning for arbitrage opportunities</div>
            <div className="text-[10px] mt-1 text-muted-foreground/60">
              {stats ? `${stats.totalScanned} items scanned` : 'Initializing...'}
            </div>
          </div>
        ) : (
          <div className="table-container">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                  <th className={thCls}>Collection</th>
                  <th className={thCls}>Token</th>
                  <th className={thCls}>Chain</th>
                  <th className={thCls}>Buy @</th>
                  <th className={thCls}>Sell @</th>
                  <th className={`${thCls} text-right`}>Buy $</th>
                  <th className={`${thCls} text-right`}>Sell $</th>
                  <th className={`${thCls} text-right`}>Profit</th>
                  <th className={`${thCls} text-right`}>%</th>
                  <th className={`${thCls} text-right`}>Conf</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((opp, idx) => {
                  const cc = CHAIN_COLORS[opp.chain] ?? { bg: 'rgba(148,163,184,0.1)', color: '#94a3b8' };
                  return (
                    <tr key={opp.id ?? idx} className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                      <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{opp.collection}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">#{opp.tokenId}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: cc.bg, color: cc.color }}>{opp.chain}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{opp.buyMarketplace}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{opp.sellMarketplace}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatUsd(opp.buyPrice)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatUsd(opp.sellPrice)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${opp.profitUsd > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {opp.profitUsd > 0 ? '+' : ''}{formatUsd(opp.profitUsd)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${opp.profitPercent > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {opp.profitPercent > 0 ? '+' : ''}{opp.profitPercent.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          opp.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : opp.confidence >= 0.4 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                        }`}>{(opp.confidence * 100).toFixed(0)}%</span>
                      </td>
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
