/**
 * DEX Scanner Types
 * Types for DEX pools, chains, and arbitrage opportunities
 */

import type { TradingSymbol, TimestampMs, Percentage, UsdValue } from '../types/branded.js';

/**
 * Supported blockchain networks
 */
export type ChainId = 
  | 'ethereum'
  | 'bsc'
  | 'polygon'
  | 'arbitrum'
  | 'optimism'
  | 'avalanche'
  | 'base'
  | 'solana';

/**
 * Chain configuration
 */
export interface ChainConfig {
  id: ChainId;
  name: string;
  chainIdHex: string;
  rpcUrl: string;
  nativeCurrency: string;
  blockExplorer: string;
  avgBlockTimeMs: number;
  gasTokenPriceUsd: number; // Updated periodically
}

/**
 * Supported DEX protocols
 */
export type DexProtocol =
  | 'uniswap_v3'
  | 'uniswap_v2'
  | 'sushiswap'
  | 'pancakeswap'
  | 'quickswap'
  | 'traderjoe'
  | 'camelot'
  | 'aerodrome'
  | 'velodrome'
  | 'raydium'
  | 'orca';

/**
 * DEX configuration
 */
export interface DexConfig {
  protocol: DexProtocol;
  name: string;
  chain: ChainId;
  factoryAddress?: string;
  routerAddress?: string;
  subgraphUrl?: string;
  feePercent: number; // e.g., 0.3 for 0.3%
  isActive: boolean;
}

/**
 * Token info
 */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
  logoUri?: string;
}

/**
 * DEX pool/pair info
 */
export interface DexPool {
  id: string;
  dex: DexProtocol;
  chain: ChainId;
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  reserveUsd: number;
  reserve0: string;
  reserve1: string;
  fee: number; // Pool fee tier (e.g., 0.3%)
  lastUpdated: TimestampMs;
}

/**
 * DEX price quote
 */
export interface DexQuote {
  dex: DexProtocol;
  chain: ChainId;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  gasEstimate: number; // in native token units (wei/lamports)
  gasEstimateUsd: number;
  route: string[];
  timestamp: TimestampMs;
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  chain: ChainId;
  gasPrice: string; // in wei/gwei
  gasPriceGwei: number;
  estimatedGas: number;
  totalCostWei: string;
  totalCostUsd: number;
  timestamp: TimestampMs;
}

/**
 * CEX-DEX arbitrage opportunity
 */
export interface CexDexOpportunity {
  id: string;
  type: 'cex_dex';
  direction: 'cex_to_dex' | 'dex_to_cex';
  symbol: string;
  
  // CEX side
  cexExchange: string;
  cexPrice: number;
  cexSide: 'buy' | 'sell';
  
  // DEX side
  dex: DexProtocol;
  chain: ChainId;
  poolAddress: string;
  dexPrice: number;
  dexSide: 'buy' | 'sell';
  
  // Profit calculation
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  
  // Costs
  cexFeePercent: number;
  dexFeePercent: number;
  gasEstimateUsd: number;
  slippagePercent: number;
  
  // Liquidity
  liquidityUsd: number;
  priceImpact: number;
  
  // Meta
  confidence: number;
  executable: boolean;
  timestamp: TimestampMs;
  issues: string[];
}

/**
 * Flash loan opportunity (future)
 */
export interface FlashLoanOpportunity {
  id: string;
  type: 'flash_loan';
  chain: ChainId;
  path: DexProtocol[];
  tokens: string[];
  borrowAmount: string;
  expectedProfit: string;
  profitUsd: number;
  gasEstimateUsd: number;
  netProfitUsd: number;
  timestamp: TimestampMs;
}

/**
 * New pool alert (liquidity sniping)
 */
export interface NewPoolAlert {
  id: string;
  type: 'new_pool';
  dex: DexProtocol;
  chain: ChainId;
  poolAddress: string;
  token0: TokenInfo;
  token1: TokenInfo;
  initialLiquidityUsd: number;
  createdAt: TimestampMs;
  priceDiffPercent: number; // vs CEX if available
}

/**
 * DEX scanner statistics
 */
export interface DexScannerStats {
  totalScans: number;
  opportunitiesFound: number;
  lastScanAt: TimestampMs;
  activePools: number;
  activeChains: ChainId[];
  avgGasPrices: Record<ChainId, number>;
}

/**
 * API provider types
 */
export type DexApiProvider = '1inch' | 'moralis' | 'thegraph' | 'native';

/**
 * API configuration
 */
export interface DexApiConfig {
  provider: DexApiProvider;
  baseUrl: string;
  apiKey?: string;
  rateLimit: number; // requests per second
}
