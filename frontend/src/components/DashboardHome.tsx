import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/store/useAuth';
import {
  TrendingUp, Bell, Wallet, CreditCard,
  ArrowUpRight, BarChart3, Zap, Clock, Activity, Users,
} from 'lucide-react';
import type { DashboardStats } from '@/types/spread';

interface DashboardHomeProps {
  stats: DashboardStats | null;
  spreadsCount: number;
  isConnected: boolean;
  onNavigateTab: (tab: string) => void;
}

const PLAN_BADGE_CLASS: Record<string, string> = {
  free: 'badge badge-gray', pro: 'badge badge-blue', elite: 'badge badge-purple', ultimate: 'badge badge-amber',
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

export function DashboardHome({ stats, spreadsCount, isConnected, onNavigateTab }: DashboardHomeProps) {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const plan = user?.subscription ?? 'free';
  const deposit = user?.preferences?.depositSize ?? 1000;

  const [pnl] = useState(() => {
    const base = (stats?.bestNetPercent ?? 0.5) * deposit / 100;
    return { daily: base, weekly: base * 5.2, monthly: base * 18 };
  });

  const summaryCards = [
    { icon: <TrendingUp size={16} />, label: 'Est. Daily PNL', value: `$${pnl.daily.toFixed(2)}`, sub: `${((pnl.daily / deposit) * 100).toFixed(2)}% of deposit`, cls: 'text-green-400', iconCls: 'bg-green-500/10 text-green-400' },
    { icon: <Bell size={16} />, label: 'Active Alerts', value: plan === 'free' ? '5/day' : plan === 'pro' ? '100/day' : 'Unlimited', sub: 'Telegram + Dashboard', cls: 'text-primary', iconCls: 'bg-primary/10 text-primary' },
    { icon: <Wallet size={16} />, label: 'Deposit Size', value: `$${deposit.toLocaleString()}`, sub: 'Configurable in Profile', cls: 'text-purple-400', iconCls: 'bg-purple-500/10 text-purple-400' },
    { icon: <CreditCard size={16} />, label: 'Subscription', value: plan.charAt(0).toUpperCase() + plan.slice(1), sub: user?.subscriptionExpiresAt ? `Expires ${new Date(user.subscriptionExpiresAt).toLocaleDateString()}` : plan === 'free' ? 'Upgrade for more' : 'Active', cls: 'text-foreground', iconCls: 'bg-white/[0.04] text-muted-foreground' },
  ];

  const quickLinks = [
    { icon: <BarChart3 size={14} />, label: 'CEX Spreads', tab: 'spreads', desc: `${spreadsCount} active` },
    { icon: <Zap size={14} />, label: 'Funding Arb', tab: 'funding_arb', desc: 'Rate opportunities' },
    { icon: <Activity size={14} />, label: 'Stat Arb', tab: 'stat_arb', desc: 'Statistical signals' },
    { icon: <Users size={14} />, label: 'P2P Arb', tab: 'p2p', desc: 'Cross-platform' },
  ];

  const topSpreads = [
    { pair: 'BTC/USDT', buy: 'Binance', sell: 'OKX', net: stats?.bestNetPercent ?? 0.42 },
    { pair: 'ETH/USDT', buy: 'Bybit', sell: 'KuCoin', net: (stats?.bestNetPercent ?? 0.3) * 0.7 },
    { pair: 'SOL/USDT', buy: 'Gate.io', sell: 'MEXC', net: (stats?.bestNetPercent ?? 0.2) * 0.5 },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* Welcome */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
            Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your arbitrage dashboard overview
          </p>
        </div>
        <button
          onClick={() => navigate('/pricing')}
          className={`${PLAN_BADGE_CLASS[plan]} text-[11px] px-3 py-1.5 rounded-lg cursor-pointer self-start sm:self-auto`}
        >
          {plan === 'free' ? 'Upgrade Plan' : `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`}
        </button>
      </motion.div>

      {/* Summary Cards — responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryCards.map((card) => (
          <motion.div
            key={card.label}
            variants={itemVariants}
            className="glass-card rounded-xl p-4 flex flex-col gap-2.5"
            whileHover={{ y: -2, transition: { duration: 0.15 } }}
          >
            <div className="flex items-center justify-between">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.iconCls}`}>
                {card.icon}
              </div>
              <span className="text-[10px] text-muted-foreground font-medium">{card.label}</span>
            </div>
            <div>
              <div className={`text-xl font-bold tracking-tight ${card.cls}`} style={{ fontFamily: 'var(--font-heading)' }}>
                {card.value}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Two columns: Quick Links + Top Spreads — stacks on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Quick Links */}
        <motion.div variants={itemVariants} className="glass-card rounded-xl p-4">
          <div className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <Zap size={13} className="text-primary" /> Quick Access
          </div>
          <div className="space-y-1">
            {quickLinks.map((link) => (
              <button
                key={link.tab}
                onClick={() => onNavigateTab(link.tab)}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-lg glass-subtle text-left group"
              >
                <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  {link.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">{link.label}</div>
                  <div className="text-[10px] text-muted-foreground">{link.desc}</div>
                </div>
                <ArrowUpRight size={12} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </button>
            ))}
          </div>
        </motion.div>

        {/* Top Spreads */}
        <motion.div variants={itemVariants} className="glass-card rounded-xl p-4">
          <div className="text-xs font-semibold mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <TrendingUp size={13} className="text-green-400" /> Top Spreads
            </span>
            <button
              onClick={() => onNavigateTab('spreads')}
              className="text-[10px] text-primary hover:text-primary/80 transition-colors"
            >
              View All →
            </button>
          </div>
          <div className="space-y-1">
            {topSpreads.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02]">
                <div>
                  <div className="text-xs font-semibold">{s.pair}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Buy {s.buy} → Sell {s.sell}
                  </div>
                </div>
                <span className={`text-xs font-bold ${s.net > 0 ? 'text-green-400' : 'text-red-400'}`} style={{ fontFamily: 'var(--font-heading)' }}>
                  {s.net > 0 ? '+' : ''}{s.net.toFixed(3)}%
                </span>
              </div>
            ))}
          </div>

          {/* Mini chart placeholder */}
          <div className="mt-3 h-16 rounded-lg bg-white/[0.015] border border-dashed border-white/[0.06] flex items-center justify-center">
            <div className="text-center">
              <Clock size={14} className="text-muted-foreground/40 mx-auto mb-1" />
              <div className="text-[9px] text-muted-foreground/40">Performance chart coming soon</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Subscription + Activity Row */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
            <CreditCard size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground">Plan</div>
            <div className="text-xs font-bold">{plan.charAt(0).toUpperCase() + plan.slice(1)}</div>
          </div>
          {plan === 'free' && (
            <button onClick={() => navigate('/pricing')} className="text-[9px] text-primary font-semibold">Upgrade</button>
          )}
        </div>
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground">Est. Weekly</div>
            <div className="text-xs font-bold text-green-400">${pnl.weekly.toFixed(2)}</div>
          </div>
        </div>
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Activity size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground">Session</div>
            <div className="text-xs font-bold">{isConnected ? 'Live' : 'Offline'}</div>
          </div>
        </div>
      </motion.div>

      {/* Connection status bar */}
      <motion.div
        variants={itemVariants}
        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-xl text-xs ${
          isConnected ? 'bg-green-500/[0.04] border border-green-500/10' : 'bg-red-500/[0.04] border border-red-500/10'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
          <span className={`font-medium ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'WebSocket Connected' : 'Disconnected'}
          </span>
        </div>
        {stats && (
          <div className="flex items-center gap-3 text-muted-foreground text-[11px]">
            <span>Exchanges: {stats.connectedExchanges}/{stats.totalExchanges}</span>
            <span className="hide-mobile">Symbols: {stats.activeSymbols}</span>
            <span>Spreads: {stats.uniqueSpreads}</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
