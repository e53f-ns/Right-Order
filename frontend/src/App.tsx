import { useState, useEffect, useCallback, Component, type ReactNode, type ErrorInfo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { useAuth, apiLogout, apiValidateToken } from '@/store/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Landing } from '@/components/Landing';
import { LoginPage } from '@/components/LoginPage';
import { ProfilePage } from '@/components/ProfilePage';
import { PricingPage } from '@/components/PricingPage';
import { SpreadsTable } from '@/components/SpreadsTable';
import { AIChat } from '@/components/AIChat';
import { WalletsTab } from '@/components/tabs/WalletsTab';
import { FundingTab } from '@/components/tabs/FundingTab';
import { DexTab } from '@/components/tabs/DexTab';
import { MessagesTab } from '@/components/tabs/MessagesTab';
import { NftsTab } from '@/components/tabs/NftsTab';
import { StatArbTab } from '@/components/tabs/StatArbTab';
import { PairsTradingTab } from '@/components/tabs/PairsTradingTab';
import { FundingArbTab } from '@/components/tabs/FundingArbTab';
import { FuturesArbTab } from '@/components/tabs/FuturesArbTab';
import { P2PArbTab } from '@/components/tabs/P2PArbTab';
import { PlanGate } from '@/components/guards/PlanGate';
import { AdminPanel } from '@/components/AdminPanel';
import { DashboardHome } from '@/components/DashboardHome';
import {
  BarChart3, Hexagon, Wallet, TrendingUp, MessageSquare, ImageIcon, Bot,
  Activity, GitBranch, Banknote, LineChart, Users, Menu, X,
  ChevronLeft, ChevronRight, LogOut, User, Shield, Loader2,
} from 'lucide-react';
import type { Spread, DashboardStats } from '@/types/spread';

// --------------- ErrorBoundary ---------------
interface EBProps { name: string; children: ReactNode }
interface EBState { hasError: boolean; error: Error | null; info: ErrorInfo | null }

class SectionBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info);
    this.setState({ info });
  }
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 m-2 border border-red-500/30 rounded-xl bg-red-500/5">
          <p className="text-red-400 font-semibold text-sm">Crash in &lt;{this.props.name}&gt;</p>
          <pre className="text-red-300/70 text-xs mt-1 whitespace-pre-wrap break-words">
            {String(this.state.error?.message ?? 'Unknown error')}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// --------------- Safe string helper ---------------
function safe(v: unknown, fallback = 'N/A'): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  console.warn('[safe] blocked object render:', v);
  return fallback;
}

// --------------- Types ---------------
type TabId = 'home' | 'spreads' | 'dex' | 'wallets' | 'funding' | 'funding_arb' | 'futures_arb' | 'stat_arb' | 'pairs_trading' | 'p2p' | 'messages' | 'nfts' | 'ai';
type SubscriptionPlanLocal = 'free' | 'pro' | 'elite' | 'ultimate';

const PLAN_ORD: Record<SubscriptionPlanLocal, number> = { free: 0, pro: 1, elite: 2, ultimate: 3 };

const PLAN_BADGE: Record<SubscriptionPlanLocal, string> = {
  free: 'badge-gray', pro: 'badge-blue', elite: 'badge-purple', ultimate: 'badge-amber',
};

// --------------- Data fetchers ---------------
async function fetchSpreads(): Promise<Spread[]> {
  try {
    const res = await fetch('/api/spreads');
    if (!res.ok) return [];
    const json = await res.json();
    const arr: Spread[] = Array.isArray(json) ? json : (Array.isArray(json.spreads) ? json.spreads : []);
    console.log('[Fetch] Spreads received:', arr.length);
    return arr;
  } catch (err) {
    console.error('[Fetch] spreads error:', err);
    return [];
  }
}

async function fetchStats(): Promise<DashboardStats | null> {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return null;
    const json = await res.json();
    const s = json.stats ?? json;
    if (s && typeof s === 'object') {
      const normalized: DashboardStats = {
        connectedExchanges: typeof s.connectedExchanges === 'number' ? s.connectedExchanges : (typeof s.activeExchangesCount === 'number' ? s.activeExchangesCount : 0),
        totalExchanges: typeof s.totalExchanges === 'number' ? s.totalExchanges : (typeof s.activeExchangesCount === 'number' ? s.activeExchangesCount : 0),
        activeSymbols: typeof s.activeSymbols === 'number' ? s.activeSymbols : 0,
        uniqueSpreads: typeof s.uniqueSpreads === 'number' ? s.uniqueSpreads : (typeof s.opportunitiesCount === 'number' ? s.opportunitiesCount : 0),
        bestNetPercent: typeof s.bestNetPercent === 'number' ? s.bestNetPercent : 0,
        totalCalculations: typeof s.totalCalculations === 'number' ? s.totalCalculations : 0,
        uptime: typeof s.uptime === 'number' ? s.uptime : 0,
      };
      return normalized;
    }
    return null;
  } catch (err) {
    console.error('[Fetch] stats error:', err);
    return null;
  }
}

// --------------- Tab config ---------------
const TABS: { id: TabId; label: string; icon: ReactNode; section?: string; requiredPlan?: SubscriptionPlanLocal }[] = [
  { id: 'home',          label: 'Dashboard',      icon: <Activity size={16} />,     section: 'Overview' },
  { id: 'spreads',       label: 'CEX Spreads',    icon: <BarChart3 size={16} />,    section: 'Trading' },
  { id: 'dex',           label: 'DEX',            icon: <Hexagon size={16} /> },
  { id: 'funding',       label: 'Funding',        icon: <TrendingUp size={16} /> },
  { id: 'funding_arb',   label: 'Funding Arb',    icon: <Banknote size={16} />,     requiredPlan: 'pro', section: 'Strategies' },
  { id: 'futures_arb',   label: 'Futures Arb',    icon: <LineChart size={16} />,     requiredPlan: 'pro' },
  { id: 'stat_arb',      label: 'Stat Arb',       icon: <Activity size={16} />,      requiredPlan: 'pro' },
  { id: 'pairs_trading', label: 'Pairs Trading',  icon: <GitBranch size={16} />,     requiredPlan: 'pro' },
  { id: 'p2p',           label: 'P2P Arb',        icon: <Users size={16} />,         requiredPlan: 'elite' },
  { id: 'wallets',       label: 'Wallets',        icon: <Wallet size={16} />,        section: 'Tools' },
  { id: 'messages',      label: 'Messages',       icon: <MessageSquare size={16} /> },
  { id: 'nfts',          label: 'NFTs',           icon: <ImageIcon size={16} /> },
  { id: 'ai',            label: 'AI Assistant',   icon: <Bot size={16} /> },
];

// ═══════════════════════════════════════════
// App Router
// ═══════════════════════════════════════════

function App() {
  return (
    <Routes>
      <Route path="/" element={<SectionBoundary name="Landing"><Landing /></SectionBoundary>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
      <Route path="/profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/admin" element={<AuthGuard><AdminPanel /></AuthGuard>} />
    </Routes>
  );
}

// ═══════════════════════════════════════════
// Auth Guard
// ═══════════════════════════════════════════

function AuthGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    if (!user) {
      void apiValidateToken().then((valid) => { if (!valid) navigate('/login'); });
    }
  }, [token, user, navigate]);

  if (!token) return null;
  return <>{children}</>;
}

// ═══════════════════════════════════════════
// Dashboard Page — Main Layout
// ═══════════════════════════════════════════

function DashboardPage() {
  const navigate = useNavigate();
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const stats = useStore((s) => s.stats);
  const spreads = useStore((s) => s.spreads);
  const spreadsLoading = useStore((s) => s.spreadsLoading);
  const setSpreads = useStore((s) => s.setSpreads);
  const setSpreadsLoading = useStore((s) => s.setSpreadsLoading);
  const setStats = useStore((s) => s.setStats);
  const isReconnecting = useStore((s) => s.connection.isReconnecting);
  const reconnectAttempts = useStore((s) => s.connection.reconnectAttempts);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { isConnected } = useWebSocket();
  const [paymentToast, setPaymentToast] = useState<string | null>(null);

  // Handle payment=success/cancelled URL params from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (payment === 'success') {
      setPaymentToast('Payment successful! Your subscription will be activated shortly.');
      void apiValidateToken();
      window.history.replaceState({}, '', '/dashboard');
      setTimeout(() => setPaymentToast(null), 8000);
    } else if (payment === 'cancelled') {
      setPaymentToast('Payment cancelled. You can try again anytime.');
      window.history.replaceState({}, '', '/dashboard');
      setTimeout(() => setPaymentToast(null), 5000);
    }
  }, []);

  // Close mobile sidebar on route/tab change
  const handleTabChange = useCallback((t: TabId) => {
    setActiveTab(t);
    setMobileOpen(false);
  }, [setActiveTab]);

  // Fetch spreads + stats on mount + interval
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSpreadsLoading(true);
      const [arr, st] = await Promise.all([fetchSpreads(), fetchStats()]);
      if (cancelled) return;
      if (arr.length > 0) setSpreads(arr);
      if (st) setStats(st);
      setSpreadsLoading(false);
    };
    void load();
    const iv = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [setSpreads, setSpreadsLoading, setStats]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar */}
      <SectionBoundary name="Sidebar">
        <DashboardSidebar
          activeTab={activeTab as TabId}
          onTabChange={handleTabChange}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
      </SectionBoundary>

      {/* Main content area */}
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <SectionBoundary name="Header">
          <DashboardHeader
            stats={stats}
            spreads={spreads}
            isConnected={isConnected}
            onBack={() => navigate('/')}
            onMenuToggle={() => setMobileOpen(!mobileOpen)}
          />
        </SectionBoundary>

        <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 overflow-y-auto overflow-x-hidden">
          <AnimatePresence>
            {paymentToast && (
              <motion.div
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className={`mb-4 px-4 py-3 rounded-xl text-xs font-medium ${
                  paymentToast.includes('successful') ? 'bg-green-500/8 text-green-400 border border-green-500/15' : 'bg-amber-500/8 text-amber-400 border border-amber-500/15'
                }`}
              >
                {paymentToast}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <SectionBoundary name={`Tab:${activeTab}`}>
                <TabContent
                  activeTab={activeTab as TabId}
                  spreads={spreads}
                  spreadsLoading={spreadsLoading}
                  stats={stats}
                  isConnected={isConnected}
                  onNavigateTab={(t: string) => setActiveTab(t)}
                />
              </SectionBoundary>
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="border-t border-border px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium">Right Order</span>
          <span className="hide-mobile">Professional Arbitrage Scanner</span>
        </footer>
      </div>

      {/* Reconnecting overlay */}
      <AnimatePresence>
        {!isConnected && isReconnecting && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="glass-card rounded-2xl p-8 text-center max-w-xs mx-4"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <Loader2 size={32} className="text-primary animate-spin mx-auto mb-4" />
              <h2 className="text-base font-semibold mb-1">Reconnecting...</h2>
              <p className="text-xs text-muted-foreground">
                Attempt {safe(reconnectAttempts, '0')} of 20
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════
// Sidebar — Premium + Responsive
// ═══════════════════════════════════════════

function DashboardSidebar({ activeTab, onTabChange, collapsed, onToggle, mobileOpen, onMobileClose }: {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const userPlan = useAuth((s) => s.user?.subscription ?? 'free') as SubscriptionPlanLocal;
  const navigate = useNavigate();

  let lastSection = '';

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      {/* Logo area */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
        {(!collapsed || mobileOpen) && (
          <motion.span
            className="text-sm font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-heading)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
          >
            Right Order
          </motion.span>
        )}
        <div className="flex items-center gap-1">
          {/* Close button on mobile */}
          <button
            onClick={onMobileClose}
            className="hide-desktop p-1.5 rounded-lg btn-ghost text-muted-foreground"
          >
            <X size={16} />
          </button>
          {/* Collapse toggle on desktop */}
          <button
            onClick={onToggle}
            className="hide-mobile p-1.5 rounded-lg btn-ghost text-muted-foreground"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const showSection = tab.section && tab.section !== lastSection;
          if (tab.section) lastSection = tab.section;
          const locked = tab.requiredPlan && PLAN_ORD[userPlan] < PLAN_ORD[tab.requiredPlan];

          return (
            <div key={tab.id}>
              {/* Section label */}
              {showSection && (!collapsed || mobileOpen) && (
                <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                  {tab.section}
                </div>
              )}

              <motion.button
                onClick={() => onTabChange(tab.id)}
                className={`w-full flex items-center gap-2.5 rounded-lg text-[13px] transition-colors
                  ${collapsed && !mobileOpen ? 'justify-center px-0 py-2.5' : 'px-3 py-2'}
                  ${isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03]'
                  }`}
                whileTap={{ scale: 0.97 }}
                title={collapsed && !mobileOpen ? tab.label : undefined}
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0
                  ${isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                >
                  {tab.icon}
                </span>
                {(!collapsed || mobileOpen) && (
                  <span className="flex-1 flex items-center justify-between truncate">
                    <span>{tab.label}</span>
                    {locked && (
                      <span className={`badge text-[8px] ${
                        tab.requiredPlan === 'elite' || tab.requiredPlan === 'ultimate'
                          ? 'badge-purple' : 'badge-blue'
                      }`}>
                        {tab.requiredPlan === 'elite' || tab.requiredPlan === 'ultimate' ? 'ELITE' : 'PRO'}
                      </span>
                    )}
                  </span>
                )}
                {/* Active indicator */}
                {isActive && (!collapsed || mobileOpen) && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute left-0 w-[3px] h-5 rounded-r-full bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </motion.button>
            </div>
          );
        })}
      </nav>

      {/* Sidebar footer */}
      {(!collapsed || mobileOpen) && (
        <div className="p-3 border-t border-border space-y-2">
          <button
            onClick={() => { navigate('/profile'); onMobileClose(); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.03] transition-colors"
          >
            <User size={14} /> Profile
          </button>
          <button
            onClick={() => { navigate('/pricing'); onMobileClose(); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.03] transition-colors"
          >
            <Shield size={14} /> Upgrade Plan
          </button>
        </div>
      )}
    </aside>
  );
}

// ═══════════════════════════════════════════
// Header — Premium + Responsive
// ═══════════════════════════════════════════

function DashboardHeader({ stats, spreads, isConnected, onBack, onMenuToggle }: {
  stats: DashboardStats | null;
  spreads: Spread[];
  isConnected: boolean;
  onBack: () => void;
  onMenuToggle: () => void;
}) {
  const hasValid = stats !== null && typeof stats === 'object' && typeof stats.connectedExchanges === 'number';
  const liveBestNet = spreads.length > 0 ? Math.max(...spreads.map(s => s.netPercent)) : 0;
  const authUser = useAuth((s) => s.user);
  const navigate = useNavigate();

  const handleLogout = () => {
    void apiLogout().then(() => navigate('/login'));
  };

  return (
    <header className="h-14 border-b border-border bg-surface flex items-center px-4 md:px-6 gap-4 flex-shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onMenuToggle}
        className="hide-desktop p-1.5 -ml-1 rounded-lg btn-ghost text-muted-foreground"
      >
        <Menu size={18} />
      </button>

      {/* Logo / Home link (desktop) */}
      <button
        onClick={onBack}
        className="hide-mobile text-sm font-bold tracking-tight hover:text-primary transition-colors"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Right Order
      </button>

      {/* Stats bar — hide on mobile */}
      {hasValid && (
        <div className="hide-mobile flex items-center gap-4 ml-4 text-xs text-muted-foreground">
          <span>Exchanges <span className="text-foreground font-medium">{safe(stats.connectedExchanges)}/{safe(stats.totalExchanges)}</span></span>
          <span className="text-border">|</span>
          <span>Symbols <span className="text-foreground font-medium">{safe(stats.activeSymbols)}</span></span>
          <span className="text-border">|</span>
          <span>Spreads <span className="text-foreground font-medium">{safe(stats.uniqueSpreads)}</span></span>
          <span className="text-border">|</span>
          <span>Best <span className={`font-semibold ${liveBestNet > 0 ? 'text-green-400' : 'text-red-400'}`}>{liveBestNet.toFixed(3)}%</span></span>
        </div>
      )}

      {/* Right section */}
      <div className="ml-auto flex items-center gap-2 md:gap-3 min-w-0">
        {/* Connection status */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium
          ${isConnected ? 'bg-green-500/8 text-green-400' : 'bg-red-500/8 text-red-400'}`}
        >
          <span className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
          <span className="hide-mobile">{isConnected ? 'Live' : 'Offline'}</span>
        </div>

        {/* Plan badge */}
        {authUser && (
          <span className={`badge ${PLAN_BADGE[(authUser.subscription ?? 'free') as SubscriptionPlanLocal]}`}>
            {(authUser.subscription ?? 'free').toUpperCase()}
          </span>
        )}

        {/* User actions */}
        {authUser && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs text-muted-foreground hide-tablet truncate max-w-[220px]">{authUser.email}</span>
            {authUser.role === 'admin' && (
              <button onClick={() => navigate('/admin')} className="btn-danger px-2 py-1 rounded-md text-[10px] font-medium hide-mobile">
                Admin
              </button>
            )}
            <button onClick={() => navigate('/profile')} className="btn-ghost px-2 py-1 rounded-md text-[10px] font-medium hide-mobile">
              <User size={12} />
            </button>
            <button onClick={handleLogout} className="btn-ghost px-2 py-1 rounded-md text-[10px] font-medium text-red-400/70 hover:text-red-400">
              <LogOut size={12} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════
// Tab Content
// ═══════════════════════════════════════════

function TabContent({ activeTab, spreads, spreadsLoading, stats, isConnected, onNavigateTab }: {
  activeTab: TabId; spreads: Spread[]; spreadsLoading: boolean;
  stats: DashboardStats | null; isConnected: boolean; onNavigateTab: (tab: string) => void;
}) {
  switch (activeTab) {
    case 'home':           return <DashboardHome stats={stats} spreadsCount={spreads.length} isConnected={isConnected} onNavigateTab={onNavigateTab} />;
    case 'spreads':        return <SpreadsTable spreads={spreads} isLoading={spreadsLoading} />;
    case 'dex':            return <DexTab />;
    case 'funding':        return <FundingTab />;
    case 'funding_arb':    return <PlanGate requiredPlan="pro" tabLabel="Funding Arbitrage"><FundingArbTab /></PlanGate>;
    case 'futures_arb':    return <PlanGate requiredPlan="pro" tabLabel="Futures Arbitrage"><FuturesArbTab /></PlanGate>;
    case 'stat_arb':       return <PlanGate requiredPlan="pro" tabLabel="Statistical Arbitrage"><StatArbTab /></PlanGate>;
    case 'pairs_trading':  return <PlanGate requiredPlan="pro" tabLabel="Pairs Trading"><PairsTradingTab /></PlanGate>;
    case 'p2p':            return <PlanGate requiredPlan="elite" tabLabel="P2P Arbitrage"><P2PArbTab /></PlanGate>;
    case 'wallets':        return <WalletsTab />;
    case 'messages':       return <MessagesTab />;
    case 'nfts':           return <NftsTab />;
    case 'ai':             return <AIChat />;
    default:               return null;
  }
}

export default App;
