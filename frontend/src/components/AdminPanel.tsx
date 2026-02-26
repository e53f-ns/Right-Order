import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/store/useAuth';
import {
  Shield, Users, CreditCard, Activity, RefreshCw, Search,
  ChevronLeft, ChevronRight, Loader2, CheckCircle2, Clock,
  ArrowLeft, Trash2, BarChart3, Coins, XCircle,
} from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  role: string;
  subscription: string;
  subscriptionExpiresAt?: number;
  pro: boolean;
  createdAt: number;
  twoFactorEnabled?: boolean;
}

interface AdminPayment {
  id: string;
  userId: string;
  userEmail: string;
  plan: string;
  billing: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
  cryptoTxHash: string | null;
}

interface PendingCrypto {
  id: string;
  userId: string;
  userEmail: string;
  plan: string;
  amount: number;
  currency: string;
  method: string;
  createdAt: number;
  expiresAt: number | null;
}

interface SystemStats {
  connectedExchanges: number;
  totalExchanges: number;
  activeSymbols: number;
  uniqueSpreads: number;
  bestNetPercent: number;
}

interface AuthStats {
  totalUsers: number;
  proUsers: number;
  adminUsers: number;
  activeRefreshTokens: number;
}

type AdminTab = 'users' | 'payments' | 'crypto';

const PLAN_BADGE: Record<string, string> = {
  free: 'bg-gray-500/15 text-gray-400', pro: 'bg-blue-500/15 text-blue-400',
  elite: 'bg-purple-500/15 text-purple-400', ultimate: 'bg-amber-500/15 text-amber-400',
};
const STATUS_BADGE: Record<string, string> = {
  completed: 'text-green-400 bg-green-500/10', pending: 'text-amber-400 bg-amber-500/10', failed: 'text-red-400 bg-red-500/10',
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

export function AdminPanel() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);
  const [authStats, setAuthStats] = useState<AuthStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Payments
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Pending crypto
  const [pendingCrypto, setPendingCrypto] = useState<PendingCrypto[]>([]);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [txHashInput, setTxHashInput] = useState('');

  const isAdmin = user?.role === 'admin';
  const authHeaders = useCallback((): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  [token]);

  const fetchUsers = useCallback(async (p: number) => {
    try {
      const res = await fetch(`/api/admin/users?page=${p}&limit=20`, { headers: authHeaders(), credentials: 'include' });
      const json = await res.json();
      if (json.success) { setUsers(json.users ?? []); setTotalUsers(json.total ?? 0); }
    } catch { /* silent */ }
  }, [authHeaders]);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, authRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/auth/stats', { headers: authHeaders(), credentials: 'include' }),
      ]);
      const statsJson = await statsRes.json();
      const authJson = await authRes.json();
      const s = statsJson.stats ?? statsJson;
      if (s && typeof s === 'object') {
        setSysStats({
          connectedExchanges: typeof s.connectedExchanges === 'number' ? s.connectedExchanges : 0,
          totalExchanges: typeof s.totalExchanges === 'number' ? s.totalExchanges : 0,
          activeSymbols: typeof s.activeSymbols === 'number' ? s.activeSymbols : 0,
          uniqueSpreads: typeof s.uniqueSpreads === 'number' ? s.uniqueSpreads : 0,
          bestNetPercent: typeof s.bestNetPercent === 'number' ? s.bestNetPercent : 0,
        });
      }
      if (authJson.success) {
        setAuthStats({
          totalUsers: authJson.totalUsers ?? 0, proUsers: authJson.proUsers ?? 0,
          adminUsers: authJson.adminUsers ?? 0, activeRefreshTokens: authJson.activeRefreshTokens ?? 0,
        });
      }
    } catch { /* silent */ }
  }, [authHeaders]);

  const fetchPayments = useCallback(async (p: number) => {
    setPaymentsLoading(true);
    try {
      const res = await fetch(`/api/admin/payments?page=${p}`, { headers: authHeaders(), credentials: 'include' });
      const json = await res.json();
      if (json.success) { setPayments(json.payments ?? []); setPaymentsTotal(json.total ?? 0); }
    } catch { /* silent */ }
    finally { setPaymentsLoading(false); }
  }, [authHeaders]);

  const fetchPendingCrypto = useCallback(async () => {
    setCryptoLoading(true);
    try {
      const res = await fetch('/api/admin/payments/pending-crypto', { headers: authHeaders(), credentials: 'include' });
      const json = await res.json();
      if (json.success) setPendingCrypto(json.payments ?? []);
    } catch { /* silent */ }
    finally { setCryptoLoading(false); }
  }, [authHeaders]);

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    setLoading(true);
    Promise.all([fetchUsers(1), fetchStats()]).finally(() => setLoading(false));
  }, [token, navigate, fetchUsers, fetchStats]);

  useEffect(() => {
    if (tab === 'payments') void fetchPayments(paymentsPage);
    if (tab === 'crypto') void fetchPendingCrypto();
  }, [tab, paymentsPage, fetchPayments, fetchPendingCrypto]);

  const handlePageChange = (p: number) => { setPage(p); void fetchUsers(p); };

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3000);
  };

  const handleChangePlan = async (userId: string, plan: string) => {
    try {
      const res = await fetch('/api/admin/user/subscription', {
        method: 'POST', headers: authHeaders(), credentials: 'include',
        body: JSON.stringify({ userId, plan }),
      });
      const json = await res.json();
      json.success ? showMsg('ok', `Plan → ${plan}`) : showMsg('err', json.error ?? 'Failed');
      if (json.success) void fetchUsers(page);
    } catch (err) { showMsg('err', err instanceof Error ? err.message : 'Error'); }
  };

  const handleChangeRole = async (userId: string, role: string) => {
    try {
      const res = await fetch('/api/admin/user/role', {
        method: 'POST', headers: authHeaders(), credentials: 'include',
        body: JSON.stringify({ userId, role }),
      });
      const json = await res.json();
      json.success ? showMsg('ok', `Role → ${role}`) : showMsg('err', json.error ?? 'Failed');
      if (json.success) void fetchUsers(page);
    } catch (err) { showMsg('err', err instanceof Error ? err.message : 'Error'); }
  };

  const handleCleanup = async () => {
    try {
      const res = await fetch('/api/admin/cleanup-tokens', { method: 'POST', headers: authHeaders(), credentials: 'include' });
      const json = await res.json();
      if (json.success) showMsg('ok', `Cleaned ${json.cleaned ?? 0} tokens`);
    } catch { /* silent */ }
  };

  const handleConfirmCrypto = async (paymentId: string) => {
    if (!txHashInput.trim()) { showMsg('err', 'TX hash required'); return; }
    try {
      const res = await fetch('/api/payment/crypto/confirm', {
        method: 'POST', headers: authHeaders(), credentials: 'include',
        body: JSON.stringify({ paymentId, txHash: txHashInput.trim() }),
      });
      const json = await res.json();
      json.success ? showMsg('ok', 'Payment confirmed, subscription upgraded') : showMsg('err', json.error ?? 'Failed');
      if (json.success) { setConfirmingId(null); setTxHashInput(''); void fetchPendingCrypto(); }
    } catch (err) { showMsg('err', err instanceof Error ? err.message : 'Error'); }
  };

  if (!isAdmin && !loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="text-center p-8 glass-card rounded-2xl max-w-sm">
          <Shield size={40} className="mx-auto mb-4 text-red-400" />
          <h2 className="text-lg font-bold mb-2">Admin Access Required</h2>
          <p className="text-muted-foreground text-xs mb-4">You don't have permission to access this page.</p>
          <button onClick={() => navigate('/dashboard')} className="btn-primary px-6 py-2 rounded-lg text-xs font-semibold text-white">
            Back to Dashboard
          </button>
        </motion.div>
      </div>
    );
  }

  const filteredUsers = search
    ? users.filter(u => u.email.toLowerCase().includes(search.toLowerCase()) || u.id.includes(search))
    : users;
  const totalPages = Math.ceil(totalUsers / 20);
  const paymentsTotalPages = Math.ceil(paymentsTotal / 30);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border glass sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="btn-ghost p-1.5 rounded-lg">
              <ArrowLeft size={16} className="text-muted-foreground" />
            </button>
            <Shield size={18} className="text-red-400" />
            <h1 className="text-sm font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Admin Panel</h1>
          </div>
          <button onClick={() => { void fetchUsers(page); void fetchStats(); void fetchPayments(paymentsPage); }}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors">
            <RefreshCw size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Toast */}
        <AnimatePresence>
          {actionMsg && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={`px-4 py-2.5 rounded-xl text-xs font-medium ${actionMsg.type === 'ok' ? 'bg-green-500/8 text-green-400 border border-green-500/15' : 'bg-red-500/8 text-red-400 border border-red-500/15'}`}>
              {actionMsg.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats cards */}
        <motion.div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
          initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.04 } } }}>
          <StatCard icon={<Users size={14} />} label="Users" value={String(authStats?.totalUsers ?? '—')} color="text-blue-400" iconBg="bg-blue-500/10" />
          <StatCard icon={<CreditCard size={14} />} label="Paid" value={String(authStats?.proUsers ?? '—')} color="text-green-400" iconBg="bg-green-500/10" />
          <StatCard icon={<Shield size={14} />} label="Admins" value={String(authStats?.adminUsers ?? '—')} color="text-red-400" iconBg="bg-red-500/10" />
          <StatCard icon={<Activity size={14} />} label="Sessions" value={String(authStats?.activeRefreshTokens ?? '—')} color="text-purple-400" iconBg="bg-purple-500/10" />
          <StatCard icon={<BarChart3 size={14} />} label="Exchanges" value={sysStats ? `${sysStats.connectedExchanges}/${sysStats.totalExchanges}` : '—'} color="text-cyan-400" iconBg="bg-cyan-500/10" />
          <StatCard icon={<Activity size={14} />} label="Spreads" value={String(sysStats?.uniqueSpreads ?? '—')} color="text-amber-400" iconBg="bg-amber-500/10" />
        </motion.div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 p-1 glass-card rounded-xl w-fit">
          {([
            { id: 'users' as const, label: 'Users', icon: <Users size={13} /> },
            { id: 'payments' as const, label: 'Payments', icon: <CreditCard size={13} /> },
            { id: 'crypto' as const, label: 'Pending Crypto', icon: <Coins size={13} /> },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {t.icon} {t.label}
              {t.id === 'crypto' && pendingCrypto.length > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-bold flex items-center justify-center">
                  {pendingCrypto.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <button onClick={() => { void handleCleanup(); }}
            className="px-3 py-1.5 text-[10px] rounded-lg bg-orange-500/8 text-orange-400 border border-orange-500/15 font-medium flex items-center gap-1.5">
            <Trash2 size={11} /> Cleanup Tokens
          </button>
        </div>

        {/* === USERS TAB === */}
        {tab === 'users' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-xs font-semibold flex items-center gap-2">
                <Users size={13} /> Users ({totalUsers})
              </h2>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="text" placeholder="Search email or ID..."
                  value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-[11px] rounded-lg bg-background border border-border focus:border-primary/50 focus:outline-none w-full sm:w-56" />
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : (
              <div className="table-container">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/50 bg-white/[0.01]">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Plan</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">2FA</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Joined</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => (
                      <tr key={u.id} className="border-b border-border/20 hover:bg-white/[0.015] transition-colors">
                        <td className="px-4 py-2.5 font-medium">{u.email}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${u.role === 'admin' ? 'bg-red-500/15 text-red-400' : 'bg-gray-500/15 text-gray-400'}`}>
                            {u.role.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${PLAN_BADGE[u.subscription] ?? PLAN_BADGE['free']}`}>
                            {u.subscription.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[9px] font-bold ${u.twoFactorEnabled ? 'text-green-400' : 'text-muted-foreground/40'}`}>
                            {u.twoFactorEnabled ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <select value={u.subscription} onChange={e => { void handleChangePlan(u.id, e.target.value); }}
                              className="px-2 py-1 text-[10px] rounded bg-background border border-border focus:outline-none cursor-pointer">
                              <option value="free">Free</option><option value="pro">Pro</option>
                              <option value="elite">Elite</option><option value="ultimate">Ultimate</option>
                            </select>
                            <select value={u.role} onChange={e => { void handleChangeRole(u.id, e.target.value); }}
                              className="px-2 py-1 text-[10px] rounded bg-background border border-border focus:outline-none cursor-pointer">
                              <option value="user">User</option><option value="admin">Admin</option>
                            </select>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">No users found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Page {page}/{totalPages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1}
                    className="p-1 rounded hover:bg-white/5 disabled:opacity-30"><ChevronLeft size={13} /></button>
                  <button onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                    className="p-1 rounded hover:bg-white/5 disabled:opacity-30"><ChevronRight size={13} /></button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* === PAYMENTS TAB === */}
        {tab === 'payments' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-xs font-semibold flex items-center gap-2">
                <CreditCard size={13} /> All Payments ({paymentsTotal})
              </h2>
            </div>

            {paymentsLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-12 text-xs text-muted-foreground">No payments recorded</div>
            ) : (
              <div className="table-container">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/50 bg-white/[0.01]">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">User</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Plan</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Method</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-border/20 hover:bg-white/[0.015] transition-colors">
                        <td className="px-4 py-2.5 font-medium">{p.userEmail}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${PLAN_BADGE[p.plan] ?? PLAN_BADGE['free']}`}>
                            {p.plan.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-bold">${p.amount} {p.currency}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{p.method}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${STATUS_BADGE[p.status] ?? 'text-muted-foreground bg-white/[0.04]'}`}>
                            {p.status === 'completed' && <CheckCircle2 size={10} className="inline mr-0.5" />}
                            {p.status === 'pending' && <Clock size={10} className="inline mr-0.5" />}
                            {p.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {paymentsTotalPages > 1 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Page {paymentsPage}/{paymentsTotalPages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPaymentsPage(Math.max(1, paymentsPage - 1))} disabled={paymentsPage === 1}
                    className="p-1 rounded hover:bg-white/5 disabled:opacity-30"><ChevronLeft size={13} /></button>
                  <button onClick={() => setPaymentsPage(Math.min(paymentsTotalPages, paymentsPage + 1))} disabled={paymentsPage === paymentsTotalPages}
                    className="p-1 rounded hover:bg-white/5 disabled:opacity-30"><ChevronRight size={13} /></button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* === PENDING CRYPTO TAB === */}
        {tab === 'crypto' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="glass-card rounded-xl p-5">
              <h2 className="text-xs font-semibold flex items-center gap-2 mb-4">
                <Coins size={13} className="text-amber-400" /> Pending Crypto Payments ({pendingCrypto.length})
              </h2>

              {cryptoLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-xs gap-2">
                  <Loader2 size={14} className="animate-spin" /> Loading...
                </div>
              ) : pendingCrypto.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">No pending crypto payments</div>
              ) : (
                <div className="space-y-3">
                  {pendingCrypto.map(p => (
                    <div key={p.id} className="p-3 rounded-lg bg-white/[0.02] border border-border/30">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                        <div>
                          <div className="text-xs font-medium">{p.userEmail}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {p.plan.charAt(0).toUpperCase() + p.plan.slice(1)} · {p.method.replace('crypto_usdt_', 'USDT ')} · {new Date(p.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-amber-400">${p.amount} USDT</div>
                          {p.expiresAt && (
                            <div className="text-[9px] text-muted-foreground">
                              Expires {new Date(p.expiresAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>

                      {confirmingId === p.id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <input type="text" value={txHashInput} onChange={e => setTxHashInput(e.target.value)}
                            placeholder="Enter TX hash..." className="input-field text-xs flex-1" />
                          <button onClick={() => { void handleConfirmCrypto(p.id); }}
                            className="btn-primary px-3 py-2 rounded-lg text-[10px] font-semibold text-white flex items-center gap-1">
                            <CheckCircle2 size={11} /> Confirm
                          </button>
                          <button onClick={() => { setConfirmingId(null); setTxHashInput(''); }}
                            className="btn-ghost px-2 py-2 rounded-lg text-[10px]">
                            <XCircle size={13} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmingId(p.id)}
                          className="mt-2 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-green-500/8 text-green-400 border border-green-500/15">
                          Confirm Payment
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color, iconBg }: { icon: React.ReactNode; label: string; value: string; color: string; iconBg: string }) {
  return (
    <motion.div variants={cardVariants} className="glass-card rounded-xl p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${iconBg} ${color}`}>{icon}</div>
        <span className="text-[9px] font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-heading)' }}>{value}</div>
    </motion.div>
  );
}
