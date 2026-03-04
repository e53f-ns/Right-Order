import { create } from 'zustand';
import type { Spread, DashboardStats } from '@/types/spread';

interface FundingRate {
  exchange: string;
  symbol: string;
  rate: number;
  nextFundingTime: number;
  predictedRate?: number;
}

interface ConnectionState {
  isConnected: boolean;
  isReconnecting: boolean;
  lastError: string | null;
  reconnectAttempts: number;
}

/** Dedup key: symbol + buyExchange + sellExchange + type (+ pathDescription for triangular) */
function spreadKey(s: { symbol: string; buyExchange: string; sellExchange: string; type: string; pathDescription?: string }): string {
  if (s.type === 'triangular' && s.pathDescription) {
    return `tri_${s.pathDescription}`;
  }
  return `${s.symbol}_${s.buyExchange}_${s.sellExchange}_${s.type}`;
}

interface AppState {
  // Connection
  connection: ConnectionState;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
  setConnectionError: (error: string | null) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;

  // Dashboard stats
  stats: DashboardStats | null;
  setStats: (stats: DashboardStats | null) => void;

  // Spreads (Map-based dedup)
  spreadsMap: Map<string, Spread>;
  spreads: Spread[]; // derived snapshot for React rendering
  spreadsLoading: boolean;
  setSpreads: (spreads: Spread[]) => void;
  updateSpread: (spread: Spread) => void;
  setSpreadsLoading: (loading: boolean) => void;

  // Funding rates
  fundingRates: FundingRate[];
  fundingLoading: boolean;
  setFundingRates: (rates: FundingRate[]) => void;
  setFundingLoading: (loading: boolean) => void;

  // View state
  view: 'landing' | 'dashboard';
  activeTab: string;
  sidebarCollapsed: boolean;
  setView: (view: 'landing' | 'dashboard') => void;
  setActiveTab: (tab: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Initial data loading
  isInitialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  // Connection state
  connection: {
    isConnected: false,
    isReconnecting: false,
    lastError: null,
    reconnectAttempts: 0,
  },
  setConnected: (isConnected) =>
    set((state) => ({
      connection: { ...state.connection, isConnected, isReconnecting: false },
    })),
  setReconnecting: (isReconnecting) =>
    set((state) => ({
      connection: { ...state.connection, isReconnecting },
    })),
  setConnectionError: (lastError) =>
    set((state) => ({
      connection: { ...state.connection, lastError },
    })),
  incrementReconnectAttempts: () =>
    set((state) => ({
      connection: {
        ...state.connection,
        reconnectAttempts: state.connection.reconnectAttempts + 1,
      },
    })),
  resetReconnectAttempts: () =>
    set((state) => ({
      connection: { ...state.connection, reconnectAttempts: 0 },
    })),

  // Dashboard stats
  stats: null,
  setStats: (stats) => {
    if (stats === null) {
      set({ stats: null });
      return;
    }
    // Accept any object — callers are responsible for normalization
    if (typeof stats === 'object') {
      console.log('[Store] setStats:', JSON.stringify(stats));
      set({ stats });
    } else {
      console.warn('[Store] Invalid stats (not object):', typeof stats, stats);
    }
  },

  // Spreads — Map-based dedup
  spreadsMap: new Map<string, Spread>(),
  spreads: [],
  spreadsLoading: false,
  setSpreads: (incoming) =>
    set((state) => {
      // MERGE incoming with existing — never wipe the map on refresh
      const merged = new Map(state.spreadsMap);
      const safe = Array.isArray(incoming) ? incoming : [];
      let added = 0;
      let updated = 0;
      for (const s of safe) {
        const key = spreadKey(s);
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, s);
          added++;
        } else if (s.timestamp >= existing.timestamp) {
          merged.set(key, s);
          updated++;
        }
      }
      // Cap at 500 entries — trim oldest if over
      if (merged.size > 500) {
        const sorted = Array.from(merged.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);
        sorted.slice(500).forEach(([k]) => merged.delete(k));
      }
      const arr = Array.from(merged.values()).sort((a, b) => b.netPercent - a.netPercent);
      console.log(`[Store] setSpreads: ${safe.length} incoming, +${added} new, ~${updated} updated, total=${arr.length}`);
      return { spreadsMap: merged, spreads: arr };
    }),
  updateSpread: (spread) =>
    set((state) => {
      const key = spreadKey(spread);
      const existing = state.spreadsMap.get(key);
      const newMap = new Map(state.spreadsMap);
      if (existing) {
        console.log(`[Store] Duplicate updated: ${key}`);
      }
      newMap.set(key, spread);
      // Cap at 500 entries
      if (newMap.size > 500) {
        const sorted = Array.from(newMap.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);
        sorted.slice(500).forEach(([k]) => newMap.delete(k));
      }
      const arr = Array.from(newMap.values()).sort((a, b) => b.netPercent - a.netPercent);
      return { spreadsMap: newMap, spreads: arr };
    }),
  setSpreadsLoading: (spreadsLoading) => set({ spreadsLoading }),

  // Funding rates
  fundingRates: [],
  fundingLoading: false,
  setFundingRates: (fundingRates) => set({ fundingRates }),
  setFundingLoading: (fundingLoading) => set({ fundingLoading }),

  // View state - persist to localStorage
  view: (localStorage.getItem('ro_view') as 'landing' | 'dashboard') || 'landing',
  activeTab: localStorage.getItem('ro_tab') || 'home',
  sidebarCollapsed: localStorage.getItem('ro_sidebar') === 'collapsed',
  setView: (view) => {
    localStorage.setItem('ro_view', view);
    set({ view });
  },
  setActiveTab: (activeTab) => {
    localStorage.setItem('ro_tab', activeTab);
    set({ activeTab });
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    localStorage.setItem('ro_sidebar', sidebarCollapsed ? 'collapsed' : 'expanded');
    set({ sidebarCollapsed });
  },

  // Initial loading
  isInitialLoading: true,
  setInitialLoading: (isInitialLoading) => set({ isInitialLoading }),
}));
