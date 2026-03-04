import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useAnimation, useInView, AnimatePresence } from 'framer-motion';
import { apiLogout, apiValidateToken, useAuth } from '@/store/useAuth';
import {
  Zap, Link2, BarChart3, Wallet, Bot, Radio,
  ArrowRight, CheckCircle2, Shield, Clock, Globe,
  ChevronDown, Star,
} from 'lucide-react';

// ═══════════ Animated section (scroll-triggered) ═══════════
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const controls = useAnimation();
  useEffect(() => { if (inView) controls.start('visible'); }, [inView, controls]);
  return (
    <motion.div
      ref={ref} className={className}
      initial="hidden" animate={controls}
      variants={{
        hidden: { opacity: 0, y: 40 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.55, delay, ease: [0.25, 0.46, 0.45, 0.94] } },
      }}
    >{children}</motion.div>
  );
}

// ═══════════ Animated counter ═══════════
function Counter({ to, duration = 1.6 }: { to: number; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - t, 3);
      start = Math.round(eased * to);
      setVal(start);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, to, duration]);
  return <span ref={ref}>{val.toLocaleString()}</span>;
}

// ═══════════ Data ═══════════
interface LiveStats { exchanges: number; symbols: number; spreads: number; bestNet: number }

const FEATURES: { icon: ReactNode; title: string; desc: string; gradient: string }[] = [
  { icon: <Zap size={22} />, title: 'CEX Arbitrage', desc: 'Real-time spread detection across 20+ centralized exchanges with fee calculation and depth analysis', gradient: 'from-blue-500/20 to-blue-500/0' },
  { icon: <Link2 size={22} />, title: 'DEX Scanner', desc: 'Cross-chain DEX opportunities with flash loan detection and new pool monitoring across EVM + Solana', gradient: 'from-purple-500/20 to-purple-500/0' },
  { icon: <BarChart3 size={22} />, title: 'Funding Rates', desc: 'Perpetual futures funding rate arbitrage with annualized APY tracking, alerts and position sizing', gradient: 'from-cyan-500/20 to-cyan-500/0' },
  { icon: <Wallet size={22} />, title: 'Wallet Analytics', desc: 'Multi-chain wallet analysis with PNL tracking, win rate statistics, and smart money profiling', gradient: 'from-green-500/20 to-green-500/0' },
  { icon: <Bot size={22} />, title: 'AI Assistant', desc: 'GPT-4o powered analysis — ask about spreads, markets, strategies and get instant insights', gradient: 'from-amber-500/20 to-amber-500/0' },
  { icon: <Radio size={22} />, title: 'Real-time Feeds', desc: 'WebSocket-powered live updates with sub-second latency, smart dedup and Telegram alerts', gradient: 'from-rose-500/20 to-rose-500/0' },
];

const ROADMAP = [
  { phase: 'Phase 1', title: 'Foundation', items: ['Core arbitrage engine', 'CEX integration (20+)', 'Real-time spreads', 'Dashboard MVP'], status: 'done' as const },
  { phase: 'Phase 2', title: 'Expansion', items: ['DEX scanner', 'Multi-chain support', 'Wallet analytics', 'Funding rates'], status: 'done' as const },
  { phase: 'Phase 3', title: 'Intelligence', items: ['AI assistant (GPT-4o)', 'Statistical arbitrage', 'Futures basis arb', 'Pairs trading'], status: 'active' as const },
  { phase: 'Phase 4', title: 'Scale', items: ['Mobile app', 'API access', 'White-label', 'Enterprise tier'], status: 'upcoming' as const },
];

type PricingPlan = { name: string; price: string; period: string; badge: string; color: string; ring: string; popular?: boolean; features: string[] };
const PLANS: PricingPlan[] = [
  { name: 'Free', price: '$0', period: 'forever', badge: '🆓', color: 'border-white/[0.06]', ring: '', features: ['CEX Spreads', '5 alerts/day', '50 row export'] },
  { name: 'Pro', price: '$39', period: '/mo', badge: '⚡', color: 'border-blue-500/30', ring: 'ring-1 ring-blue-500/20', popular: true, features: ['All strategy tabs', '100 alerts/day', 'Full CSV export', 'Telegram alerts'] },
  { name: 'Elite', price: '$89', period: '/mo', badge: '🔥', color: 'border-purple-500/30', ring: '', features: ['P2P + Multi-hop', 'Unlimited alerts', 'Priority support', 'Advanced analytics'] },
  { name: 'Ultimate', price: '$199', period: '/mo', badge: '👑', color: 'border-amber-500/30', ring: '', features: ['Personal manager', 'Custom strategies', 'White-label', 'API access'] },
];

const TESTIMONIALS = [
  { name: 'Alex M.', role: 'Crypto Trader', text: 'Right Order pays for itself within the first day. The real-time spread detection is unmatched.', avatar: 'AM' },
  { name: 'Sarah K.', role: 'Quant Analyst', text: 'The statistical arbitrage module is exactly what I needed. Clean interface, fast data.', avatar: 'SK' },
  { name: 'David R.', role: 'Fund Manager', text: 'We switched from 3 different tools to Right Order. The all-in-one approach saves us hours daily.', avatar: 'DR' },
];

// ═══════════ Landing ═══════════
export function Landing() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (!token || user) return;
    void apiValidateToken();
  }, [token, user]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const json = await res.json();
        const s = json.stats ?? json;
        if (!cancelled && s && typeof s === 'object') {
          setStats({
            exchanges: typeof s.connectedExchanges === 'number' ? s.connectedExchanges : (typeof s.activeExchangesCount === 'number' ? s.activeExchangesCount : 0),
            symbols: typeof s.activeSymbols === 'number' ? s.activeSymbols : 0,
            spreads: typeof s.uniqueSpreads === 'number' ? s.uniqueSpreads : (typeof s.opportunitiesCount === 'number' ? s.opportunitiesCount : 0),
            bestNet: typeof s.bestNetPercent === 'number' ? s.bestNetPercent : 0,
          });
        }
      } catch { /* silent */ }
    };
    void load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const statItems = [
    { label: 'Exchanges', value: stats?.exchanges ?? 0, suffix: '+' },
    { label: 'Active Symbols', value: stats?.symbols ?? 0, suffix: '' },
    { label: 'Spreads Found', value: stats?.spreads ?? 0, suffix: '' },
    { label: 'Best Net Profit', value: stats ? Number(stats.bestNet.toFixed(1)) : 0, suffix: '%', isPercent: true },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ════════ NAVBAR ════════ */}
      <motion.nav
        className="glass fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04]"
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-3.5 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
            Right Order
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/pricing')} className="hidden md:block px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </button>
            {user ? (
              <button onClick={() => navigate('/profile')} className="hidden md:block px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                {user.email}
              </button>
            ) : (
              <button onClick={() => navigate('/login')} className="hidden md:block px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                Login
              </button>
            )}
            <motion.button
              onClick={() => navigate('/dashboard')}
              className="btn-primary px-5 py-2 text-sm font-semibold rounded-lg text-white hidden sm:flex"
              whileTap={{ scale: 0.97 }}
            >
              Open Dashboard
            </motion.button>
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNav(!mobileNav)}
              className="md:hidden p-2 rounded-lg btn-ghost text-muted-foreground"
            >
              {mobileNav ? <span className="text-sm">✕</span> : <span className="text-sm">☰</span>}
            </button>
          </div>
        </div>
        {/* Mobile nav dropdown */}
        <AnimatePresence>
          {mobileNav && (
            <motion.div
              className="md:hidden border-t border-white/[0.04] px-6 py-3 space-y-1"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <button onClick={() => { navigate('/pricing'); setMobileNav(false); }} className="block w-full text-left py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</button>
              {user ? (
                <>
                  <button onClick={() => { navigate('/profile'); setMobileNav(false); }} className="block w-full text-left py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Profile</button>
                  <button
                    onClick={() => {
                      void apiLogout().then(() => {
                        setMobileNav(false);
                        navigate('/login');
                      });
                    }}
                    className="block w-full text-left py-2 text-sm text-red-400/80 hover:text-red-400 transition-colors"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <button onClick={() => { navigate('/login'); setMobileNav(false); }} className="block w-full text-left py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Login</button>
              )}
              <button onClick={() => { navigate('/dashboard'); setMobileNav(false); }} className="block w-full text-left py-2 text-sm text-primary font-medium">Open Dashboard</button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* ════════ HERO ════════ */}
      <section className="relative min-h-screen flex items-center justify-center pt-16">
        {/* BG effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 35%, rgba(59,130,246,0.07) 0%, transparent 70%)' }} />
          <motion.div className="absolute top-[10%] left-[5%] w-[600px] h-[600px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%)' }}
            animate={{ x: [0, 50, 0], y: [0, -40, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.div className="absolute bottom-[5%] right-[0%] w-[500px] h-[500px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%)' }}
            animate={{ x: [0, -40, 0], y: [0, 50, 0] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
          <div className="absolute inset-0 opacity-[0.025]"
            style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)', backgroundSize: '72px 72px' }} />
        </div>

        <div className="relative z-10 text-center px-6 max-w-5xl mx-auto">
          <motion.div
            className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full border border-primary/20 bg-primary/[0.06] text-xs font-medium text-primary/90"
            initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live — {stats ? `${stats.exchanges} Exchanges Connected` : 'Connecting...'}
          </motion.div>

          <motion.h1
            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black mb-6 tracking-tighter leading-[0.95]"
            style={{ fontFamily: 'var(--font-heading)' }}
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
          >
            <span className="gradient-text">Professional Crypto</span>
            <br />
            <span className="text-foreground">Arbitrage Scanner</span>
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
          >
            Detect cross-exchange spreads in real time. CEX, DEX, funding rates,
            statistical arbitrage — all in <span className="text-foreground font-medium">one dashboard</span>.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.4 }}
          >
            <motion.button
              onClick={() => navigate('/dashboard')}
              className="btn-primary px-8 py-3.5 rounded-xl font-semibold text-white text-base flex items-center gap-2"
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            >
              Try Demo <ArrowRight size={16} />
            </motion.button>
            <motion.button
              onClick={() => navigate('/pricing')}
              className="btn-ghost px-8 py-3.5 rounded-xl font-semibold text-muted-foreground text-base"
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            >
              View Pricing
            </motion.button>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            className="flex items-center justify-center gap-6 mt-12 text-xs text-muted-foreground/60"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          >
            <span className="flex items-center gap-1.5"><Shield size={13} /> Secure</span>
            <span className="flex items-center gap-1.5"><Clock size={13} /> Real-time</span>
            <span className="flex items-center gap-1.5"><Globe size={13} /> 20+ Exchanges</span>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div className="absolute bottom-6 left-1/2 -translate-x-1/2" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ delay: 1.5 }}>
          <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <ChevronDown size={20} className="text-muted-foreground/40" />
          </motion.div>
        </motion.div>
      </section>

      {/* ════════ LIVE STATS ════════ */}
      <section className="py-20 md:py-28 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.015] to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto relative">
          <Reveal>
            <p className="text-center text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">Live Platform Data</p>
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-14" style={{ fontFamily: 'var(--font-heading)' }}>
              Powered by Real Numbers
            </h2>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {statItems.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.08}>
                <div className="glass-card rounded-2xl p-6 text-center group relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative">
                    <div className="text-3xl md:text-4xl font-bold text-foreground mb-1.5 tabular-nums" style={{ fontFamily: 'var(--font-heading)' }}>
                      {stats ? <Counter to={s.value} /> : '—'}{stats ? s.suffix : ''}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium tracking-wide uppercase">{s.label}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="divider-gradient max-w-5xl mx-auto" />

      {/* ════════ FEATURES ════════ */}
      <section id="features" className="py-20 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <p className="text-center text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">Capabilities</p>
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-4" style={{ fontFamily: 'var(--font-heading)' }}>
              Everything You Need
            </h2>
            <p className="text-muted-foreground text-center mb-14 max-w-xl mx-auto text-sm">
              Professional-grade arbitrage detection across centralized and decentralized exchanges
            </p>
          </Reveal>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.06}>
                <div className="glass-card rounded-2xl p-6 h-full group relative overflow-hidden">
                  <div className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                      {f.icon}
                    </div>
                    <h3 className="text-base font-semibold mb-2 group-hover:text-primary transition-colors duration-300">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="divider-gradient max-w-5xl mx-auto" />

      {/* ════════ ROADMAP ════════ */}
      <section className="py-20 md:py-28 px-6 relative">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <p className="text-center text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">Development</p>
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-14" style={{ fontFamily: 'var(--font-heading)' }}>Roadmap</h2>
          </Reveal>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {ROADMAP.map((r, i) => (
              <Reveal key={r.phase} delay={i * 0.1}>
                <div className={`glass-card rounded-2xl p-5 h-full relative overflow-hidden ${
                  r.status === 'done' ? 'border-green-500/20' : r.status === 'active' ? 'border-primary/30 animate-pulse-glow' : ''
                }`}>
                  <div className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold mb-3 ${
                    r.status === 'done' ? 'bg-green-500/10 text-green-400' :
                    r.status === 'active' ? 'bg-primary/10 text-primary' :
                    'bg-white/[0.04] text-muted-foreground'
                  }`}>
                    {r.status === 'done' ? '✓ Done' : r.status === 'active' ? '● Active' : 'Upcoming'}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">{r.phase}</div>
                  <h3 className="text-sm font-bold mb-3">{r.title}</h3>
                  <ul className="space-y-1.5">
                    {r.items.map(item => (
                      <li key={item} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CheckCircle2 size={10} className={r.status === 'done' ? 'text-green-500' : r.status === 'active' ? 'text-primary/60' : 'text-muted-foreground/30'} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="divider-gradient max-w-5xl mx-auto" />

      {/* ════════ PRICING TEASER ════════ */}
      <section className="py-20 md:py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <p className="text-center text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">Plans</p>
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-4" style={{ fontFamily: 'var(--font-heading)' }}>
              Simple, Transparent Pricing
            </h2>
            <p className="text-muted-foreground text-center mb-14 max-w-md mx-auto text-sm">
              Start free. Upgrade when you need more power.
            </p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p, i) => (
              <Reveal key={p.name} delay={i * 0.08}>
                <motion.div
                  className={`relative glass-card rounded-2xl p-5 h-full overflow-hidden ${p.color} ${p.ring}`}
                  onHoverStart={() => setHoveredPlan(p.name)}
                  onHoverEnd={() => setHoveredPlan(null)}
                  animate={hoveredPlan === p.name ? { y: -4 } : { y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                >
                  {p.popular && (
                    <div className="absolute -top-px left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
                  )}
                  <AnimatePresence>
                    {p.popular && (
                      <motion.div
                        className="absolute top-3 right-3 px-2 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/20"
                        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                      >
                        POPULAR
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="text-xl mb-1">{p.badge}</div>
                  <div className="text-sm font-bold mb-1">{p.name}</div>
                  <div className="flex items-baseline gap-0.5 mb-4">
                    <span className="text-2xl font-black" style={{ fontFamily: 'var(--font-heading)' }}>{p.price}</span>
                    <span className="text-[10px] text-muted-foreground">{p.period}</span>
                  </div>
                  <ul className="space-y-1.5 mb-4">
                    {p.features.map(f => (
                      <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CheckCircle2 size={11} className="text-green-500/70 flex-shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.3}>
            <div className="text-center mt-10">
              <motion.button
                onClick={() => navigate('/pricing')}
                className="btn-ghost px-7 py-3 rounded-xl font-semibold text-sm text-primary"
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              >
                Compare All Plans <ArrowRight size={14} className="inline ml-1" />
              </motion.button>
            </div>
          </Reveal>
        </div>
      </section>

      <div className="divider-gradient max-w-5xl mx-auto" />

      {/* ════════ TESTIMONIALS ════════ */}
      <section className="py-20 md:py-28 px-6">
        <div className="max-w-4xl mx-auto">
          <Reveal>
            <p className="text-center text-xs font-semibold tracking-widest uppercase text-primary/70 mb-3">Testimonials</p>
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-14" style={{ fontFamily: 'var(--font-heading)' }}>
              Trusted by Traders
            </h2>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.1}>
                <div className="glass-card rounded-2xl p-5 h-full">
                  <div className="flex items-center gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <Star key={si} size={12} className="text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {t.avatar}
                    </div>
                    <div>
                      <div className="text-xs font-semibold">{t.name}</div>
                      <div className="text-[10px] text-muted-foreground">{t.role}</div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="divider-gradient max-w-5xl mx-auto" />

      {/* ════════ CTA ════════ */}
      <section className="py-28 md:py-36 px-6 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
        </div>
        <div className="max-w-3xl mx-auto text-center relative">
          <Reveal>
            <h2 className="text-3xl md:text-5xl font-bold mb-5" style={{ fontFamily: 'var(--font-heading)' }}>
              Start Finding Spreads <span className="gradient-text-blue">Today</span>
            </h2>
            <p className="text-muted-foreground mb-10 text-base max-w-md mx-auto">
              Join traders using Right Order to discover arbitrage opportunities across 20+ exchanges in real time.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <motion.button
                onClick={() => navigate('/dashboard')}
                className="btn-primary px-10 py-4 rounded-xl font-semibold text-white text-base flex items-center gap-2"
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              >
                Try Demo — Free <ArrowRight size={16} />
              </motion.button>
              <motion.button
                onClick={() => navigate('/pricing')}
                className="btn-ghost px-10 py-4 rounded-xl font-semibold text-muted-foreground text-base"
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              >
                View Pricing
              </motion.button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ FOOTER ════════ */}
      <footer className="border-t border-white/[0.04] py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-base font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Right Order</div>
          <div className="flex items-center gap-8 text-xs text-muted-foreground">
            <button onClick={() => navigate('/pricing')} className="hover:text-foreground transition-colors">Pricing</button>
            <button onClick={() => navigate('/login')} className="hover:text-foreground transition-colors">Login</button>
            <button onClick={() => navigate('/dashboard')} className="hover:text-foreground transition-colors">Dashboard</button>
          </div>
          <div className="text-xs text-muted-foreground/50">&copy; 2026 Right Order. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
