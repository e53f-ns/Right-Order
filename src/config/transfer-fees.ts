/**
 * Transfer Network Fees Configuration
 * Hardcoded chain fees for cross-exchange transfers
 * These are approximate average fees - actual fees vary by network congestion
 */

/**
 * Supported transfer networks
 */
export type TransferNetwork = 
  | 'ETH'      // Ethereum mainnet (ERC-20)
  | 'BSC'      // BNB Smart Chain (BEP-20)
  | 'SOL'      // Solana (SPL)
  | 'MATIC'    // Polygon
  | 'ARB'      // Arbitrum One
  | 'OP'       // Optimism
  | 'AVAX'     // Avalanche C-Chain
  | 'TRX'      // Tron (TRC-20)
  | 'BASE'     // Base
  | 'TON'      // TON Network
  | 'INTERNAL'; // Same exchange (no transfer needed)

/**
 * Network fee configuration
 */
export interface NetworkFeeConfig {
  network: TransferNetwork;
  name: string;
  avgFeeUsd: number;        // Average fee in USD
  feePercent: number;       // Fee as percentage (for % based calculation)
  avgTimeMinutes: number;   // Average transfer time
  confirmations: number;    // Required confirmations
}

/**
 * Network fees - ordered by cost (cheapest first)
 */
export const NETWORK_FEES: Record<TransferNetwork, NetworkFeeConfig> = {
  INTERNAL: {
    network: 'INTERNAL',
    name: 'Internal Transfer',
    avgFeeUsd: 0,
    feePercent: 0,
    avgTimeMinutes: 0,
    confirmations: 0,
  },
  SOL: {
    network: 'SOL',
    name: 'Solana',
    avgFeeUsd: 0.01,
    feePercent: 0.001, // 0.001%
    avgTimeMinutes: 0.5,
    confirmations: 1,
  },
  TRX: {
    network: 'TRX',
    name: 'Tron (TRC-20)',
    avgFeeUsd: 1.0,
    feePercent: 0.01, // 0.01%
    avgTimeMinutes: 1,
    confirmations: 19,
  },
  TON: {
    network: 'TON',
    name: 'TON Network',
    avgFeeUsd: 0.05,
    feePercent: 0.005,
    avgTimeMinutes: 0.5,
    confirmations: 1,
  },
  BSC: {
    network: 'BSC',
    name: 'BNB Smart Chain (BEP-20)',
    avgFeeUsd: 0.10,
    feePercent: 0.01, // 0.01%
    avgTimeMinutes: 1,
    confirmations: 15,
  },
  MATIC: {
    network: 'MATIC',
    name: 'Polygon',
    avgFeeUsd: 0.05,
    feePercent: 0.005,
    avgTimeMinutes: 2,
    confirmations: 128,
  },
  ARB: {
    network: 'ARB',
    name: 'Arbitrum One',
    avgFeeUsd: 0.25,
    feePercent: 0.025,
    avgTimeMinutes: 2,
    confirmations: 12,
  },
  OP: {
    network: 'OP',
    name: 'Optimism',
    avgFeeUsd: 0.25,
    feePercent: 0.025,
    avgTimeMinutes: 2,
    confirmations: 12,
  },
  BASE: {
    network: 'BASE',
    name: 'Base',
    avgFeeUsd: 0.20,
    feePercent: 0.02,
    avgTimeMinutes: 2,
    confirmations: 12,
  },
  AVAX: {
    network: 'AVAX',
    name: 'Avalanche C-Chain',
    avgFeeUsd: 0.30,
    feePercent: 0.03,
    avgTimeMinutes: 1,
    confirmations: 1,
  },
  ETH: {
    network: 'ETH',
    name: 'Ethereum (ERC-20)',
    avgFeeUsd: 5.0,        // Can be $2-$20+ depending on gas
    feePercent: 0.5,       // 0.5% as fallback
    avgTimeMinutes: 5,
    confirmations: 12,
  },
};

/**
 * Token to supported networks mapping
 * Key: token symbol (uppercase), Value: array of networks (ordered by preference)
 */
export const TOKEN_NETWORKS: Record<string, TransferNetwork[]> = {
  // Major tokens - multi-chain
  BTC: ['INTERNAL'], // Bitcoin only transfers as native BTC
  ETH: ['ARB', 'OP', 'BASE', 'MATIC', 'ETH'],
  USDT: ['TRX', 'SOL', 'BSC', 'MATIC', 'ARB', 'OP', 'AVAX', 'ETH'],
  USDC: ['SOL', 'ARB', 'OP', 'BASE', 'MATIC', 'AVAX', 'ETH'],
  BNB: ['BSC', 'ETH'],
  SOL: ['SOL'],
  XRP: ['INTERNAL'], // XRP Ledger only
  DOGE: ['INTERNAL'], // Dogecoin only
  ADA: ['INTERNAL'],  // Cardano only
  AVAX: ['AVAX', 'ETH'],
  TRX: ['TRX'],
  TON: ['TON'],
  MATIC: ['MATIC', 'ETH'],
  
  // DeFi tokens - mostly EVM
  LINK: ['ARB', 'OP', 'MATIC', 'ETH'],
  UNI: ['ARB', 'OP', 'MATIC', 'ETH'],
  AAVE: ['ARB', 'OP', 'MATIC', 'ETH'],
  MKR: ['ETH'],
  LDO: ['ARB', 'OP', 'ETH'],
  CRV: ['ARB', 'MATIC', 'ETH'],
  COMP: ['ETH'],
  SNX: ['OP', 'ETH'],
  SUSHI: ['ARB', 'MATIC', 'ETH'],
  '1INCH': ['ARB', 'OP', 'MATIC', 'BSC', 'ETH'],
  GMX: ['ARB', 'AVAX'],
  ARB: ['ARB'],
  OP: ['OP'],
  
  // Layer 1s
  NEAR: ['INTERNAL'],
  APT: ['INTERNAL'],
  SUI: ['INTERNAL'],
  SEI: ['INTERNAL'],
  FTM: ['INTERNAL', 'ETH'],
  ATOM: ['INTERNAL'],
  DOT: ['INTERNAL'],
  
  // Memecoins
  SHIB: ['ARB', 'BSC', 'ETH'],
  PEPE: ['ARB', 'BSC', 'ETH'],
  FLOKI: ['BSC', 'ETH'],
  BONK: ['SOL'],
  WIF: ['SOL'],
  DEGEN: ['BASE'],
  
  // Solana ecosystem
  RAY: ['SOL'],
  ORCA: ['SOL'],
  JTO: ['SOL'],
  PYTH: ['SOL'],
  JUP: ['SOL'],
  
  // Default for unknown tokens
  DEFAULT: ['ARB', 'BSC', 'MATIC', 'ETH'],
};

/**
 * Get best transfer network for a token
 * Returns the cheapest available network
 */
export function getBestNetwork(tokenSymbol: string): TransferNetwork {
  const symbol = tokenSymbol.toUpperCase().replace('/USDT', '').replace('/BTC', '').replace('/ETH', '');
  const networks = TOKEN_NETWORKS[symbol] ?? TOKEN_NETWORKS['DEFAULT'];
  const first = networks?.[0];
  return first ?? 'ETH';
}

/**
 * Get transfer fee for a token
 * Returns both fixed USD fee and percentage
 */
export function getTransferFee(tokenSymbol: string): { 
  network: TransferNetwork; 
  feeUsd: number; 
  feePercent: number;
  timeMinutes: number;
} {
  const network = getBestNetwork(tokenSymbol);
  const config = NETWORK_FEES[network];
  
  return {
    network,
    feeUsd: config.avgFeeUsd,
    feePercent: config.feePercent,
    timeMinutes: config.avgTimeMinutes,
  };
}

/**
 * Calculate total transfer cost for a trade
 * @param tokenSymbol Token being transferred
 * @param amountUsd Trade size in USD
 * @returns Transfer cost in USD
 */
export function calculateTransferCost(tokenSymbol: string, amountUsd: number): {
  network: TransferNetwork;
  costUsd: number;
  costPercent: number;
  timeMinutes: number;
} {
  const { network, feeUsd, feePercent, timeMinutes } = getTransferFee(tokenSymbol);
  
  // Use the higher of fixed fee or percentage
  const percentCost = amountUsd * (feePercent / 100);
  const costUsd = Math.max(feeUsd, percentCost);
  const costPercent = (costUsd / amountUsd) * 100;
  
  return {
    network,
    costUsd,
    costPercent,
    timeMinutes,
  };
}

/**
 * Check if arbitrage is profitable after transfer fees
 */
export function isProfitableAfterTransfer(
  tokenSymbol: string,
  netProfitUsd: number,
  tradeSizeUsd: number
): { profitable: boolean; netAfterTransfer: number; transferCost: number; network: TransferNetwork } {
  const { network, costUsd } = calculateTransferCost(tokenSymbol, tradeSizeUsd);
  const netAfterTransfer = netProfitUsd - costUsd;
  
  return {
    profitable: netAfterTransfer > 0,
    netAfterTransfer,
    transferCost: costUsd,
    network,
  };
}
