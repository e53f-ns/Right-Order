import { useState, useEffect, useCallback } from 'react';
import { exportToCsv } from '@/utils/exportCsv';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Filter, X, Download } from 'lucide-react';
import type { Spread, SpreadFilters } from '@/types/spread';
import { defaultFilters } from '@/types/spread';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';

export function SpreadsTab() {
  // Use Zustand store — merge-based, never wipes on refresh
  const spreads = useStore((s) => s.spreads);
  const storeSetspreads = useStore((s) => s.setSpreads);
  const [filters, setFilters] = useState<SpreadFilters>(defaultFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [showFilters, setShowFilters] = useState(true);
  const [csvToast, setCsvToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const { exportRows, isPro } = usePlanLimits();

  const fetchSpreads = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/spreads');
      if (res.ok) {
        const json = await res.json();
        // API returns { success, count, spreads: [...] }
        const arr: Spread[] = Array.isArray(json) ? json : (Array.isArray(json.spreads) ? json.spreads : []);
        console.log(`[SpreadsTab] Received spreads: ${arr.length}`);
        // MERGE into store (not replace) — prevents disappearing bug
        storeSetspreads(arr);
      }
    } catch (err) {
      console.error('Failed to fetch spreads:', err);
    } finally {
      setIsLoading(false);
    }
  }, [storeSetspreads]);

  useEffect(() => {
    fetchSpreads();
    const interval = setInterval(fetchSpreads, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchSpreads, refreshInterval]);

  const filteredSpreads = spreads.filter(spread => {
    if (filters.executableOnly && !spread.executable) return false;
    if (filters.positiveOnly && spread.netPercent <= 0) return false;
    if (filters.nearProfitable && spread.grossPercent < -0.1) return false;
    if (filters.type !== 'all' && spread.type !== filters.type) return false;
    if (filters.symbol && !spread.symbol.toLowerCase().includes(filters.symbol.toLowerCase())) return false;
    if (filters.exchange && !spread.buyExchange.toLowerCase().includes(filters.exchange.toLowerCase()) && 
        !spread.sellExchange.toLowerCase().includes(filters.exchange.toLowerCase())) return false;
    if (spread.grossPercent < filters.minGross) return false;
    if (spread.netPercent < filters.minNet) return false;
    if (spread.profitUsd < filters.minProfit) return false;
    if (spread.depthUsd < filters.minDepth) return false;
    if (spread.confidence < filters.minConf) return false;
    return true;
  });

  useEffect(() => {
    const oldest = spreads.length > 0 ? Math.max(...spreads.map(s => s.ageSeconds ?? 0)) : 0;
    console.log(`[SpreadsTab] Spreads before render: ${spreads.length}, Filtered: ${filteredSpreads.length}, oldest age: ${oldest}s`);
  }, [spreads.length, filteredSpreads.length]);

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

  const handleExportCsv = useCallback(() => {
    const headers = ['Type', 'Symbol/Path', 'Buy Exchange', 'Sell Exchange', 'Buy Price', 'Sell Price', 'Gross %', 'Net %', 'Profit $', 'Depth $', 'Network', 'Executable', 'Confidence %', 'Age (s)'];
    const rows = filteredSpreads.map(s => [
      s.type,
      s.type === 'triangular' ? (s.pathDescription ?? s.symbol) : s.symbol,
      s.buyExchange,
      s.sellExchange,
      s.buyPrice ?? '',
      s.sellPrice ?? '',
      +s.grossPercent.toFixed(4),
      +s.netPercent.toFixed(4),
      +s.profitUsd.toFixed(2),
      +s.depthUsd.toFixed(0),
      s.network ?? '',
      s.executable ? 'YES' : 'NO',
      +(s.confidence * 100).toFixed(1),
      s.ageSeconds,
    ]);
    const result = exportToCsv({ tabName: 'cex-spreads', headers, rows, rowLimit: exportRows, isPro });
    if (result.success) {
      const msg = result.wasTruncated
        ? `CSV exported (${result.rowsExported} rows — free limit). Upgrade to Pro for unlimited.`
        : `CSV exported successfully (${result.rowsExported} rows)`;
      setCsvToast({ type: 'ok', text: msg });
    } else {
      setCsvToast({ type: 'err', text: result.error ?? 'Export failed' });
    }
    setTimeout(() => setCsvToast(null), 4000);
  }, [filteredSpreads, isPro]);

  const priceColor = (buy: number | undefined, sell: number | undefined): string => {
    if (!buy || !sell || buy === 0 || sell === 0) return 'text-muted-foreground';
    if (buy < sell) return 'bg-green-500/10 text-green-400';
    if (buy > sell) return 'bg-red-500/10 text-red-400';
    return 'text-muted-foreground';
  };

  const getNetworkColor = (network: string | undefined): string => {
    if (!network) return '';
    const n = (network ?? '').toUpperCase();
    if (n.includes('ETH') || n.includes('ERC')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    if (n.includes('SOL')) return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    if (n.includes('BSC') || n.includes('BNB') || n.includes('BEP')) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    if (n.includes('MATIC') || n.includes('POLYGON')) return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
    if (n.includes('ARB')) return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    if (n.includes('OP') || n.includes('OPTIMISM')) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (n.includes('TRX') || n.includes('TRON') || n.includes('TRC')) return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    if (n.includes('AVAX')) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    if (n.includes('BASE')) return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
    if (n.includes('TON')) return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  return (
    <div className="space-y-4">
      {/* Filters Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </Button>
              <div className="flex items-center gap-2 ml-4">
                <span className="text-sm text-muted-foreground">Refresh:</span>
                <Select
                  value={String(refreshInterval)}
                  onValueChange={(v) => setRefreshInterval(Number(v))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30000">30s</SelectItem>
                    <SelectItem value="60000">1m</SelectItem>
                    <SelectItem value="120000">2m</SelectItem>
                    <SelectItem value="300000">5m</SelectItem>
                    <SelectItem value="600000">10m</SelectItem>
                    <SelectItem value="1800000">30m</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  Live
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchSpreads} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isLoading || filteredSpreads.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFilters(defaultFilters)}>
                <X className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">Type</label>
                <Select
                  value={filters.type}
                  onValueChange={(v) => setFilters(f => ({ ...f, type: v as SpreadFilters['type'] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="simple">Simple</SelectItem>
                    <SelectItem value="triangular">Triangular</SelectItem>
                    <SelectItem value="funding_arb">Funding Arb</SelectItem>
                    <SelectItem value="stat_arb">Stat Arb</SelectItem>
                    <SelectItem value="pairs_trading">Pairs Trading</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Symbol</label>
                <input
                  type="text"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="BTC, ETH..."
                  value={filters.symbol}
                  onChange={(e) => setFilters(f => ({ ...f, symbol: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Exchange</label>
                <input
                  type="text"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="binance, okx..."
                  value={filters.exchange}
                  onChange={(e) => setFilters(f => ({ ...f, exchange: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Min Net %</label>
                <input
                  type="number"
                  step="0.01"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={filters.minNet === -999 ? '' : filters.minNet}
                  onChange={(e) => setFilters(f => ({ ...f, minNet: e.target.value ? Number(e.target.value) : -999 }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Min Profit $</label>
                <input
                  type="number"
                  step="1"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={filters.minProfit === -999 ? '' : filters.minProfit}
                  onChange={(e) => setFilters(f => ({ ...f, minProfit: e.target.value ? Number(e.target.value) : -999 }))}
                />
              </div>
              <div className="flex flex-col gap-2 pt-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.positiveOnly}
                    onChange={(e) => setFilters(f => ({ ...f, positiveOnly: e.target.checked }))}
                    className="rounded"
                  />
                  Positive Only
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.executableOnly}
                    onChange={(e) => setFilters(f => ({ ...f, executableOnly: e.target.checked }))}
                    className="rounded"
                  />
                  Executable
                </label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CSV Toast */}
      {csvToast && (
        <div className={cn(
          "px-4 py-2 rounded-lg text-sm border",
          csvToast.type === 'ok'
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        )}>
          {csvToast.text}
        </div>
      )}

      {/* Spreads Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Type</TableHead>
                  <TableHead>Symbol / Path</TableHead>
                  <TableHead>Buy</TableHead>
                  <TableHead>Sell</TableHead>
                  <TableHead className="text-right">Buy Price</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead className="text-right">Gross %</TableHead>
                  <TableHead className="text-right">Net %</TableHead>
                  <TableHead className="text-right">Profit $</TableHead>
                  <TableHead className="text-right">Depth</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Exec</TableHead>
                  <TableHead className="text-right">Conf</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSpreads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">
                      {isLoading ? 'Loading spreads...' : 'No spreads match your filters'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSpreads.map((spread) => (
                    <TableRow
                      key={spread.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        spread.netPercent > 0 && "bg-green-500/5 hover:bg-green-500/10",
                        spread.netPercent <= 0 && "bg-red-500/5 hover:bg-red-500/10",
                        spread.executable && "border-l-2 border-l-green-500"
                      )}
                    >
                      <TableCell>
                        <Badge variant={spread.type === 'simple' ? 'default' : 'secondary'} className="text-xs">
                          {spread.type === 'simple' ? 'S' : 'T'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {spread.type === 'triangular' ? spread.pathDescription : spread.symbol}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{spread.buyExchange}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{spread.sellExchange}</TableCell>
                      <TableCell className={cn("text-right font-mono text-xs", priceColor(spread.buyPrice, spread.sellPrice))}>
                        {formatPrice(spread.buyPrice)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-xs", priceColor(spread.buyPrice, spread.sellPrice))}>
                        {formatPrice(spread.sellPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {spread.grossPercent.toFixed(3)}%
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-mono font-semibold",
                        spread.netPercent > 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {spread.netPercent.toFixed(3)}%
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-mono",
                        spread.profitUsd > 0 ? "text-green-400" : "text-red-400"
                      )}>
                        ${spread.profitUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        ${spread.depthUsd.toFixed(0)}
                      </TableCell>
                      <TableCell>
                        {spread.network && (
                          <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", getNetworkColor(spread.network))}>
                            {spread.network}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={spread.executable ? 'success' : 'secondary'} className="text-xs">
                          {spread.executable ? 'YES' : 'NO'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {(spread.confidence * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatAge(spread.ageSeconds)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Stats Footer */}
      <div className="text-sm text-muted-foreground text-center">
        Showing {filteredSpreads.length} of {spreads.length} spreads
      </div>
    </div>
  );
}
