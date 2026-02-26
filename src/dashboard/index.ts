/**
 * Dashboard Module
 * Exports dashboard components for integration
 */

export { getDashboardStore, resetDashboardStore } from './store.js';
export type {
  DashboardSpread,
  DashboardStats,
  LogEntry,
  DashboardStoreConfig,
  RawSpreadData,
} from './store.js';

export { getDashboardServer, resetDashboardServer, DashboardServer } from './server.js';
export type { DashboardServerConfig } from './server.js';
