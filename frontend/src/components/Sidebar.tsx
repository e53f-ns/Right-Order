import { motion } from 'framer-motion';
import { 
  TrendingUp, 
  Repeat, 
  Wallet, 
  DollarSign, 
  MessageSquare, 
  Image, 
  Bot,
  ChevronLeft,
  ChevronRight,
  Activity,
  GitBranch,
  Banknote,
  LineChart
} from 'lucide-react';

export type TabId = 'spreads' | 'dex' | 'wallets' | 'funding' | 'funding_arb' | 'futures_arb' | 'stat_arb' | 'pairs_trading' | 'messages' | 'nfts' | 'ai';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: 'spreads', label: 'CEX Spreads', icon: <TrendingUp className="w-5 h-5" /> },
  { id: 'dex', label: 'DEX', icon: <Repeat className="w-5 h-5" /> },
  { id: 'funding', label: 'Funding', icon: <DollarSign className="w-5 h-5" /> },
  { id: 'funding_arb', label: 'Funding Arb', icon: <Banknote className="w-5 h-5" /> },
  { id: 'futures_arb', label: 'Futures Arb', icon: <LineChart className="w-5 h-5" /> },
  { id: 'stat_arb', label: 'Stat Arb', icon: <Activity className="w-5 h-5" /> },
  { id: 'pairs_trading', label: 'Pairs Trading', icon: <GitBranch className="w-5 h-5" /> },
  { id: 'wallets', label: 'Wallets', icon: <Wallet className="w-5 h-5" /> },
  { id: 'messages', label: 'Messages', icon: <MessageSquare className="w-5 h-5" /> },
  { id: 'nfts', label: 'NFTs', icon: <Image className="w-5 h-5" /> },
  { id: 'ai', label: 'AI Assistant', icon: <Bot className="w-5 h-5" /> },
];

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ activeTab, onTabChange, collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <motion.aside
      className="bg-card border-r border-border flex flex-col h-full"
      initial={false}
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      {/* Logo */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        {!collapsed && (
          <motion.span 
            className="font-bold text-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            Right Order
          </motion.span>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              title={collapsed ? tab.label : undefined}
            >
              <span className={`flex-shrink-0 ${isActive ? 'text-primary-foreground' : ''}`}>
                {tab.icon}
              </span>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="truncate"
                >
                  {tab.label}
                </motion.span>
              )}
              {isActive && !collapsed && (
                <motion.div
                  layoutId="activeIndicator"
                  className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-foreground"
                />
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <motion.div 
          className="p-4 border-t border-border text-xs text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Professional Scanner
        </motion.div>
      )}
    </motion.aside>
  );
}
