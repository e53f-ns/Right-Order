/**
 * PlanGate — wraps a tab component and shows an upgrade overlay
 * if the user's subscription doesn't have access.
 */
import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type SubscriptionPlan } from '@/store/useAuth';

const PLAN_ORDER: Record<SubscriptionPlan, number> = { free: 0, pro: 1, elite: 2, ultimate: 3 };

const PLAN_COLORS: Record<SubscriptionPlan, { bg: string; border: string; text: string; badge: string }> = {
  free:     { bg: 'rgba(148,163,184,0.08)', border: '#334155',                text: '#94a3b8', badge: '🆓' },
  pro:      { bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.3)',   text: '#60a5fa', badge: '⚡' },
  elite:    { bg: 'rgba(168,85,247,0.08)',  border: 'rgba(168,85,247,0.3)',   text: '#a78bfa', badge: '🔥' },
  ultimate: { bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.3)',   text: '#fbbf24', badge: '👑' },
};

interface PlanGateProps {
  /** Minimum plan required to access this content */
  requiredPlan: SubscriptionPlan;
  /** Tab label shown in the overlay */
  tabLabel: string;
  /** Children to render if user has access */
  children: ReactNode;
}

export function PlanGate({ requiredPlan, tabLabel, children }: PlanGateProps) {
  const navigate = useNavigate();
  const subscription = useAuth((s) => s.user?.subscription ?? 'free');

  const hasAccess = PLAN_ORDER[subscription] >= PLAN_ORDER[requiredPlan];

  if (hasAccess) return <>{children}</>;

  const colors = PLAN_COLORS[requiredPlan];
  const planName = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1);

  return (
    <div style={{ position: 'relative', minHeight: 400 }}>
      {/* Blurred preview behind overlay */}
      <div style={{ filter: 'blur(6px)', opacity: 0.25, pointerEvents: 'none' }}>
        {children}
      </div>

      {/* Overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(2,8,23,0.85)',
        borderRadius: 12,
      }}>
        <div style={{
          textAlign: 'center', maxWidth: 380, padding: 40,
          backgroundColor: '#0f172a', borderRadius: 16,
          border: `1.5px solid ${colors.border}`,
          boxShadow: `0 0 60px ${colors.bg}`,
        }}>
          {/* Badge */}
          <div style={{
            fontSize: 40, marginBottom: 16,
            width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 20, backgroundColor: colors.bg, margin: '0 auto 16px',
          }}>
            {colors.badge}
          </div>

          {/* Title */}
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#e0e0e0' }}>
            Upgrade to {planName}
          </h2>

          {/* Description */}
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 }}>
            <strong style={{ color: colors.text }}>{tabLabel}</strong> requires
            the <strong style={{ color: colors.text }}>{planName}</strong> plan or higher.
            Unlock advanced strategies and maximize your profits.
          </p>

          {/* Current plan indicator */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 20, fontSize: 12,
            backgroundColor: 'rgba(148,163,184,0.1)', color: '#64748b',
            marginBottom: 20,
          }}>
            Your plan: <strong style={{ color: '#94a3b8' }}>{subscription.charAt(0).toUpperCase() + subscription.slice(1)}</strong>
          </div>

          {/* CTA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => navigate('/pricing')} style={{
              width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 700,
              borderRadius: 10, border: 'none', cursor: 'pointer',
              backgroundColor: '#3b82f6', color: '#fff',
              transition: 'opacity 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              View Plans & Upgrade
            </button>
            <span style={{ fontSize: 11, color: '#475569' }}>
              Starting from $39/mo · Cancel anytime
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
