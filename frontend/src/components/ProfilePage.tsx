import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, apiLogout } from '@/store/useAuth';
import { MiniChart, type ChartDataPoint } from './charts/MiniChart';
import {
  ArrowLeft, User, CreditCard, Bell, Settings, LogOut, Loader2,
  Clock, CheckCircle2, XCircle, Send, ToggleLeft, ToggleRight,
} from 'lucide-react';

interface TelegramStatus {
  chatId: string;
  enabled: boolean;
  minNetPercent: number;
  alertsSent: number;
  lastAlertAt: number;
  botConnected: boolean;
}

interface PaymentRecord {
  id: string;
  plan: string;
  billing: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
}

const PLAN_BADGE: Record<string, string> = {
  free: 'badge badge-gray', pro: 'badge badge-blue', elite: 'badge badge-purple', ultimate: 'badge badge-amber',
};
const STATUS_BADGE: Record<string, string> = {
  completed: 'text-green-400 bg-green-500/10', pending: 'text-amber-400 bg-amber-500/10', failed: 'text-red-400 bg-red-500/10',
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const updateLocalPrefs = useAuth((s) => s.updatePreferences);

  const [depositSize, setDepositSize] = useState(user?.preferences.depositSize ?? 1000);
  const [autoRefresh, setAutoRefresh] = useState(user?.preferences.autoRefreshSec ?? 30);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment history
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Session performance chart
  const [perfData, setPerfData] = useState<ChartDataPoint[]>([]);
  const perfRef = useRef<Array<{ ts: number; spreads: number; bestNet: number }>>([]);

  const authHeaders = useCallback((): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  [token]);

  const fetchPerf = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const json = await res.json();
      const s = json.stats ?? json;
      const now = Date.now();
      const spreads = typeof s.uniqueSpreads === 'number' ? s.uniqueSpreads : 0;
      const bestNet = typeof s.bestNetPercent === 'number' ? s.bestNetPercent : 0;
      const hist = perfRef.current;
      if (hist.length === 0 || now - (hist[hist.length - 1]?.ts ?? 0) > 14000) {
        hist.push({ ts: now, spreads, bestNet });
        if (hist.length > 200) hist.shift();
      }
      setPerfData(hist.map(h => ({
        time: new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: h.ts,
        value: h.spreads,
        value2: h.bestNet,
      })));
    } catch { /* silent */ }
  }, []);

  const fetchPayments = useCallback(async () => {
    if (!token) return;
    setPaymentsLoading(true);
    try {
      const res = await fetch('/api/payment/history', { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
      const json = await res.json() as { success: boolean; payments?: PaymentRecord[] };
      if (json.success && json.payments) setPayments(json.payments);
    } catch { /* silent */ }
    finally { setPaymentsLoading(false); }
  }, [token]);

  useEffect(() => {
    void fetchPerf();
    const iv = setInterval(() => void fetchPerf(), 15000);
    return () => clearInterval(iv);
  }, [fetchPerf]);

  useEffect(() => { void fetchPayments(); }, [fetchPayments]);

  // Telegram state
  const [tgChatId, setTgChatId] = useState('');
  const [tgMinNet, setTgMinNet] = useState(1.0);
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgMsg, setTgMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchTelegramStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/telegram/status', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json() as { config?: TelegramStatus };
      if (json.config) {
        setTgStatus(json.config);
        if (json.config.chatId) setTgChatId(json.config.chatId);
        if (json.config.minNetPercent !== undefined) setTgMinNet(json.config.minNetPercent);
      }
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => { void fetchTelegramStatus(); }, [fetchTelegramStatus]);

  const handleTgSetup = async () => {
    if (!tgChatId.trim()) { setTgMsg({ type: 'err', text: 'Chat ID required. Message @userinfobot on Telegram to get your ID.' }); return; }
    setTgSaving(true); setTgMsg(null);
    try {
      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ chatId: tgChatId.trim(), minNetPercent: tgMinNet }),
      });
      const json = await res.json() as { success: boolean; error?: string; config?: TelegramStatus };
      if (!json.success) { setTgMsg({ type: 'err', text: json.error ?? 'Setup failed' }); return; }
      if (json.config) setTgStatus(json.config);
      setTgMsg({ type: 'ok', text: 'Chat ID saved! Telegram alerts enabled.' });
      setTimeout(() => setTgMsg(null), 3000);
    } catch (err) {
      setTgMsg({ type: 'err', text: err instanceof Error ? err.message : 'Network error' });
    } finally { setTgSaving(false); }
  };

  const handleTgToggle = async () => {
    if (!tgStatus) return;
    try {
      const res = await fetch('/api/telegram/toggle', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !tgStatus.enabled }),
      });
      const json = await res.json() as { success: boolean; config?: TelegramStatus };
      if (json.config) setTgStatus(json.config);
    } catch { /* silent */ }
  };

  const handleTgTest = async () => {
    setTgTesting(true); setTgMsg(null);
    try {
      const res = await fetch('/api/telegram/send-test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as { success: boolean; error?: string };
      setTgMsg(json.success
        ? { type: 'ok', text: 'Test alert sent! Check your Telegram.' }
        : { type: 'err', text: json.error ?? 'Test failed' });
      setTimeout(() => setTgMsg(null), 4000);
    } catch (err) {
      setTgMsg({ type: 'err', text: err instanceof Error ? err.message : 'Network error' });
    } finally { setTgTesting(false); }
  };

  useEffect(() => {
    if (!token) navigate('/login');
  }, [token, navigate]);

  useEffect(() => {
    if (user) {
      setDepositSize(user.preferences.depositSize);
      setAutoRefresh(user.preferences.autoRefreshSec);
    }
  }, [user]);

  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/auth/preferences', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ depositSize, autoRefreshSec: autoRefresh }),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error ?? 'Failed to save preferences'); return; }
      updateLocalPrefs({ depositSize, autoRefreshSec: autoRefresh });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally { setSaving(false); }
  };

  const handleLogout = async () => {
    await apiLogout();
    navigate('/login');
  };

  if (!user) return null;

  const plan = user.subscription ?? 'free';
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <button onClick={() => navigate('/dashboard')} className="btn-ghost px-3 py-1.5 rounded-lg text-xs text-muted-foreground mb-4 inline-flex items-center gap-1.5">
            <ArrowLeft size={12} /> Back to Dashboard
          </button>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
            Profile & Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Manage your account, preferences, and integrations</p>
        </motion.div>

        <motion.div
          className="space-y-5"
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        >
          {/* Account Card */}
          <motion.div variants={cardVariants} className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <User size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Account</h2>
                <p className="text-[10px] text-muted-foreground">Your account details</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-white/[0.02]">
                <div className="text-[10px] text-muted-foreground mb-0.5">Email</div>
                <div className="text-xs font-medium truncate">{user.email}</div>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02]">
                <div className="text-[10px] text-muted-foreground mb-0.5">Member Since</div>
                <div className="text-xs font-medium">{new Date(user.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] sm:col-span-2">
                <div className="text-[10px] text-muted-foreground mb-0.5">User ID</div>
                <div className="text-[10px] font-mono text-muted-foreground truncate">{user.id}</div>
              </div>
            </div>
          </motion.div>

          {/* Subscription Card */}
          <motion.div variants={cardVariants} className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <CreditCard size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Subscription</h2>
                  <p className="text-[10px] text-muted-foreground">Your current plan</p>
                </div>
              </div>
              <span className={`${PLAN_BADGE[plan]} text-[10px] px-2.5 py-1 rounded-md font-bold`}>
                {planLabel}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg bg-white/[0.02]">
              <div>
                <div className="text-lg font-bold" style={{ fontFamily: 'var(--font-heading)' }}>{planLabel} Plan</div>
                {user.subscriptionExpiresAt ? (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Expires {new Date(user.subscriptionExpiresAt).toLocaleDateString()}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {plan === 'free' ? 'Free forever' : 'Active'}
                  </div>
                )}
              </div>
              <button
                onClick={() => navigate('/pricing')}
                className={plan === 'ultimate'
                  ? 'btn-secondary px-4 py-2 rounded-lg text-xs font-semibold'
                  : 'btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white'}
              >
                {plan === 'ultimate' ? '✓ Max Plan' : 'Upgrade Plan'}
              </button>
            </div>
          </motion.div>

          {/* Preferences Card */}
          <motion.div variants={cardVariants} className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center">
                <Settings size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Preferences</h2>
                <p className="text-[10px] text-muted-foreground">Customize your experience</p>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mb-3 overflow-hidden">
                  <div className="px-3 py-2 rounded-lg text-xs bg-red-500/8 text-red-400 border border-red-500/15">{error}</div>
                </motion.div>
              )}
              {saved && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mb-3 overflow-hidden">
                  <div className="px-3 py-2 rounded-lg text-xs bg-green-500/8 text-green-400 border border-green-500/15">Preferences saved</div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-muted-foreground font-medium mb-1.5 block">Deposit Size (USDT)</label>
                <input type="number" min={10} max={1000000} step={100} value={depositSize}
                  onChange={e => setDepositSize(Number(e.target.value))} className="input-field" />
                <p className="text-[10px] text-muted-foreground mt-1">Used to calculate profit in $ for each spread</p>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground font-medium mb-1.5 block">Auto-refresh Interval (sec)</label>
                <input type="number" min={5} max={300} step={5} value={autoRefresh}
                  onChange={e => setAutoRefresh(Number(e.target.value))} className="input-field" />
              </div>
              <motion.button
                onClick={() => { void handleSave(); }}
                disabled={saving}
                className="w-full btn-primary py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                whileTap={{ scale: 0.98 }}
              >
                {saving ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : 'Save Preferences'}
              </motion.button>
            </div>
          </motion.div>

          {/* Session Performance */}
          <motion.div variants={cardVariants} className="glass-card rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground mb-3">Session Performance</h3>
            <MiniChart
              data={perfData}
              title="Unique Spreads & Best Net %"
              type="area"
              color="#4ade80"
              color2="#fbbf24"
              label1="Spreads"
              label2="Best Net %"
              height={140}
              formatValue={v => v >= 1 ? v.toFixed(0) : v.toFixed(3)}
            />
          </motion.div>

          {/* Telegram Alerts Card */}
          <motion.div variants={cardVariants} className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                <Bell size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Telegram Alerts</h2>
                <p className="text-[10px] text-muted-foreground">Get notified about profitable spreads</p>
              </div>
            </div>

            <AnimatePresence>
              {tgMsg && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mb-3 overflow-hidden">
                  <div className={`px-3 py-2 rounded-lg text-xs border ${tgMsg.type === 'ok' ? 'bg-green-500/8 text-green-400 border-green-500/15' : 'bg-red-500/8 text-red-400 border-red-500/15'}`}>
                    {tgMsg.text}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Status badges */}
            {tgStatus && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${tgStatus.botConnected ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  <span className={`status-dot ${tgStatus.botConnected ? 'online' : 'offline'}`} />
                  Bot {tgStatus.botConnected ? 'Connected' : 'Offline'}
                </span>
                {tgStatus.chatId && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${tgStatus.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    {tgStatus.enabled ? 'Alerts ON' : 'Alerts OFF'}
                  </span>
                )}
                {tgStatus.alertsSent > 0 && (
                  <span className="text-[10px] text-muted-foreground">{tgStatus.alertsSent} sent</span>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Telegram Chat ID</label>
                <input type="text" value={tgChatId} onChange={e => setTgChatId(e.target.value)}
                  placeholder="Message @userinfobot on Telegram"
                  className="input-field text-xs" />
                <p className="text-[9px] text-muted-foreground/60 mt-1">
                  Open Telegram → search @userinfobot → /start → copy your ID
                </p>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Min Net % for Alerts</label>
                <input type="number" value={tgMinNet} onChange={e => setTgMinNet(Number(e.target.value))} step={0.1} min={0}
                  className="input-field text-xs" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <motion.button onClick={() => { void handleTgSetup(); }} disabled={tgSaving}
                className="flex-1 btn-primary py-2 rounded-lg text-[11px] font-semibold text-white disabled:opacity-50"
                whileTap={{ scale: 0.98 }}>
                {tgSaving ? 'Saving...' : tgStatus?.chatId ? 'Update' : 'Save Chat ID'}
              </motion.button>
              {tgStatus?.chatId && (
                <>
                  <button onClick={() => { void handleTgToggle(); }}
                    className={`px-3 py-2 rounded-lg text-[11px] font-medium border ${tgStatus.enabled ? 'bg-red-500/8 text-red-400 border-red-500/15' : 'bg-green-500/8 text-green-400 border-green-500/15'}`}>
                    {tgStatus.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  </button>
                  <button onClick={() => { void handleTgTest(); }} disabled={tgTesting}
                    className="px-3 py-2 rounded-lg text-[11px] font-medium bg-primary/8 text-primary border border-primary/15 disabled:opacity-50">
                    <Send size={12} />
                  </button>
                </>
              )}
            </div>
          </motion.div>

          {/* Payment History */}
          <motion.div variants={cardVariants} className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                <Clock size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Payment History</h2>
                <p className="text-[10px] text-muted-foreground">Your billing records</p>
              </div>
            </div>

            {paymentsLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-xs gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground/60">No payments yet</div>
            ) : (
              <div className="space-y-2">
                {payments.slice(0, 5).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02]">
                    <div className="flex items-center gap-2.5">
                      {p.status === 'completed' ? <CheckCircle2 size={14} className="text-green-400" /> :
                       p.status === 'pending' ? <Clock size={14} className="text-amber-400" /> :
                       <XCircle size={14} className="text-red-400" />}
                      <div>
                        <div className="text-xs font-medium">{p.plan.charAt(0).toUpperCase() + p.plan.slice(1)} · {p.billing}</div>
                        <div className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()} · {p.method}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold">${p.amount} {p.currency}</div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[p.status] ?? 'text-muted-foreground bg-white/[0.04]'}`}>
                        {p.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Logout */}
          <motion.div variants={cardVariants} className="pt-2">
            <button
              onClick={() => { void handleLogout(); }}
              className="w-full btn-danger py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
            >
              <LogOut size={13} /> Sign Out
            </button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
