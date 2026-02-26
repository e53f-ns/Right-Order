import { useState } from 'react';

// --------------- Types ---------------
interface TokenHolding {
  symbol: string;
  balance: number;
  valueUsd: number;
  pnl: number;
}

interface ChainStats {
  chain: string;
  address: string;
  txCount: number;
  pnlUsd: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgTradeSize: number;
  lastActivity: number;
  topTokens: TokenHolding[];
}

interface WalletResult {
  address: string;
  analyzedAt: number;
  chains: ChainStats[];
  totalPnlUsd: number;
  overallWinRate: number;
  totalTxCount: number;
}

// --------------- Constants ---------------
const CHAIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ethereum: { bg: '#627eea20', text: '#627eea', label: 'ETH' },
  bsc:      { bg: '#f0b90b20', text: '#f0b90b', label: 'BSC' },
  polygon:  { bg: '#8247e520', text: '#8247e5', label: 'POLY' },
  arbitrum: { bg: '#28a0f020', text: '#28a0f0', label: 'ARB' },
  solana:   { bg: '#9945ff20', text: '#9945ff', label: 'SOL' },
};

// --------------- Helpers ---------------
function formatUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number): string {
  if (!ts) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// --------------- Component ---------------
export function WalletsTab() {
  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<WalletResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeWallet = async () => {
    if (!address.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/wallet/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      });

      const json = await res.json();

      if (!res.ok) {
        const errMsg = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
        setError(errMsg);
        console.error('[WalletsTab] API error:', errMsg);
        return;
      }

      const data: WalletResult = json.result ?? json;
      if (!data || !Array.isArray(data.chains)) {
        setError('Invalid response format');
        return;
      }

      setResult(data);
      console.log(`[WalletsTab] Analyzed ${data.address}: ${data.chains.length} chains, PNL $${data.totalPnlUsd?.toFixed(2)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setError(msg);
      console.error('[WalletsTab] Fetch error:', msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Aggregate top tokens across all chains
  const allTopTokens: TokenHolding[] = [];
  if (result) {
    for (const chain of result.chains) {
      if (Array.isArray(chain.topTokens)) {
        for (const t of chain.topTokens) {
          allTopTokens.push(t);
        }
      }
    }
    allTopTokens.sort((a, b) => b.pnl - a.pnl);
  }

  // --------------- Render ---------------
  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex flex-wrap gap-3 items-center glass-card rounded-xl p-3 md:p-4">
        <h2 className="text-sm font-bold whitespace-nowrap" style={{ fontFamily: 'var(--font-heading)' }}>Wallet Analysis</h2>
        <input type="text" value={address} placeholder="Enter wallet address (0x... or Solana)"
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void analyzeWallet()}
          className="input-field text-xs flex-1 min-w-[200px]" />
        <button onClick={() => void analyzeWallet()} disabled={isLoading || !address.trim()}
          className="px-5 py-2 text-xs font-semibold rounded-lg bg-primary/8 text-primary border border-primary/15 disabled:opacity-40 flex items-center gap-1.5">
          {isLoading && <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin inline-block" />}
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium bg-red-500/8 text-red-400 border border-red-500/15">{error}</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-3 glass-card rounded-xl">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-muted-foreground text-xs">Analyzing wallet across chains...</span>
        </div>
      )}

      {/* Results */}
      {result && !isLoading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Total PNL" value={formatUsd(result.totalPnlUsd ?? 0)} cls={result.totalPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'} />
            <SummaryCard label="Win Rate" value={`${((result.overallWinRate ?? 0)).toFixed(1)}%`} cls={result.overallWinRate >= 50 ? 'text-green-400' : 'text-amber-400'} />
            <SummaryCard label="Total Txs" value={String(result.totalTxCount ?? 0)} cls="text-primary" />
            <SummaryCard label="Chains" value={String(result.chains.length)} cls="text-purple-400" />
          </div>

          <div className="text-[11px] text-muted-foreground px-1">
            {shortAddr(result.address)} · Analyzed {timeAgo(result.analyzedAt)}
          </div>

          {/* Chain breakdown table */}
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold">Chain Breakdown</div>
            <div className="table-container">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Chain</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Txs</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">PNL</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Win Rate</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">W / L</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Avg Trade</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {result.chains.map((chain, idx) => {
                    const cc = CHAIN_COLORS[chain.chain] ?? { bg: '#33415520', text: '#94a3b8', label: (chain.chain ?? 'N/A').toUpperCase() };
                    const pnl = typeof chain.pnlUsd === 'number' ? chain.pnlUsd : 0;
                    const wr = typeof chain.winRate === 'number' ? chain.winRate : 0;
                    return (
                      <tr key={idx} className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: cc.bg, color: cc.text }}>{cc.label}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{chain.txCount ?? 0}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${wr >= 50 ? 'text-green-400' : 'text-amber-400'}`}>{wr.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                          <span className="text-green-400">{chain.winningTrades ?? 0}</span>
                          <span className="text-muted-foreground/40"> / </span>
                          <span className="text-red-400">{chain.losingTrades ?? 0}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatUsd(chain.avgTradeSize ?? 0)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{timeAgo(chain.lastActivity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Tokens */}
          {allTopTokens.length > 0 && (
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border text-xs font-semibold">Top Tokens (by PNL)</div>
              <div className="table-container">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border sticky top-0 bg-card z-[1]">
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Token</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Balance</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Value</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">PNL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTopTokens.slice(0, 10).map((token, idx) => (
                      <tr key={idx} className="border-b border-border/30 hover:bg-white/[0.04] transition-colors">
                        <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{token.symbol}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                          {typeof token.balance === 'number' ? token.balance.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground whitespace-nowrap">{formatUsd(token.valueUsd ?? 0)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${token.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {token.pnl >= 0 ? '+' : ''}{formatUsd(token.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !isLoading && !error && (
        <div className="py-12 text-center text-muted-foreground text-xs glass-card rounded-xl">
          Enter a wallet address above to analyze PNL, win rate, and token holdings across all chains
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="glass-card rounded-xl p-4 text-center">
      <div className={`text-xl font-bold font-mono mb-1 ${cls}`} style={{ fontFamily: 'var(--font-heading)' }}>{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
    </div>
  );
}
