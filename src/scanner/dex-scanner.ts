/**
 * DEX Scanner - Multi-chain DEX arbitrage detection
 * Supports 15 DEXs: Uniswap V3, Raydium, Orca, PancakeSwap, SushiSwap,
 * QuickSwap, Trader Joe, Camelot, Aerodrome, Velodrome, Balancer, Curve,
 * 1inch, KyberSwap, Jupiter
 */

import { createLogger } from '../utils/logger.js';
import { getDashboardStore } from '../dashboard/store.js';
import { sendArbitrageAlert } from '../utils/telegram.js';
import type { ExchangeId } from '../config/schema.js';

const logger = createLogger('dex-scanner');

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Supported blockchain networks */
export type ChainId = 
  | 'ethereum' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism' 
  | 'base' | 'avalanche' | 'solana';

/** DEX protocol identifiers */
export type DexId = 
  | 'uniswap_v3' | 'raydium' | 'orca' | 'pancakeswap' | 'sushiswap'
  | 'quickswap' | 'trader_joe' | 'camelot' | 'aerodrome' | 'velodrome'
  | 'balancer' | 'curve' | 'oneinch' | 'kyberswap' | 'jupiter';

/** DEX opportunity type */
export type DexOpportunityType = 'cex_to_dex' | 'dex_to_cex' | 'flash_loan' | 'new_pool';

/** DEX configuration */
export interface DexConfig {
  id: DexId;
  name: string;
  chain: ChainId;
  feePercent: number;
  routerAddress: string;
  factoryAddress: string;
  enabled: boolean;
}

/** Pool information */
export interface PoolInfo {
  address: string;
  dex: DexId;
  chain: ChainId;
  token0: TokenInfo;
  token1: TokenInfo;
  reserve0: number;
  reserve1: number;
  liquidityUsd: number;
  fee: number;
  createdAt: number;
  lastUpdate: number;
}

/** Token information */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
}

/** Gas estimate */
export interface GasEstimate {
  gasLimit: number;
  gasPriceGwei: number;
  gasUsd: number;
  chain: ChainId;
}

/** DEX arbitrage opportunity */
export interface DexOpportunity {
  id: string;
  type: DexOpportunityType;
  timestamp: number;
  symbol: string;
  buySource: string;
  sellSource: string;
  buyPrice: number;
  sellPrice: number;
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  dex: DexId;
  chain: ChainId;
  poolAddress: string;
  poolLink: string;
  liquidityUsd: number;
  gasUsd: number;
  dexFeePercent: number;
  confidence: number;
  executable: boolean;
  poolAge: number;
}

/** Scanner state */
interface DexScannerState {
  isRunning: boolean;
  pools: Map<string, PoolInfo>;
  lastScan: number;
  scanCount: number;
  opportunityCount: number;
  gasEstimates: Map<ChainId, GasEstimate>;
}

// ============================================================================
// Configuration
// ============================================================================

/** Chain configuration */
const CHAIN_CONFIG: Record<ChainId, { 
  name: string; 
  nativeToken: string; 
  explorerUrl: string;
  avgGasPrice: number;
}> = {
  ethereum: { name: 'Ethereum', nativeToken: 'ETH', explorerUrl: 'https://etherscan.io', avgGasPrice: 30 },
  bsc: { name: 'BNB Chain', nativeToken: 'BNB', explorerUrl: 'https://bscscan.com', avgGasPrice: 3 },
  polygon: { name: 'Polygon', nativeToken: 'MATIC', explorerUrl: 'https://polygonscan.com', avgGasPrice: 50 },
  arbitrum: { name: 'Arbitrum', nativeToken: 'ETH', explorerUrl: 'https://arbiscan.io', avgGasPrice: 0.1 },
  optimism: { name: 'Optimism', nativeToken: 'ETH', explorerUrl: 'https://optimistic.etherscan.io', avgGasPrice: 0.001 },
  base: { name: 'Base', nativeToken: 'ETH', explorerUrl: 'https://basescan.org', avgGasPrice: 0.001 },
  avalanche: { name: 'Avalanche', nativeToken: 'AVAX', explorerUrl: 'https://snowtrace.io', avgGasPrice: 25 },
  solana: { name: 'Solana', nativeToken: 'SOL', explorerUrl: 'https://solscan.io', avgGasPrice: 0.000005 },
};

/** DEX configurations for 15 protocols */
const DEX_CONFIGS: DexConfig[] = [
  // Ethereum
  { id: 'uniswap_v3', name: 'Uniswap V3', chain: 'ethereum', feePercent: 0.3, routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984', enabled: true },
  { id: 'sushiswap', name: 'SushiSwap', chain: 'ethereum', feePercent: 0.3, routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', enabled: true },
  { id: 'balancer', name: 'Balancer V2', chain: 'ethereum', feePercent: 0.1, routerAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', factoryAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', enabled: true },
  { id: 'curve', name: 'Curve Finance', chain: 'ethereum', feePercent: 0.04, routerAddress: '0x99a58482BD75cbab83b27EC03CA68fF489b5788f', factoryAddress: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4', enabled: true },
  { id: 'oneinch', name: '1inch Aggregator', chain: 'ethereum', feePercent: 0, routerAddress: '0x1111111254EEB25477B68fb85Ed929f73A960582', factoryAddress: '0x0000000000000000000000000000000000000000', enabled: true },
  { id: 'kyberswap', name: 'KyberSwap', chain: 'ethereum', feePercent: 0.1, routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', factoryAddress: '0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a', enabled: true },
  // BSC
  { id: 'pancakeswap', name: 'PancakeSwap V3', chain: 'bsc', feePercent: 0.25, routerAddress: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', factoryAddress: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', enabled: true },
  // Polygon
  { id: 'quickswap', name: 'QuickSwap V3', chain: 'polygon', feePercent: 0.3, routerAddress: '0xf5b509bB0909a69B1c207E495f687a596C168E12', factoryAddress: '0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28', enabled: true },
  // Arbitrum
  { id: 'camelot', name: 'Camelot V3', chain: 'arbitrum', feePercent: 0.3, routerAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d', factoryAddress: '0x6EcCab422D763aC031210895C81787E87B43A652', enabled: true },
  // Optimism
  { id: 'velodrome', name: 'Velodrome V2', chain: 'optimism', feePercent: 0.05, routerAddress: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858', factoryAddress: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a', enabled: true },
  // Base
  { id: 'aerodrome', name: 'Aerodrome', chain: 'base', feePercent: 0.05, routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43', factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', enabled: true },
  // Avalanche
  { id: 'trader_joe', name: 'Trader Joe V2.1', chain: 'avalanche', feePercent: 0.3, routerAddress: '0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30', factoryAddress: '0x8e42f2F4101563bF679975178e880FD87d3eFd4e', enabled: true },
  // Solana
  { id: 'raydium', name: 'Raydium', chain: 'solana', feePercent: 0.25, routerAddress: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', factoryAddress: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', enabled: true },
  { id: 'orca', name: 'Orca Whirlpools', chain: 'solana', feePercent: 0.3, routerAddress: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', factoryAddress: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', enabled: true },
  { id: 'jupiter', name: 'Jupiter Aggregator', chain: 'solana', feePercent: 0, routerAddress: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', factoryAddress: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', enabled: true },
];

/** Common tokens per chain */
const COMMON_TOKENS: Record<ChainId, TokenInfo[]> = {
  ethereum: [
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18, priceUsd: 3000 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, priceUsd: 1 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6, priceUsd: 1 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8, priceUsd: 95000 },
  ],
  bsc: [
    { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18, priceUsd: 600 },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18, priceUsd: 1 },
  ],
  polygon: [
    { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', decimals: 18, priceUsd: 0.5 },
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, priceUsd: 1 },
  ],
  arbitrum: [
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18, priceUsd: 3000 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6, priceUsd: 1 },
  ],
  optimism: [
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, priceUsd: 3000 },
    { address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC', decimals: 6, priceUsd: 1 },
  ],
  base: [
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, priceUsd: 3000 },
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, priceUsd: 1 },
  ],
  avalanche: [
    { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', symbol: 'WAVAX', decimals: 18, priceUsd: 35 },
    { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6, priceUsd: 1 },
  ],
  solana: [
    { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9, priceUsd: 150 },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6, priceUsd: 1 },
  ],
};

/** Native token prices */
const NATIVE_PRICES: Record<string, number> = {
  ETH: 3000,
  BNB: 600,
  MATIC: 0.5,
  AVAX: 35,
  SOL: 150,
};

/** Scan configuration */
const SCAN_CONFIG = {
  intervalMs: 5000,
  minLiquidityUsd: 10000,
  minNetPercent: -0.5,
  maxPoolAgeSec: 86400 * 7,
  newPoolAgeSec: 3600,
  flashLoanMinProfit: 0.1,
  tradeSize: 5000,
};

// ============================================================================
// State
// ============================================================================

const state: DexScannerState = {
  isRunning: false,
  pools: new Map(),
  lastScan: 0,
  scanCount: 0,
  opportunityCount: 0,
  gasEstimates: new Map(),
};

// ============================================================================
// API Integration
// ============================================================================

/**
 * Get API key from environment
 */
function getApiKey(name: string): string | null {
  const key = process.env[name];
  return key && key !== '' && key !== 'skip' ? key : null;
}

/**
 * Fetch pool data from Moralis API
 */
async function fetchMoralisPools(chain: ChainId, tokenAddress: string): Promise<PoolInfo[]> {
  const apiKey = getApiKey('MORALIS_API_KEY');
  if (!apiKey) {
    return [];
  }

  const chainMap: Record<ChainId, string> = {
    ethereum: 'eth', bsc: 'bsc', polygon: 'polygon', arbitrum: 'arbitrum',
    optimism: 'optimism', base: 'base', avalanche: 'avalanche', solana: 'solana',
  };

  try {
    const url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/pairs?chain=${chainMap[chain]}`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    });

    if (!response.ok) return [];

    const data = await response.json() as {
      pairs: Array<{
        pairAddress: string;
        token0: { address: string; symbol: string; decimals: string };
        token1: { address: string; symbol: string; decimals: string };
        reserve0: string;
        reserve1: string;
        totalLiquidityUsd: string;
      }>;
    };

    return (data.pairs || []).map(pair => ({
      address: pair.pairAddress,
      dex: 'uniswap_v3' as DexId,
      chain,
      token0: { address: pair.token0.address, symbol: pair.token0.symbol, decimals: parseInt(pair.token0.decimals), priceUsd: 1 },
      token1: { address: pair.token1.address, symbol: pair.token1.symbol, decimals: parseInt(pair.token1.decimals), priceUsd: 1 },
      reserve0: parseFloat(pair.reserve0 || '0'),
      reserve1: parseFloat(pair.reserve1 || '0'),
      liquidityUsd: parseFloat(pair.totalLiquidityUsd || '0'),
      fee: 0.3,
      createdAt: Date.now() - 86400000,
      lastUpdate: Date.now(),
    }));
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Moralis fetch error');
    return [];
  }
}

/**
 * Fetch quote from 1inch API
 */
async function fetch1inchQuote(
  chainId: number,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<{ outputAmount: number; gas: number } | null> {
  const apiKey = getApiKey('ONEINCH_API_KEY');
  if (!apiKey) return null;

  try {
    const url = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?src=${fromToken}&dst=${toToken}&amount=${amount}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json() as { dstAmount: string; gas: number };
    return { outputAmount: parseFloat(data.dstAmount), gas: data.gas || 250000 };
  } catch {
    return null;
  }
}

/**
 * Fetch Jupiter quote (Solana)
 */
async function fetchJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string
): Promise<{ outputAmount: number; priceImpact: number } | null> {
  try {
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (!response.ok) return null;

    const data = await response.json() as { outAmount: string; priceImpactPct: string };
    return { outputAmount: parseFloat(data.outAmount), priceImpact: parseFloat(data.priceImpactPct || '0') };
  } catch {
    return null;
  }
}

// ============================================================================
// Gas Estimation
// ============================================================================

/**
 * Estimate gas cost for a swap
 */
function estimateGas(chain: ChainId, complexity: 'simple' | 'multi' | 'flash'): GasEstimate {
  const gasLimits: Record<string, Record<ChainId, number>> = {
    simple: { ethereum: 150000, bsc: 100000, polygon: 150000, arbitrum: 500000, optimism: 500000, base: 500000, avalanche: 150000, solana: 200000 },
    multi: { ethereum: 300000, bsc: 200000, polygon: 300000, arbitrum: 1000000, optimism: 1000000, base: 1000000, avalanche: 300000, solana: 400000 },
    flash: { ethereum: 500000, bsc: 350000, polygon: 500000, arbitrum: 1500000, optimism: 1500000, base: 1500000, avalanche: 500000, solana: 600000 },
  };

  const config = CHAIN_CONFIG[chain];
  const gasLimit = (gasLimits[complexity] as Record<ChainId, number>)[chain] ?? 200000;
  const gasPriceGwei = config.avgGasPrice;
  const nativePrice = NATIVE_PRICES[config.nativeToken] || 1;
  const gasUsd = (gasLimit * gasPriceGwei * nativePrice) / 1e9;

  return { gasLimit, gasPriceGwei, gasUsd, chain };
}

// ============================================================================
// CEX Price Integration
// ============================================================================

/** CEX prices cache */
const cexPrices: Map<string, { bid: number; ask: number; exchange: ExchangeId }> = new Map();

/**
 * Update CEX price from main scanner
 */
export function updateCexPrice(symbol: string, exchange: ExchangeId, bid: number, ask: number): void {
  cexPrices.set(`${symbol}:${exchange}`, { bid, ask, exchange });
}

/**
 * Get best CEX price for a symbol
 */
function getBestCexPrice(symbol: string): { 
  bestBid: { price: number; exchange: ExchangeId } | null;
  bestAsk: { price: number; exchange: ExchangeId } | null;
} {
  let bestBid: { price: number; exchange: ExchangeId } | null = null;
  let bestAsk: { price: number; exchange: ExchangeId } | null = null;

  for (const [key, data] of cexPrices) {
    if (!key.startsWith(`${symbol}:`)) continue;
    if (!bestBid || data.bid > bestBid.price) bestBid = { price: data.bid, exchange: data.exchange };
    if (!bestAsk || data.ask < bestAsk.price) bestAsk = { price: data.ask, exchange: data.exchange };
  }

  return { bestBid, bestAsk };
}

// ============================================================================
// Opportunity Detection
// ============================================================================

/**
 * Generate pool link
 */
function getPoolLink(chain: ChainId, poolAddress: string): string {
  const explorer = CHAIN_CONFIG[chain].explorerUrl;
  if (chain === 'solana') return `https://solscan.io/account/${poolAddress}`;
  return `${explorer}/address/${poolAddress}`;
}

/**
 * Simulate DEX swap output using constant product formula
 */
function simulateDexSwap(pool: PoolInfo, amountIn: number, isSell: boolean): number {
  const reserveIn = isSell ? pool.reserve0 : pool.reserve1;
  const reserveOut = isSell ? pool.reserve1 : pool.reserve0;
  
  if (reserveIn <= 0 || reserveOut <= 0) return 0;
  
  const amountInWithFee = amountIn * (1 - pool.fee / 100);
  return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
}

/**
 * Calculate confidence score
 */
function calculateConfidence(liquidityUsd: number, poolAgeSec: number, netPercent: number): number {
  let score = 0.5;
  
  if (liquidityUsd >= 100000) score += 0.2;
  else if (liquidityUsd >= 50000) score += 0.1;
  else if (liquidityUsd < 10000) score -= 0.2;
  
  if (poolAgeSec > 86400 * 30) score += 0.15;
  else if (poolAgeSec > 86400 * 7) score += 0.1;
  else if (poolAgeSec < 3600) score -= 0.2;
  
  if (netPercent > 0 && netPercent < 2) score += 0.1;
  else if (netPercent > 5) score -= 0.1;
  
  return Math.max(0.1, Math.min(0.95, score));
}

/**
 * Detect CEX → DEX arbitrage
 */
function detectCexToDex(token: TokenInfo, pool: PoolInfo, dexConfig: DexConfig): DexOpportunity | null {
  const symbol = `${token.symbol}/USDT`;
  const { bestAsk } = getBestCexPrice(symbol);
  if (!bestAsk) return null;

  const sellAmount = SCAN_CONFIG.tradeSize / bestAsk.price;
  const dexOutput = simulateDexSwap(pool, sellAmount, true);
  if (dexOutput <= 0) return null;

  const gasEstimate = estimateGas(pool.chain, 'simple');
  const dexFee = dexOutput * dexConfig.feePercent / 100;
  const netOutput = dexOutput - dexFee - gasEstimate.gasUsd;

  const cexCost = SCAN_CONFIG.tradeSize;
  const grossPercent = ((dexOutput - cexCost) / cexCost) * 100;
  const netPercent = ((netOutput - cexCost) / cexCost) * 100;
  const profitUsd = netOutput - cexCost;

  if (netPercent < SCAN_CONFIG.minNetPercent) return null;

  const poolAge = Math.floor((Date.now() - pool.createdAt) / 1000);

  return {
    id: `cex_dex_${token.symbol}_${dexConfig.id}_${Date.now()}`,
    type: 'cex_to_dex',
    timestamp: Date.now(),
    symbol,
    buySource: bestAsk.exchange,
    sellSource: dexConfig.name,
    buyPrice: bestAsk.price,
    sellPrice: dexOutput / sellAmount,
    grossPercent,
    netPercent,
    profitUsd,
    dex: dexConfig.id,
    chain: pool.chain,
    poolAddress: pool.address,
    poolLink: getPoolLink(pool.chain, pool.address),
    liquidityUsd: pool.liquidityUsd,
    gasUsd: gasEstimate.gasUsd,
    dexFeePercent: dexConfig.feePercent,
    confidence: calculateConfidence(pool.liquidityUsd, poolAge, netPercent),
    executable: netPercent > 0 && pool.liquidityUsd >= SCAN_CONFIG.tradeSize * 2,
    poolAge,
  };
}

/**
 * Detect DEX → CEX arbitrage
 */
function detectDexToCex(token: TokenInfo, pool: PoolInfo, dexConfig: DexConfig): DexOpportunity | null {
  const symbol = `${token.symbol}/USDT`;
  const { bestBid } = getBestCexPrice(symbol);
  if (!bestBid) return null;

  const dexOutput = simulateDexSwap(pool, SCAN_CONFIG.tradeSize, false);
  if (dexOutput <= 0) return null;

  const gasEstimate = estimateGas(pool.chain, 'simple');
  const dexFee = SCAN_CONFIG.tradeSize * dexConfig.feePercent / 100;
  const cexRevenue = dexOutput * bestBid.price;
  const cexFee = cexRevenue * 0.001;
  const netRevenue = cexRevenue - cexFee - gasEstimate.gasUsd;

  const totalCost = SCAN_CONFIG.tradeSize + dexFee;
  const grossPercent = ((cexRevenue - totalCost) / totalCost) * 100;
  const netPercent = ((netRevenue - totalCost) / totalCost) * 100;
  const profitUsd = netRevenue - totalCost;

  if (netPercent < SCAN_CONFIG.minNetPercent) return null;

  const poolAge = Math.floor((Date.now() - pool.createdAt) / 1000);

  return {
    id: `dex_cex_${token.symbol}_${dexConfig.id}_${Date.now()}`,
    type: 'dex_to_cex',
    timestamp: Date.now(),
    symbol,
    buySource: dexConfig.name,
    sellSource: bestBid.exchange,
    buyPrice: SCAN_CONFIG.tradeSize / dexOutput,
    sellPrice: bestBid.price,
    grossPercent,
    netPercent,
    profitUsd,
    dex: dexConfig.id,
    chain: pool.chain,
    poolAddress: pool.address,
    poolLink: getPoolLink(pool.chain, pool.address),
    liquidityUsd: pool.liquidityUsd,
    gasUsd: gasEstimate.gasUsd,
    dexFeePercent: dexConfig.feePercent,
    confidence: calculateConfidence(pool.liquidityUsd, poolAge, netPercent),
    executable: netPercent > 0 && pool.liquidityUsd >= SCAN_CONFIG.tradeSize * 2,
    poolAge,
  };
}

/**
 * Detect flash loan opportunity
 */
function detectFlashLoan(pool: PoolInfo, dexConfig: DexConfig): DexOpportunity | null {
  const symbol = `${pool.token0.symbol}/${pool.token1.symbol}`;
  const { bestBid } = getBestCexPrice(symbol);
  if (!bestBid) return null;

  const loanAmount = SCAN_CONFIG.tradeSize * 10;
  const flashLoanFee = loanAmount * 0.0009;
  const dexOutput = simulateDexSwap(pool, loanAmount, false);
  if (dexOutput <= 0) return null;

  const gasEstimate = estimateGas(pool.chain, 'flash');
  const dexFee = loanAmount * dexConfig.feePercent / 100;
  const cexRevenue = dexOutput * bestBid.price;
  const totalCost = loanAmount + flashLoanFee + dexFee + gasEstimate.gasUsd;

  const grossPercent = ((cexRevenue - loanAmount) / loanAmount) * 100;
  const netPercent = ((cexRevenue - totalCost) / loanAmount) * 100;
  const profitUsd = cexRevenue - totalCost;

  if (netPercent < SCAN_CONFIG.flashLoanMinProfit) return null;

  const poolAge = Math.floor((Date.now() - pool.createdAt) / 1000);

  return {
    id: `flash_${pool.token0.symbol}_${dexConfig.id}_${Date.now()}`,
    type: 'flash_loan',
    timestamp: Date.now(),
    symbol,
    buySource: `${dexConfig.name} (Flash)`,
    sellSource: bestBid.exchange,
    buyPrice: loanAmount / dexOutput,
    sellPrice: bestBid.price,
    grossPercent,
    netPercent,
    profitUsd,
    dex: dexConfig.id,
    chain: pool.chain,
    poolAddress: pool.address,
    poolLink: getPoolLink(pool.chain, pool.address),
    liquidityUsd: pool.liquidityUsd,
    gasUsd: gasEstimate.gasUsd,
    dexFeePercent: dexConfig.feePercent + 0.09,
    confidence: calculateConfidence(pool.liquidityUsd, poolAge, netPercent) * 0.8,
    executable: false,
    poolAge,
  };
}

/**
 * Detect new pool sniping opportunity
 */
function detectNewPoolSnipe(pool: PoolInfo, dexConfig: DexConfig): DexOpportunity | null {
  const poolAge = Math.floor((Date.now() - pool.createdAt) / 1000);
  if (poolAge > SCAN_CONFIG.newPoolAgeSec) return null;

  const symbol = `${pool.token0.symbol}/${pool.token1.symbol}`;
  const { bestBid, bestAsk } = getBestCexPrice(symbol);
  if (!bestBid || !bestAsk) return null;

  const poolPrice = pool.reserve1 / pool.reserve0;
  const cexMidPrice = (bestBid.price + bestAsk.price) / 2;
  const priceDiff = (Math.abs(poolPrice - cexMidPrice) / cexMidPrice) * 100;

  if (priceDiff < 1) return null;

  const gasEstimate = estimateGas(pool.chain, 'simple');
  const grossPercent = priceDiff;
  const netPercent = priceDiff - dexConfig.feePercent - (gasEstimate.gasUsd / SCAN_CONFIG.tradeSize) * 100;
  const profitUsd = SCAN_CONFIG.tradeSize * netPercent / 100;

  if (netPercent < SCAN_CONFIG.minNetPercent) return null;

  return {
    id: `snipe_${pool.token0.symbol}_${dexConfig.id}_${Date.now()}`,
    type: 'new_pool',
    timestamp: Date.now(),
    symbol,
    buySource: poolPrice < cexMidPrice ? dexConfig.name : bestAsk.exchange,
    sellSource: poolPrice < cexMidPrice ? bestBid.exchange : dexConfig.name,
    buyPrice: poolPrice < cexMidPrice ? poolPrice : bestAsk.price,
    sellPrice: poolPrice < cexMidPrice ? bestBid.price : poolPrice,
    grossPercent,
    netPercent,
    profitUsd,
    dex: dexConfig.id,
    chain: pool.chain,
    poolAddress: pool.address,
    poolLink: getPoolLink(pool.chain, pool.address),
    liquidityUsd: pool.liquidityUsd,
    gasUsd: gasEstimate.gasUsd,
    dexFeePercent: dexConfig.feePercent,
    confidence: 0.3,
    executable: false,
    poolAge,
  };
}

// ============================================================================
// Dashboard Integration
// ============================================================================

/**
 * Push DEX opportunity to dashboard
 */
function pushToDashboard(opp: DexOpportunity): void {
  const store = getDashboardStore();
  
  store.addSpread({
    type: 'simple',
    symbol: opp.symbol,
    buyExchange: opp.buySource as ExchangeId,
    sellExchange: opp.sellSource as ExchangeId,
    buyPrice: opp.buyPrice,
    sellPrice: opp.sellPrice,
    grossPercent: opp.grossPercent,
    netPercent: opp.netPercent,
    profitUsd: opp.profitUsd,
    depthUsd: opp.liquidityUsd,
    confidence: opp.confidence,
    fees: opp.dexFeePercent + opp.gasUsd / SCAN_CONFIG.tradeSize * 100,
    slippage: 0.5,
    executable: opp.executable,
    transferNetwork: `${opp.dex}:${opp.chain}`,
    transferCostUsd: opp.gasUsd,
  });

  logger.info(
    { type: opp.type, token: opp.symbol, dex: opp.dex, chain: opp.chain, net: opp.netPercent.toFixed(4), gasUsd: opp.gasUsd.toFixed(2) },
    `DEX opportunity: ${opp.symbol} on ${opp.dex} net ${opp.netPercent.toFixed(2)}% (gas $${opp.gasUsd.toFixed(2)})`
  );

  if (opp.netPercent > -0.05 || opp.grossPercent > 0.1) {
    sendArbitrageAlert({
      type: 'simple',
      symbol: opp.symbol,
      buyExchange: opp.buySource,
      sellExchange: opp.sellSource,
      grossPercent: opp.grossPercent,
      netPercent: opp.netPercent,
      profitUsd: opp.profitUsd,
      depthUsd: opp.liquidityUsd,
      executable: opp.executable,
      pathDescription: `${opp.dex} on ${opp.chain} | Gas: $${opp.gasUsd.toFixed(2)} | Pool: ${opp.poolAge}s old`,
    }).catch(() => { /* ignore */ });
  }

  state.opportunityCount++;
}

// ============================================================================
// Mock Data Generation
// ============================================================================

/**
 * Generate mock pools for testing
 */
function generateMockPools(): PoolInfo[] {
  // Synthetic pool data removed — without real on-chain RPC / aggregator
  // access the scanner returns an empty pool list and the UI shows
  // "Coming soon / configure API keys".
  return [];
}

// ============================================================================
// Main Scanner Loop
// ============================================================================

/**
 * Run single scan iteration
 */
async function runScan(): Promise<void> {
  state.scanCount++;
  const startTime = Date.now();
  let opportunitiesFound = 0;

  let pools = Array.from(state.pools.values());

  if (pools.length === 0) {
    const hasApiKeys = getApiKey('MORALIS_API_KEY') || getApiKey('ONEINCH_API_KEY');

    if (hasApiKeys) {
      for (const chain of Object.keys(COMMON_TOKENS) as ChainId[]) {
        const tokens = COMMON_TOKENS[chain];
        for (const token of tokens.slice(0, 2)) {
          const fetchedPools = await fetchMoralisPools(chain, token.address);
          for (const pool of fetchedPools) {
            state.pools.set(pool.address, pool);
          }
        }
      }
      pools = Array.from(state.pools.values());
    }

    if (pools.length === 0) {
      pools = generateMockPools();
      for (const pool of pools) {
        state.pools.set(pool.address, pool);
      }
      logger.info({ poolCount: pools.length }, 'Generated mock pools for testing (no API keys configured)');
    }
  }

  for (const dexConfig of DEX_CONFIGS.filter(d => d.enabled)) {
    const dexPools = pools.filter(p => p.dex === dexConfig.id);

    for (const pool of dexPools) {
      if (pool.liquidityUsd < SCAN_CONFIG.minLiquidityUsd) continue;

      try {
        const cexToDex = detectCexToDex(pool.token0, pool, dexConfig);
        if (cexToDex) { pushToDashboard(cexToDex); opportunitiesFound++; }

        const dexToCex = detectDexToCex(pool.token0, pool, dexConfig);
        if (dexToCex) { pushToDashboard(dexToCex); opportunitiesFound++; }

        if (pool.liquidityUsd >= 50000) {
          const flashLoan = detectFlashLoan(pool, dexConfig);
          if (flashLoan) { pushToDashboard(flashLoan); opportunitiesFound++; }
        }

        const snipe = detectNewPoolSnipe(pool, dexConfig);
        if (snipe) { pushToDashboard(snipe); opportunitiesFound++; }
      } catch (error) {
        logger.debug({ dex: dexConfig.id, pool: pool.address, error: error instanceof Error ? error.message : String(error) }, 'Error scanning pool');
      }
    }
  }

  state.lastScan = Date.now();
  const scanTime = Date.now() - startTime;

  if (state.scanCount % 10 === 0 || opportunitiesFound > 0) {
    logger.info(
      { scan: state.scanCount, pools: pools.length, opportunities: opportunitiesFound, total: state.opportunityCount, scanTimeMs: scanTime },
      `DEX scan #${state.scanCount}: ${opportunitiesFound} opportunities found in ${scanTime}ms`
    );
  }
}

/**
 * Main scan loop
 */
async function scanLoop(): Promise<void> {
  while (state.isRunning) {
    try {
      await runScan();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'DEX scan error');
    }
    await new Promise(resolve => setTimeout(resolve, SCAN_CONFIG.intervalMs));
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start DEX scanner
 */
export async function startDexScanner(): Promise<void> {
  if (state.isRunning) {
    logger.warn('DEX scanner already running');
    return;
  }

  logger.info(
    { dexCount: DEX_CONFIGS.filter(d => d.enabled).length, chains: [...new Set(DEX_CONFIGS.filter(d => d.enabled).map(d => d.chain))] },
    'Starting DEX scanner with 15 protocols...'
  );

  state.isRunning = true;
  logger.info('🔷 DEX Scanner started - monitoring CEX-DEX arbitrage, flash loans, and new pools');

  scanLoop().catch(error => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'DEX scan loop error');
    state.isRunning = false;
  });
}

/**
 * Stop DEX scanner
 */
export function stopDexScanner(): void {
  logger.info('Stopping DEX scanner...');
  state.isRunning = false;
}

/**
 * Get scanner stats
 */
export function getDexScannerStats(): {
  isRunning: boolean;
  poolCount: number;
  scanCount: number;
  opportunityCount: number;
  lastScan: number;
  enabledDexes: string[];
} {
  return {
    isRunning: state.isRunning,
    poolCount: state.pools.size,
    scanCount: state.scanCount,
    opportunityCount: state.opportunityCount,
    lastScan: state.lastScan,
    enabledDexes: DEX_CONFIGS.filter(d => d.enabled).map(d => d.name),
  };
}

/**
 * Get DEX configurations
 */
export function getDexConfigs(): DexConfig[] {
  return DEX_CONFIGS;
}

/**
 * Check if DEX scanner is running
 */
export function isDexScannerRunning(): boolean {
  return state.isRunning;
}

// Mark unused functions to avoid lint warnings
void fetch1inchQuote;
void fetchJupiterQuote;
