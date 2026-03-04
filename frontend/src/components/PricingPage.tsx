import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, type SubscriptionPlan } from '@/store/useAuth';
import { CheckCircle2, ArrowLeft, CreditCard, Coins, X, Copy, Check } from 'lucide-react';

// ─── Plan definitions ───
interface PlanDef {
  id: SubscriptionPlan;
  name: string;
  badge: string;
  monthlyPrice: number;
  yearlyPrice: number;
  popular?: boolean;
  features: string[];
  limits: { alerts: string; export: string; tabs: string };
  color: string;
  ring: string;
}

interface PaymentApiResponse {
  success: boolean;
  paymentId?: string;
  url?: string;
  error?: string;
  code?: string;
  retry_after?: number;
  address?: string;
  amount?: number | string;
  network?: string;
}

const PLANS: PlanDef[] = [
  {
    id: 'free', name: 'Free', badge: '🆓', monthlyPrice: 0, yearlyPrice: 0,
    features: ['CEX Spread Scanner', 'Basic price monitoring', 'Community support'],
    limits: { alerts: '5 / day', export: '50 rows', tabs: 'CEX Spreads only' },
    color: 'border-white/[0.06]', ring: '',
  },
  {
    id: 'pro', name: 'Pro', badge: '⚡', monthlyPrice: 39, yearlyPrice: 349, popular: true,
    features: ['All CEX Spreads', 'Funding Rate Arbitrage', 'Futures Basis Arbitrage', 'Statistical Arbitrage', 'Pairs Trading Signals', 'Full CSV Export'],
    limits: { alerts: '100 / day', export: 'Unlimited', tabs: 'All strategy tabs' },
    color: 'border-blue-500/30', ring: 'ring-1 ring-blue-500/20',
  },
  {
    id: 'elite', name: 'Elite', badge: '🔥', monthlyPrice: 89, yearlyPrice: 799,
    features: ['Everything in Pro', 'P2P Arbitrage Scanner', 'Multi-hop Strategies', 'Cross-exchange Routes', 'Priority Support', 'Unlimited Alerts'],
    limits: { alerts: 'Unlimited', export: 'Unlimited', tabs: 'All + P2P + Multi-hop' },
    color: 'border-purple-500/30', ring: '',
  },
  {
    id: 'ultimate', name: 'Ultimate', badge: '👑', monthlyPrice: 199, yearlyPrice: 1799,
    features: ['Everything in Elite', 'Personal Account Manager', 'Custom Strategy Builder', 'White-label Dashboard', 'API Access', 'Dedicated Infra'],
    limits: { alerts: 'Unlimited', export: 'Unlimited', tabs: 'All + Custom + API' },
    color: 'border-amber-500/30', ring: '',
  },
];

const PLAN_ORDER: Record<SubscriptionPlan, number> = { free: 0, pro: 1, elite: 2, ultimate: 3 };

export function PricingPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [cryptoModal, setCryptoModal] = useState<{ plan: SubscriptionPlan; paymentId: string; address: string; amount: string; network: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const inFlightPaymentRef = useRef<string | null>(null);

  const currentPlan: SubscriptionPlan = user?.subscription ?? 'free';
  const authHeaders = (): Record<string, string> => token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  const paymentLocked = upgrading !== null || retryAfterSeconds > 0;

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds]);

  const createIdempotencyKey = (prefix: 'card' | 'crypto', planId: SubscriptionPlan): string => (
    `${prefix}:${planId}:${billing}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  );

  const readPaymentResponse = async (res: Response): Promise<PaymentApiResponse | null> => {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as PaymentApiResponse;
    } catch {
      return null;
    }
  };

  const applyRateLimitIfPresent = (res: Response, json: PaymentApiResponse | null): boolean => {
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfter = json?.retry_after ?? (retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN);
    if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
      setRetryAfterSeconds(Math.max(1, retryAfter));
      setToast({ type: 'err', text: `Too many payment attempts. Try again in ${retryAfter}s.` });
      return true;
    }
    return false;
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const postPaymentWithSafeRetry = async (path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<{ res: Response; json: PaymentApiResponse | null }> => {
    const attempts = [0, 350, 900];
    let lastError: Error | null = null;

    for (let i = 0; i < attempts.length; i += 1) {
      if (i > 0) await sleep(attempts[i]!);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey },
          credentials: 'include',
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        const json = await readPaymentResponse(res);
        return { res, json };
      } catch (err) {
        window.clearTimeout(timeout);
        lastError = err instanceof Error ? err : new Error('Network error');
        if (i === attempts.length - 1) break;
        if (lastError.name === 'AbortError' || lastError instanceof TypeError) {
          continue;
        }
        break;
      }
    }

    throw lastError ?? new Error('Network error');
  };

  const handleStripeCheckout = async (planId: SubscriptionPlan) => {
    if (planId === currentPlan || planId === 'free' || inFlightPaymentRef.current || retryAfterSeconds > 0) return;
    const requestKey = createIdempotencyKey('card', planId);
    inFlightPaymentRef.current = requestKey;
    setUpgrading(planId);
    setToast(null);
    try {
      const { res, json } = await postPaymentWithSafeRetry('/api/payment/checkout', { plan: planId, billing }, requestKey);
      if (applyRateLimitIfPresent(res, json)) return;
      if (res.ok && json?.success && json.url) {
        // Redirect to Stripe Checkout — subscription upgrades ONLY after webhook
        window.location.href = json.url;
        return;
      }
      setToast({ type: 'err', text: json?.error ?? 'Payment failed. Please try again or use USDT.' });
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Network error' });
    } finally {
      inFlightPaymentRef.current = null;
      setUpgrading(null);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleCryptoPayment = async (planId: SubscriptionPlan) => {
    if (planId === currentPlan || planId === 'free' || inFlightPaymentRef.current || retryAfterSeconds > 0) return;
    const requestKey = createIdempotencyKey('crypto', planId);
    inFlightPaymentRef.current = requestKey;
    setUpgrading(planId);
    setToast(null);
    try {
      const { res, json } = await postPaymentWithSafeRetry('/api/payment/crypto', { plan: planId, billing, network: 'trc20' }, requestKey);
      if (applyRateLimitIfPresent(res, json)) return;
      if (res.ok && json?.success) {
        setCryptoModal({ plan: planId, paymentId: String(json.paymentId ?? ''), address: json.address ?? '', amount: String(json.amount ?? ''), network: json.network ?? 'TRC20' });
      } else {
        setToast({ type: 'err', text: json?.error ?? 'Crypto payment setup failed' });
      }
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Network error' });
    } finally {
      inFlightPaymentRef.current = null;
      setUpgrading(null);
    }
  };

  const copyAddress = (addr: string) => {
    void navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const savings = (m: number, y: number): number => m === 0 ? 0 : Math.round(((m * 12 - y) / (m * 12)) * 100);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <button onClick={() => navigate(user ? '/dashboard' : '/')} className="btn-ghost px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground mb-4 sm:mb-6 inline-flex items-center gap-1.5">
            <ArrowLeft size={13} /> Back to {user ? 'Dashboard' : 'Home'}
          </button>
          <h1 className="text-3xl md:text-4xl font-bold mb-3" style={{ fontFamily: 'var(--font-heading)' }}>
            Choose Your Plan
          </h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Unlock advanced arbitrage strategies and maximize your profits
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex justify-center mb-8 sm:mb-10">
          <div className="glass-card rounded-xl p-1 inline-flex flex-wrap justify-center gap-1 max-w-full">
            {(['monthly', 'yearly'] as const).map(b => (
              <button key={b} onClick={() => setBilling(b)} className={`px-4 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                billing === b ? 'btn-primary text-white' : 'text-muted-foreground hover:text-foreground'
              }`}>
                {b === 'monthly' ? 'Monthly' : 'Yearly'}
                {b === 'yearly' && <span className="ml-1.5 text-[10px] text-green-400 font-bold">-25%</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`max-w-md mx-auto mb-6 px-4 py-3 rounded-xl text-sm text-center font-medium break-words ${
                toast.type === 'ok' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >{toast.text}</motion.div>
          )}
        </AnimatePresence>
        {retryAfterSeconds > 0 && (
          <div className="max-w-md mx-auto mb-6 px-4 py-3 rounded-xl text-xs text-center font-medium bg-amber-500/8 text-amber-300 border border-amber-500/15">
            Payment requests are temporarily rate limited. You can try again in {retryAfterSeconds}s.
          </div>
        )}

        {/* Plan cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {PLANS.map((plan, idx) => {
            const isCurrent = currentPlan === plan.id;
            const isDowngrade = PLAN_ORDER[plan.id] < PLAN_ORDER[currentPlan];
            const price = billing === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
            const perMonth = billing === 'yearly' && plan.yearlyPrice > 0 ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice;
            const pctSaved = savings(plan.monthlyPrice, plan.yearlyPrice);

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className={`relative glass-card rounded-2xl p-4 sm:p-6 flex flex-col ${plan.color} ${plan.ring}`}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
              >
                {plan.popular && <div className="absolute -top-px left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent" />}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[9px] font-bold bg-blue-500 text-white">MOST POPULAR</div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-green-500/15 text-green-400 border border-green-500/20">CURRENT</div>
                )}

                <div className="text-2xl mb-2">{plan.badge}</div>
                <div className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-heading)' }}>{plan.name}</div>

                {/* Price */}
                <div className="mb-5">
                  {price === 0 ? (
                    <div className="text-3xl font-black" style={{ fontFamily: 'var(--font-heading)' }}>Free</div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black" style={{ fontFamily: 'var(--font-heading)' }}>${billing === 'monthly' ? price : perMonth}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </div>
                      {billing === 'yearly' && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          ${price}/year · <span className="text-green-400 font-semibold">Save {pctSaved}%</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Limits */}
                <div className="space-y-1.5 mb-4 text-[11px]">
                  {Object.entries(plan.limits).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">{k}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="divider-gradient mb-4" />

                {/* Features */}
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 size={12} className="text-green-500/70 mt-0.5 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>

                {/* CTA buttons */}
                <div className="space-y-2">
                  {plan.id === 'free' ? (
                    <button disabled className="w-full py-2.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-muted-foreground cursor-default">
                      {isCurrent ? '✓ Current Plan' : 'Free Forever'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => { void handleStripeCheckout(plan.id); }}
                        disabled={isCurrent || isDowngrade || paymentLocked}
                        className={`w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          isCurrent ? 'bg-green-500/10 text-green-400 cursor-default' :
                          isDowngrade ? 'bg-white/[0.03] text-muted-foreground/50 cursor-default' :
                          'btn-primary text-white cursor-pointer'
                        }`}
                      >
                        {upgrading === plan.id ? 'Processing...' : isCurrent ? '✓ Current Plan' : isDowngrade ? 'Downgrade' : (
                          <><CreditCard size={12} /> Pay with Card</>
                        )}
                      </button>
                      {!isCurrent && !isDowngrade && (
                        <button
                          onClick={() => { void handleCryptoPayment(plan.id); }}
                        disabled={paymentLocked}
                          className="w-full py-2 rounded-xl text-[10px] font-medium btn-ghost text-muted-foreground flex items-center justify-center gap-1.5"
                        >
                          <Coins size={11} /> Pay with USDT
                        </button>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground/60 space-y-1 px-2">
          <p>Secure payment via Stripe. Crypto payments confirmed manually within 24h.</p>
          <p>All plans include 7-day free trial. Cancel anytime.</p>
        </div>
      </div>

      {/* Crypto Payment Modal */}
      <AnimatePresence>
        {cryptoModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setCryptoModal(null)}
          >
            <motion.div
              className="glass-card rounded-2xl p-4 sm:p-6 max-w-sm w-full my-6"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-heading)' }}>
                  Pay with USDT ({cryptoModal.network})
                </h3>
                <button onClick={() => setCryptoModal(null)} className="p-1 rounded-lg hover:bg-white/5">
                  <X size={16} className="text-muted-foreground" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="text-center py-3 rounded-xl bg-white/[0.03]">
                  <div className="text-2xl font-black text-foreground" style={{ fontFamily: 'var(--font-heading)' }}>
                    {cryptoModal.amount} USDT
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {cryptoModal.plan.charAt(0).toUpperCase() + cryptoModal.plan.slice(1)} Plan
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground font-medium mb-1.5 block">Payment ID (for webhook matching):</label>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <code className="text-xs text-foreground break-all font-mono">{cryptoModal.paymentId}</code>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground font-medium mb-1.5 block">Send to this address:</label>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <code className="text-xs text-foreground flex-1 break-all font-mono">{cryptoModal.address}</code>
                    <button
                      onClick={() => copyAddress(cryptoModal.address)}
                      className="p-1.5 rounded-lg hover:bg-white/5 flex-shrink-0"
                    >
                      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-muted-foreground" />}
                    </button>
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground space-y-1 bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                  <p className="font-semibold text-amber-400">Important:</p>
                  <p>Send the exact amount shown above (unique invoice amount for auto-detection).</p>
                  <p>Your plan can be activated automatically after on-chain confirmation if crypto webhook automation is configured. Manual admin confirmation remains available.</p>
                </div>

                <button
                  onClick={() => { setCryptoModal(null); setToast({ type: 'ok', text: 'Payment initiated. We will auto-confirm after on-chain detection (or confirm manually if automation is not configured).' }); setTimeout(() => setToast(null), 7000); }}
                  className="w-full btn-primary py-2.5 rounded-xl text-xs font-semibold text-white"
                >
                  I've Sent the Payment
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
