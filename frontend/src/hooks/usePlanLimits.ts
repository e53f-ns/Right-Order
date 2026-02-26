/**
 * Hook to get plan-based limits for the current user.
 * Mirrors backend PLAN_LIMITS from src/auth/subscription.ts
 */
import { useAuth, type SubscriptionPlan } from '@/store/useAuth';

interface PlanLimits {
  exportRows: number;   // 0 = unlimited
  alertsPerDay: number; // 0 = unlimited
  isPro: boolean;
}

const LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free:     { exportRows: 50, alertsPerDay: 5,   isPro: false },
  pro:      { exportRows: 0,  alertsPerDay: 100, isPro: true },
  elite:    { exportRows: 0,  alertsPerDay: 0,   isPro: true },
  ultimate: { exportRows: 0,  alertsPerDay: 0,   isPro: true },
};

export function usePlanLimits(): PlanLimits {
  const plan = useAuth((s) => s.user?.subscription ?? 'free');
  return LIMITS[plan];
}
