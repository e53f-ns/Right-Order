export interface Spread {
  id: string;
  type: 'simple' | 'triangular' | 'funding_arb' | 'stat_arb' | 'pairs_trading';
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  depthUsd: number;
  confidence: number;
  timestamp: number;
  ageSeconds: number;
  executable?: boolean;
  pathDescription?: string;
  withdrawChains?: string[];
  depositChains?: string[];
  intersectionChains?: string[];
  minDepositUsd?: number;
  maxDepositUsd?: number;
  network?: string;
  buyPrice?: number;
  sellPrice?: number;
}

export interface SpreadFilters {
  type: 'all' | 'simple' | 'triangular' | 'funding_arb' | 'stat_arb' | 'pairs_trading';
  symbol: string;
  exchange: string;
  minGross: number;
  minNet: number;
  minProfit: number;
  minDepth: number;
  minConf: number;
  positiveOnly: boolean;
  executableOnly: boolean;
  nearProfitable: boolean;
}

export interface DashboardStats {
  connectedExchanges: number;
  totalExchanges: number;
  activeSymbols: number;
  uniqueSpreads: number;
  bestNetPercent: number;
  totalCalculations: number;
  uptime: number;
}

export const defaultFilters: SpreadFilters = {
  type: 'all',
  symbol: '',
  exchange: '',
  minGross: -0.5,
  minNet: -0.5,
  minProfit: -999,
  minDepth: 0,
  minConf: 0,
  positiveOnly: false,
  executableOnly: false,
  nearProfitable: true,
};
