import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import type { Spread, DashboardStats } from '@/types/spread';

// In dev mode, connect directly to backend to avoid Vite proxy ECONNRESET/EPIPE
// In production, use same origin
const IS_DEV = import.meta.env.DEV;
const WS_URL = IS_DEV
  ? 'ws://localhost:3000/ws'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
const BASE_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 50;
const PING_INTERVAL = 25000;
const DISCONNECT_GRACE_MS = 2000; // Don't flash "disconnected" for brief drops
const STALE_TIMEOUT_MS = 60000; // Reconnect if no messages for 60s

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const staleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const lastMessageRef = useRef(Date.now());

  // Grab stable store actions once (they never change identity)
  const store = useStore;

  useEffect(() => {
    mountedRef.current = true;

    function clearTimers() {
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
      if (staleTimer.current) { clearInterval(staleTimer.current); staleTimer.current = null; }
      if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[WS] Max reconnect attempts reached');
        store.getState().setConnectionError('Connection failed after multiple attempts');
        store.getState().setReconnecting(false);
        return;
      }
      attemptsRef.current++;
      // Exponential backoff: 3s, 6s, 12s ... capped at 30s
      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attemptsRef.current - 1), MAX_RECONNECT_DELAY);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
      store.getState().setReconnecting(true);
      reconnectTimer.current = setTimeout(connect, delay);
    }

    function handleMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data?: unknown };

        switch (msg.type) {
          case 'spreads':
          case 'spreads_batch':
            if (Array.isArray(msg.data)) {
              console.log(`[WS] Spreads received: ${msg.data.length}`);
              store.getState().setSpreads(msg.data as Spread[]);
            }
            break;

          case 'new_spread':
          case 'spread_update':
            if (msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data)) {
              store.getState().updateSpread(msg.data as Spread);
            }
            break;

          case 'stats': {
            const s = msg.data as Record<string, unknown> | undefined;
            if (s && typeof s === 'object') {
              // Normalize: backend Set objects serialize as {} — coerce to numbers
              const normalized: DashboardStats = {
                connectedExchanges: typeof s.connectedExchanges === 'number' ? s.connectedExchanges : 0,
                totalExchanges: typeof s.totalExchanges === 'number' ? s.totalExchanges : 0,
                activeSymbols: typeof s.activeSymbols === 'number' ? s.activeSymbols : 0,
                uniqueSpreads: typeof s.uniqueSpreads === 'number' ? s.uniqueSpreads : 0,
                bestNetPercent: typeof s.bestNetPercent === 'number' ? s.bestNetPercent : 0,
                totalCalculations: typeof s.totalCalculations === 'number' ? s.totalCalculations : 0,
                uptime: typeof s.uptime === 'number' ? s.uptime : 0,
              };
              console.log('[WS] Stats received:', JSON.stringify(normalized));
              store.getState().setStats(normalized);
            } else {
              console.warn('[WS] Skipped invalid stats:', s);
            }
            break;
          }

          case 'funding':
            if (Array.isArray(msg.data)) {
              store.getState().setFundingRates(msg.data);
            }
            break;

          case 'pong':
          case 'log_entry':
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    }

    function connect() {
      if (!mountedRef.current) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

      clearTimers();
      console.log('[WS] Connecting to', WS_URL);

      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          const wasReconnect = attemptsRef.current > 0;
          console.log(`[WS] Connected${wasReconnect ? ' (reconnect)' : ''}`);
          attemptsRef.current = 0;
          lastMessageRef.current = Date.now();
          // Cancel any disconnect grace timer
          if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
          store.getState().setConnected(true);
          store.getState().setReconnecting(false);
          store.getState().setConnectionError(null);
          store.getState().resetReconnectAttempts();

          // On (re)connect — immediately refetch spreads via REST to repopulate
          fetch('/api/spreads')
            .then(r => r.ok ? r.json() : null)
            .then(json => {
              if (!json) return;
              const arr = Array.isArray(json) ? json : (Array.isArray(json.spreads) ? json.spreads : []);
              console.log(`[WS] Refetch on connect: ${arr.length} spreads`);
              if (arr.length > 0) store.getState().setSpreads(arr);
            })
            .catch(err => console.error('[WS] Refetch error:', err));

          // Ping every 25s
          pingTimer.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, PING_INTERVAL);

          // Stale connection detection — reconnect if no message in 60s
          staleTimer.current = setInterval(() => {
            if (Date.now() - lastMessageRef.current > STALE_TIMEOUT_MS && ws.readyState === WebSocket.OPEN) {
              console.warn('[WS] Stale connection detected, reconnecting...');
              ws.close(4000, 'stale');
            }
          }, 15000);
        };

        ws.onmessage = (event) => {
          lastMessageRef.current = Date.now();
          handleMessage(event);
        };

        ws.onerror = (ev) => {
          // Suppress noisy error logs — onclose handles reconnect
          console.warn('[WS] Error event', ev);
        };

        ws.onclose = (ev) => {
          console.log(`[WS] Closed, code: ${ev.code}, reason: ${ev.reason}`);
          clearTimers();

          // IMPORTANT: Do NOT clear spreads on disconnect — they stay in the store
          console.log(`[WS] Spreads preserved in store: ${store.getState().spreads.length}`);

          // Grace period — don't flash "disconnected" for brief drops
          graceTimer.current = setTimeout(() => {
            if (mountedRef.current) {
              store.getState().setConnected(false);
            }
          }, DISCONNECT_GRACE_MS);

          // Always reconnect unless this was our own clean unmount (code 1000 + reason "unmount")
          if (mountedRef.current && !(ev.code === 1000 && ev.reason === 'unmount')) {
            scheduleReconnect();
          }
        };
      } catch (err) {
        console.error('[WS] Create error:', err);
        scheduleReconnect();
      }
    }

    // Start connection after a short delay to let React settle
    const initTimer = setTimeout(connect, 200);

    return () => {
      mountedRef.current = false;
      clearTimeout(initTimer);
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close(1000, 'unmount');
        wsRef.current = null;
      }
    };
  }, [store]);

  return {
    isConnected: useStore((s) => s.connection.isConnected),
    isReconnecting: useStore((s) => s.connection.isReconnecting),
  };
}
