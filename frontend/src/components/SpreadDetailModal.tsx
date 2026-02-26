import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Copy, Bell, Loader2, AlertTriangle, ArrowRight, Check } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal spread info needed to open the modal */
export interface SpreadModalData {
  symbol: string;
  type: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice?: number;
  sellPrice?: number;
  grossPercent?: number;
  netPercent?: number;
  profitUsd?: number;
  depthUsd?: number;
  confidence?: number;
  executable?: boolean;
  network?: string;
  withdrawChains?: string[];
  depositChains?: string[];
  pathDescription?: string;
}

interface NetworkRow {
  network: string;
  withdrawFee: number;
  depositFee: number;
  confirmations: number;
  speed: string;
  enabled: boolean;
  profitAfterFees: number;
}

interface OBLevel {
  price: number;
  amount: number;
  total: number;
}

interface OrderbookData {
  buyExchange: string;
  sellExchange: string;
  asks: OBLevel[];
  bids: OBLevel[];
  askDepthUsd: number;
  bidDepthUsd: number;
}

interface PathStep {
  exchange: string;
  action: 'buy' | 'sell' | 'transfer';
  pair: string;
  network?: string;
}

interface Variant {
  id: string;
  hops: number;
  steps: PathStep[];
  networks: string[];
  profitPercent: number;
  profitUsd: number;
  tradingFees: number;
  networkFees: number;
  totalFees: number;
  timeMinMin: number;
  timeMaxMin: number;
  transferTime: string;
  risk: 'low' | 'medium' | 'high';
  riskReasons: string[];
}

interface DetailResponse {
  success: boolean;
  spread: SpreadModalData | null;
  networks: NetworkRow[];
  orderbook: OrderbookData;
  variants: Variant[];
}

interface Props {
  data: SpreadModalData;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(p: number | undefined): string {
  if (p === undefined || p === 0) return '—';
  if (p >= 100) return p.toFixed(4);
  if (p >= 1) return p.toFixed(5);
  return p.toFixed(6);
}

function cap(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SpreadDetailModal({ data, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [networks, setNetworks] = useState<NetworkRow[]>([]);
  const [orderbook, setOrderbook] = useState<OrderbookData | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [copied, setCopied] = useState(false);
  const [alertSet, setAlertSet] = useState(false);
  const [copiedPathId, setCopiedPathId] = useState<string | null>(null);
  const [alertPathId, setAlertPathId] = useState<string | null>(null);
  const [expandedVariant, setExpandedVariant] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        symbol: data.symbol,
        buyExchange: data.buyExchange,
        sellExchange: data.sellExchange,
      });
      const res = await fetch(`/api/spread/detail?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DetailResponse;
      if (!json.success) throw new Error('API returned error');
      setNetworks(json.networks ?? []);
      setOrderbook(json.orderbook ?? null);
      setVariants(json.variants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load detail');
    } finally {
      setLoading(false);
    }
  }, [data.symbol, data.buyExchange, data.sellExchange]);

  useEffect(() => { void fetchDetail(); }, [fetchDetail]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  // Copy spread info to clipboard
  const handleCopy = () => {
    const text = [
      `${data.symbol} (${data.type})`,
      `Buy: ${cap(data.buyExchange)} @ ${fmtPrice(data.buyPrice)}`,
      `Sell: ${cap(data.sellExchange)} @ ${fmtPrice(data.sellPrice)}`,
      `Gross: ${data.grossPercent?.toFixed(3) ?? '?'}%  Net: ${data.netPercent?.toFixed(3) ?? '?'}%`,
      `Profit: $${data.profitUsd?.toFixed(2) ?? '?'}  Depth: $${data.depthUsd?.toFixed(0) ?? '?'}`,
      variants.length > 0 ? `Best path: ${variants[0]?.steps.filter(s => s.action !== 'transfer').map(s => `${cap(s.exchange)} ${s.pair}`).join(' → ')} (${variants[0]?.profitPercent.toFixed(2)}%)` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* ignore */ });
  };

  const handleSetAlert = () => {
    setAlertSet(true);
    setTimeout(() => setAlertSet(false), 3000);
  };

  // Copy a single variant path
  const handleCopyPath = (v: Variant) => {
    const pathStr = v.steps.map(s => {
      if (s.action === 'transfer') return `──[${s.network ?? '?'}]──▸`;
      return `${cap(s.exchange)} ${s.action.toUpperCase()} ${s.pair}`;
    }).join(' ');
    const text = `${data.symbol} | ${v.hops}-hop | ${pathStr} | Profit: ${v.profitPercent}% ($${v.profitUsd}) | Fees: $${v.totalFees} | Risk: ${v.risk} | Time: ${v.transferTime}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPathId(v.id);
      setTimeout(() => setCopiedPathId(null), 2000);
    }).catch(() => { /* ignore */ });
  };

  const handleAlertPath = (v: Variant) => {
    setAlertPathId(v.id);
    setTimeout(() => setAlertPathId(null), 3000);
  };

  const net = data.netPercent ?? 0;
  const isPositive = net > 0;

  return (
    <motion.div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-[#0b1120] shadow-2xl"
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* ── Header ── */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-[#0b1120]/95 backdrop-blur px-6 py-4">
          <div>
            <h2 className="text-lg font-bold">
              Spread Details: <span className="text-blue-400">{data.symbol}</span>{' '}
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 ml-1">{data.type?.toUpperCase()}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cap(data.buyExchange)} → {cap(data.sellExchange)}
              {data.pathDescription ? ` · ${data.pathDescription}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* ── Top Summary ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Buy Price" value={fmtPrice(data.buyPrice)} sub={cap(data.buyExchange)} />
            <SummaryCard label="Sell Price" value={fmtPrice(data.sellPrice)} sub={cap(data.sellExchange)} />
            <SummaryCard
              label="Net Spread"
              value={`${net.toFixed(3)}%`}
              color={isPositive ? 'text-green-400' : 'text-red-400'}
            />
            <SummaryCard
              label="Profit ($1k)"
              value={`$${(data.profitUsd ?? 0).toFixed(2)}`}
              color={(data.profitUsd ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Gross %" value={`${(data.grossPercent ?? 0).toFixed(3)}%`} />
            <SummaryCard label="Depth" value={`$${(data.depthUsd ?? 0).toFixed(0)}`} />
            <SummaryCard
              label="Confidence"
              value={`${((data.confidence ?? 0) * 100).toFixed(0)}%`}
              color={(data.confidence ?? 0) >= 0.7 ? 'text-green-400' : (data.confidence ?? 0) >= 0.4 ? 'text-yellow-400' : 'text-red-400'}
            />
            <SummaryCard
              label="Executable"
              value={data.executable ? 'YES' : 'NO'}
              color={data.executable ? 'text-green-400' : 'text-gray-400'}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading detail data...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8 gap-2 text-red-400 text-sm">
              <AlertTriangle size={16} /> {error}
              <button onClick={() => void fetchDetail()} className="ml-2 px-3 py-1 text-xs rounded bg-red-500/20 hover:bg-red-500/30">Retry</button>
            </div>
          ) : (
            <>
              {/* ── Networks Table ── */}
              <Section title="Transfer Networks">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50">
                        <Th>Network</Th>
                        <Th>Status</Th>
                        <Th align="right">Withdraw Fee</Th>
                        <Th align="right">Deposit Fee</Th>
                        <Th align="right">Confirmations</Th>
                        <Th align="right">Speed</Th>
                        <Th align="right">Profit After Fees</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {networks.map(n => (
                        <tr key={n.network} className="border-b border-border/30 hover:bg-white/[0.02]">
                          <td className="px-3 py-2 font-medium">{n.network}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              n.enabled ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                            }`}>
                              {n.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">${n.withdrawFee.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono">${n.depositFee.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{n.confirmations}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{n.speed}</td>
                          <td className={`px-3 py-2 text-right font-mono font-semibold ${
                            n.profitAfterFees > 0 && n.enabled ? 'text-green-400' : 'text-red-400'
                          }`}>
                            ${n.profitAfterFees.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* ── Orderbook ── */}
              {orderbook && (
                <Section title="Orderbook Summary">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Asks (buy side) */}
                    <div>
                      <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                        <span>Asks ({cap(orderbook.buyExchange)})</span>
                        <span className="text-red-400">Depth: ${orderbook.askDepthUsd.toFixed(0)}</span>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-border/40">
                            <Th>Price</Th>
                            <Th align="right">Amount</Th>
                            <Th align="right">Total $</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderbook.asks.map((l, i) => (
                            <tr key={i} className="border-b border-border/20">
                              <td className="px-2 py-1 font-mono text-red-400">{fmtPrice(l.price)}</td>
                              <td className="px-2 py-1 font-mono text-right">{l.amount.toFixed(4)}</td>
                              <td className="px-2 py-1 font-mono text-right text-muted-foreground">${l.total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Bids (sell side) */}
                    <div>
                      <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                        <span>Bids ({cap(orderbook.sellExchange)})</span>
                        <span className="text-green-400">Depth: ${orderbook.bidDepthUsd.toFixed(0)}</span>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-border/40">
                            <Th>Price</Th>
                            <Th align="right">Amount</Th>
                            <Th align="right">Total $</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderbook.bids.map((l, i) => (
                            <tr key={i} className="border-b border-border/20">
                              <td className="px-2 py-1 font-mono text-green-400">{fmtPrice(l.price)}</td>
                              <td className="px-2 py-1 font-mono text-right">{l.amount.toFixed(4)}</td>
                              <td className="px-2 py-1 font-mono text-right text-muted-foreground">${l.total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Section>
              )}

              {/* ── Multi-hop Variants (enhanced) ── */}
              {variants.length > 0 && (
                <Section title={`Multi-hop Variants (${variants.length} paths, sorted by profit)`}>
                  <div className="divide-y divide-border/30">
                    {variants.map((v) => {
                      const isExpanded = expandedVariant === v.id;
                      return (
                        <div key={v.id} className="hover:bg-white/[0.015] transition-colors">
                          {/* ── Variant header row ── */}
                          <div
                            className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedVariant(isExpanded ? null : v.id)}
                          >
                            {/* Hops badge */}
                            <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                              <span className={`inline-block w-7 text-center py-0.5 rounded text-[10px] font-bold ${
                                v.hops >= 4 ? 'bg-purple-500/15 text-purple-400' :
                                v.hops === 3 ? 'bg-blue-500/15 text-blue-400' :
                                v.hops === 2 ? 'bg-sky-500/15 text-sky-400' :
                                'bg-green-500/15 text-green-400'
                              }`}>
                                {v.hops}
                              </span>
                              <span className="text-[9px] text-muted-foreground">
                                {v.hops === 1 ? 'hop' : 'hops'}
                              </span>
                            </div>

                            {/* Step-by-step path */}
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1 text-xs leading-relaxed">
                                {v.steps.map((step, si) => (
                                  <span key={si} className="inline-flex items-center gap-0.5">
                                    {step.action === 'transfer' ? (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 text-[10px]">
                                        ──<span className="font-semibold">{step.network ?? '?'}</span>──▸
                                      </span>
                                    ) : (
                                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${
                                        step.action === 'buy'
                                          ? 'bg-green-500/10 text-green-400'
                                          : 'bg-red-500/10 text-red-400'
                                      }`}>
                                        <span className="font-bold capitalize">{cap(step.exchange)}</span>
                                        <span className="opacity-60 text-[9px] uppercase">{step.action}</span>
                                        <span className="font-mono font-semibold">{step.pair}</span>
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>

                              {/* Networks used + risk + time row */}
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {v.networks.map((n) => (
                                  <span key={n} className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-cyan-500/10 text-cyan-400">
                                    {n}
                                  </span>
                                ))}
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                  v.risk === 'low' ? 'bg-green-500/15 text-green-400' :
                                  v.risk === 'medium' ? 'bg-yellow-500/15 text-yellow-400' :
                                  'bg-red-500/15 text-red-400'
                                }`}>
                                  {v.risk.toUpperCase()} RISK
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  ⏱ {v.transferTime}
                                </span>
                              </div>
                            </div>

                            {/* Profit + fees column */}
                            <div className="text-right shrink-0 min-w-[100px]">
                              <div className={`text-sm font-bold font-mono ${
                                v.profitUsd > 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                ${v.profitUsd.toFixed(2)}
                              </div>
                              <div className={`text-[11px] font-mono ${
                                v.profitPercent > 0.5 ? 'text-green-400/70' : v.profitPercent > 0 ? 'text-yellow-400/70' : 'text-red-400/70'
                              }`}>
                                {v.profitPercent.toFixed(3)}%
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                fees ${v.totalFees.toFixed(2)}
                              </div>
                            </div>

                            {/* Expand arrow */}
                            <div className="pt-1 shrink-0">
                              <span className={`text-muted-foreground text-xs transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`}>
                                ▾
                              </span>
                            </div>
                          </div>

                          {/* ── Expanded detail panel ── */}
                          {isExpanded && (
                            <div className="px-4 pb-3 pt-0 ml-10">
                              {/* Fee breakdown */}
                              <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="rounded bg-white/[0.03] px-3 py-2">
                                  <div className="text-[9px] text-muted-foreground">Trading Fees</div>
                                  <div className="text-xs font-mono font-semibold">${v.tradingFees.toFixed(2)}</div>
                                </div>
                                <div className="rounded bg-white/[0.03] px-3 py-2">
                                  <div className="text-[9px] text-muted-foreground">Network Fees</div>
                                  <div className="text-xs font-mono font-semibold">${v.networkFees.toFixed(2)}</div>
                                </div>
                                <div className="rounded bg-white/[0.03] px-3 py-2">
                                  <div className="text-[9px] text-muted-foreground">Transfer Time</div>
                                  <div className="text-xs font-mono font-semibold">{v.transferTime}</div>
                                </div>
                              </div>

                              {/* Risk reasons */}
                              {v.riskReasons.length > 0 && (
                                <div className="mb-3">
                                  <div className="text-[10px] text-muted-foreground mb-1">Risk factors:</div>
                                  <div className="flex flex-wrap gap-1">
                                    {v.riskReasons.map((r, ri) => (
                                      <span key={ri} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400/80">
                                        <AlertTriangle size={9} /> {r}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Step-by-step detail table */}
                              <table className="w-full text-[11px] mb-3">
                                <thead>
                                  <tr className="border-b border-border/30">
                                    <th className="text-left px-2 py-1 text-muted-foreground font-medium">#</th>
                                    <th className="text-left px-2 py-1 text-muted-foreground font-medium">Action</th>
                                    <th className="text-left px-2 py-1 text-muted-foreground font-medium">Exchange</th>
                                    <th className="text-left px-2 py-1 text-muted-foreground font-medium">Pair / Asset</th>
                                    <th className="text-left px-2 py-1 text-muted-foreground font-medium">Network</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {v.steps.map((step, si) => (
                                    <tr key={si} className="border-b border-border/20">
                                      <td className="px-2 py-1.5 text-muted-foreground">{si + 1}</td>
                                      <td className="px-2 py-1.5">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                          step.action === 'buy' ? 'bg-green-500/15 text-green-400' :
                                          step.action === 'sell' ? 'bg-red-500/15 text-red-400' :
                                          'bg-amber-500/15 text-amber-400'
                                        }`}>
                                          {step.action.toUpperCase()}
                                        </span>
                                      </td>
                                      <td className="px-2 py-1.5 font-medium">{cap(step.exchange)}</td>
                                      <td className="px-2 py-1.5 font-mono">{step.pair}</td>
                                      <td className="px-2 py-1.5">
                                        {step.network ? (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-cyan-500/10 text-cyan-400">
                                            {step.network}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>

                              {/* Per-row action buttons */}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAlertPath(v); }}
                                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                                >
                                  {alertPathId === v.id ? <Check size={11} /> : <Bell size={11} />}
                                  {alertPathId === v.id ? 'Alert Set!' : 'Alert This Path'}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCopyPath(v); }}
                                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                >
                                  {copiedPathId === v.id ? <Check size={11} /> : <Copy size={11} />}
                                  {copiedPathId === v.id ? 'Copied!' : 'Copy Path'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        {/* ── Footer Buttons ── */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-[#0b1120]/95 backdrop-blur px-6 py-3">
          <button
            onClick={handleSetAlert}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition-colors"
          >
            {alertSet ? <Check size={14} /> : <Bell size={14} />}
            {alertSet ? 'Alert Set!' : 'Set Alert'}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-white/5 text-muted-foreground hover:bg-white/10 transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-border/40 px-3 py-2.5">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-semibold font-mono ${color ?? 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">{title}</h3>
      <div className="rounded-lg border border-border/40 bg-white/[0.01] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 font-medium text-muted-foreground whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
