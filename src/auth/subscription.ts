/**
 * Subscription plans & limits
 * Tiers: free | pro | elite | ultimate
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('subscription');

// ============================================================================
// Types
// ============================================================================

export type SubscriptionPlan = 'free' | 'pro' | 'elite' | 'ultimate';

export interface PlanLimits {
  /** Max Telegram alerts per day */
  alertsPerDay: number;
  /** Max CSV export rows (0 = unlimited) */
  exportRows: number;
  /** Tabs the user can access */
  allowedTabs: readonly string[];
  /** Multi-hop strategies (2-4 exchanges + transfer) */
  multiHop: boolean;
  /** P2P arbitrage */
  p2pArbitrage: boolean;
  /** Priority support */
  prioritySupport: boolean;
  /** Personal manager */
  personalManager: boolean;
  /** Custom strategies */
  customStrategies: boolean;
  /** White-label */
  whiteLabel: boolean;
}

export interface PlanInfo {
  id: SubscriptionPlan;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  limits: PlanLimits;
  badge: string;
  popular?: boolean;
}

// ============================================================================
// Plan definitions
// ============================================================================

const FREE_TABS = ['spreads'] as const;
const PRO_TABS = ['spreads', 'funding', 'futures', 'stat-arb', 'pairs'] as const;
const ELITE_TABS = [...PRO_TABS, 'p2p', 'multi-hop'] as const;
const ULTIMATE_TABS = [...ELITE_TABS, 'custom'] as const;

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    alertsPerDay: 5,
    exportRows: 50,
    allowedTabs: FREE_TABS,
    multiHop: false,
    p2pArbitrage: false,
    prioritySupport: false,
    personalManager: false,
    customStrategies: false,
    whiteLabel: false,
  },
  pro: {
    alertsPerDay: 100,
    exportRows: 0, // unlimited
    allowedTabs: PRO_TABS,
    multiHop: false,
    p2pArbitrage: false,
    prioritySupport: false,
    personalManager: false,
    customStrategies: false,
    whiteLabel: false,
  },
  elite: {
    alertsPerDay: 0, // unlimited
    exportRows: 0,
    allowedTabs: ELITE_TABS,
    multiHop: true,
    p2pArbitrage: true,
    prioritySupport: true,
    personalManager: false,
    customStrategies: false,
    whiteLabel: false,
  },
  ultimate: {
    alertsPerDay: 0,
    exportRows: 0,
    allowedTabs: ULTIMATE_TABS,
    multiHop: true,
    p2pArbitrage: true,
    prioritySupport: true,
    personalManager: true,
    customStrategies: true,
    whiteLabel: true,
  },
};

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    limits: PLAN_LIMITS.free,
    badge: '🆓',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 39,
    yearlyPrice: 349,
    limits: PLAN_LIMITS.pro,
    badge: '⚡',
    popular: true,
  },
  {
    id: 'elite',
    name: 'Elite',
    monthlyPrice: 89,
    yearlyPrice: 799,
    limits: PLAN_LIMITS.elite,
    badge: '🔥',
  },
  {
    id: 'ultimate',
    name: 'Ultimate',
    monthlyPrice: 199,
    yearlyPrice: 1799,
    limits: PLAN_LIMITS.ultimate,
    badge: '👑',
  },
];

// ============================================================================
// Helpers
// ============================================================================

export function getPlanLimits(plan: SubscriptionPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function getPlanInfo(plan: SubscriptionPlan): PlanInfo {
  const info = PLANS.find(p => p.id === plan);
  if (!info) {
    logger.warn({ plan }, 'Unknown plan requested, returning free');
    return PLANS[0]!;
  }
  return info;
}

export function getAllPlans(): PlanInfo[] {
  return PLANS;
}

export function canAccessTab(plan: SubscriptionPlan, tab: string): boolean {
  const limits = PLAN_LIMITS[plan];
  return limits.allowedTabs.includes(tab);
}

export function getExportRowLimit(plan: SubscriptionPlan): number {
  return PLAN_LIMITS[plan].exportRows;
}

export function getAlertLimit(plan: SubscriptionPlan): number {
  return PLAN_LIMITS[plan].alertsPerDay;
}

/**
 * Check if plan A is >= plan B in tier hierarchy
 */
export function isPlanAtLeast(current: SubscriptionPlan, required: SubscriptionPlan): boolean {
  const order: Record<SubscriptionPlan, number> = { free: 0, pro: 1, elite: 2, ultimate: 3 };
  return order[current] >= order[required];
}

/**
 * Get the minimum plan required to access a tab
 */
export function getRequiredPlan(tab: string): SubscriptionPlan {
  if (PLAN_LIMITS.free.allowedTabs.includes(tab)) return 'free';
  if ((PLAN_LIMITS.pro.allowedTabs as readonly string[]).includes(tab)) return 'pro';
  if ((PLAN_LIMITS.elite.allowedTabs as readonly string[]).includes(tab)) return 'elite';
  return 'ultimate';
}

logger.info({ plans: PLANS.map(p => p.id) }, 'Subscription plans loaded');
