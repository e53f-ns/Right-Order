import { useState, useEffect, useCallback, useRef } from 'react';

interface MessageAlert {
  id: string;
  source: string;
  channel: string;
  content: string;
  timestamp: number;
  type: 'signal' | 'alert' | 'news' | 'info';
  confidence?: number;
  symbol?: string;
  direction?: 'long' | 'short';
}

interface MessageStats {
  totalAlerts: number;
  activeChannels: number;
  signalsToday: number;
  lastUpdate: number;
}

interface Channel {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  messageCount: number;
}

const REFRESH_INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 10, label: '10s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
];

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function MessagesTab() {
  const [alerts, setAlerts] = useState<MessageAlert[]>([]);
  const [stats, setStats] = useState<MessageStats | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [typeFilter, setTypeFilter] = useState('all');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [alertsRes, statsRes, channelsRes] = await Promise.allSettled([
        fetch('/api/messages/alerts'),
        fetch('/api/messages/stats'),
        fetch('/api/messages/channels'),
      ]);
      if (alertsRes.status === 'fulfilled' && alertsRes.value.ok) {
        const json = await alertsRes.value.json();
        const arr = Array.isArray(json) ? json : (Array.isArray(json.alerts) ? json.alerts : []);
        setAlerts(arr);
      }
      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        const json = await statsRes.value.json();
        setStats(json.stats ?? json);
      }
      if (channelsRes.status === 'fulfilled' && channelsRes.value.ok) {
        const json = await channelsRes.value.json();
        setChannels(Array.isArray(json) ? json : (Array.isArray(json.channels) ? json.channels : []));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
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

  const filtered = typeFilter === 'all' ? alerts : alerts.filter(a => a.type === typeFilter);

  const TYPE_CLS: Record<string, string> = {
    signal: 'bg-green-500/15 text-green-400',
    alert: 'bg-amber-500/15 text-amber-400',
    news: 'bg-primary/15 text-primary',
    info: 'bg-white/[0.04] text-muted-foreground',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Alerts & Messages</h2>
          {stats && (
            <span className="text-[11px] text-muted-foreground">
              {stats.totalAlerts} alerts · {stats.activeChannels} channels · {stats.signalsToday} signals today
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="input-field text-[11px] py-1.5">
            <option value="all">All Types</option>
            <option value="signal">Signals</option>
            <option value="alert">Alerts</option>
            <option value="news">News</option>
            <option value="info">Info</option>
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

      {/* Content */}
      <div className="glass-card rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-xs">Loading messages...</span>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="text-red-400 text-xs mb-2">Error: {error}</div>
            <button onClick={() => void fetchData(true)}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/15">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <div className="text-2xl mb-2">📡</div>
            <div className="text-xs">Message monitor active — waiting for signals</div>
            <div className="text-[10px] mt-1 text-muted-foreground/60">{channels.length} channels monitored</div>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((alert, idx) => (
              <div key={alert.id ?? idx}
                className="px-4 py-3 border-b border-border/30 flex gap-3 items-start hover:bg-white/[0.03] transition-colors">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${TYPE_CLS[alert.type] ?? TYPE_CLS.info}`}>
                  {(alert.type ?? 'INFO').toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground leading-relaxed">{alert.content}</div>
                  <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span>{alert.source}/{alert.channel}</span>
                    {alert.symbol && <span className="text-primary">{alert.symbol}</span>}
                    {alert.direction && (
                      <span className={alert.direction === 'long' ? 'text-green-400' : 'text-red-400'}>
                        {(alert.direction ?? '').toUpperCase()}
                      </span>
                    )}
                    {alert.confidence != null && <span>Conf: {(alert.confidence * 100).toFixed(0)}%</span>}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo(alert.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
