/**
 * DEX Price Fetcher
 * Fetches prices from DEX pools using 1inch API and TheGraph subgraphs
 */

import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../config/index.js';
import {
  API_CONFIGS,
  CHAIN_ID_MAP,
  CHAIN_CONFIGS,
  COMMON_TOKENS,
  DEX_CONFIGS,
  DEX_SCANNER_DEFAULTS,
} from './config.js';
import type {
  ChainId,
  DexProtocol,
  GasEstimate,
} from './types.js';

/**
 * Simplified DEX types without branded types for internal use
 */
export interface SimpleDexQuote {
  dex: DexProtocol;
  chain: ChainId;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  gasEstimate: number;
  gasEstimateUsd: number;
  route: string[];
  timestamp: number;
}

export interface SimpleDexPool {
  id: string;
  dex: DexProtocol;
  chain: ChainId;
  address: string;
  token0: { address: string; symbol: string; decimals: number; name?: string };
  token1: { address: string; symbol: string; decimals: number; name?: string };
  reserveUsd: number;
  reserve0: string;
  reserve1: string;
  fee: number;
  lastUpdated: number;
}

export interface SimpleGasEstimate {
  chain: ChainId;
  gasPrice: string;
  gasPriceGwei: number;
  estimatedGas: number;
  totalCostWei: string;
  totalCostUsd: number;
  timestamp: number;
}

const logger = createLogger('dex-price-fetcher');

/**
 * Rate limiter for API calls
 */
class RateLimiter {
  private lastCall = 0;
  private readonly minIntervalMs: number;

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
}

const rateLimiters: Record<string, RateLimiter> = {
  '1inch': new RateLimiter(API_CONFIGS['1inch']?.rateLimit ?? 1),
  moralis: new RateLimiter(API_CONFIGS['moralis']?.rateLimit ?? 25),
  thegraph: new RateLimiter(API_CONFIGS['thegraph']?.rateLimit ?? 5),
};

/**
 * Get API key from environment
 */
function getApiKey(provider: string): string | undefined {
  try {
    const env = process.env;
    switch (provider) {
      case '1inch':
        return env['ONEINCH_API_KEY'];
      case 'moralis':
        return env['MORALIS_API_KEY'];
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Fetch quote from 1inch API
 */
export async function fetch1inchQuote(
  chain: ChainId,
  tokenIn: string,
  tokenOut: string,
  amountIn: string
): Promise<SimpleDexQuote | null> {
  if (chain === 'solana') {
    logger.debug('1inch does not support Solana');
    return null;
  }

  const chainId = CHAIN_ID_MAP[chain];
  if (chainId === 0) {
    return null;
  }

  const apiKey = getApiKey('1inch');
  if (!apiKey) {
    logger.debug('1inch API key not configured');
    return null;
  }

  await rateLimiters['1inch']?.wait();

  try {
    const url = `${API_CONFIGS['1inch']?.baseUrl ?? 'https://api.1inch.dev/swap/v6.0'}/${chainId}/quote?src=${tokenIn}&dst=${tokenOut}&amount=${amountIn}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn({ chain, status: response.status, error: error.slice(0, 100) }, '1inch API error');
      return null;
    }

    const data = await response.json() as {
      dstAmount: string;
      gas: number;
      protocols: Array<Array<Array<{ name: string }>>>;
    };

    const gasPrice = await getGasPrice(chain);
    const gasCostWei = BigInt(data.gas) * BigInt(gasPrice.gasPrice);
    const gasCostUsd = Number(gasCostWei) / 1e18 * CHAIN_CONFIGS[chain].gasTokenPriceUsd;

    return {
      dex: 'uniswap_v3', // 1inch routes through multiple DEXes
      chain,
      poolAddress: 'aggregated',
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: data.dstAmount,
      priceImpact: 0, // 1inch doesn't provide this directly
      gasEstimate: data.gas,
      gasEstimateUsd: gasCostUsd,
      route: data.protocols.flat().flat().map(p => p.name),
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.warn(
      { chain, error: error instanceof Error ? error.message : String(error) },
      'Failed to fetch 1inch quote'
    );
    return null;
  }
}

/**
 * Fetch pools from TheGraph subgraph
 */
export async function fetchSubgraphPools(
  subgraphUrl: string,
  dex: DexProtocol,
  chain: ChainId,
  limit = 20
): Promise<SimpleDexPool[]> {
  await rateLimiters['thegraph']?.wait();

  const query = `{
    pools(first: ${limit}, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id
      token0 { id symbol decimals name }
      token1 { id symbol decimals name }
      totalValueLockedUSD
      token0Price
      token1Price
      feeTier
    }
  }`;

  try {
    const response = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      logger.warn({ dex, status: response.status }, 'Subgraph query failed');
      return [];
    }

    const result = await response.json() as {
      data?: {
        pools: Array<{
          id: string;
          token0: { id: string; symbol: string; decimals: string; name: string };
          token1: { id: string; symbol: string; decimals: string; name: string };
          totalValueLockedUSD: string;
          token0Price: string;
          token1Price: string;
          feeTier?: string;
        }>;
      };
    };

    if (!result.data?.pools) {
      return [];
    }

    return result.data.pools.map(pool => ({
      id: `${dex}-${chain}-${pool.id}`,
      dex,
      chain,
      address: pool.id,
      token0: {
        address: pool.token0.id,
        symbol: pool.token0.symbol,
        decimals: parseInt(pool.token0.decimals, 10),
        name: pool.token0.name,
      },
      token1: {
        address: pool.token1.id,
        symbol: pool.token1.symbol,
        decimals: parseInt(pool.token1.decimals, 10),
        name: pool.token1.name,
      },
      reserveUsd: parseFloat(pool.totalValueLockedUSD),
      reserve0: pool.token0Price,
      reserve1: pool.token1Price,
      fee: pool.feeTier ? parseInt(pool.feeTier, 10) / 10000 : 0.3,
      lastUpdated: Date.now(),
    }));
  } catch (error) {
    logger.warn(
      { dex, chain, error: error instanceof Error ? error.message : String(error) },
      'Failed to fetch subgraph pools'
    );
    return [];
  }
}

/**
 * Get gas price for a chain
 */
export async function getGasPrice(chain: ChainId): Promise<SimpleGasEstimate> {
  const chainConfig = CHAIN_CONFIGS[chain];
  
  if (chain === 'solana') {
    // Solana has fixed low fees
    return {
      chain,
      gasPrice: '5000', // lamports
      gasPriceGwei: 0,
      estimatedGas: 200000,
      totalCostWei: '1000000000', // ~0.001 SOL
      totalCostUsd: 0.001 * chainConfig.gasTokenPriceUsd,
      timestamp: Date.now(),
    };
  }

  try {
    const response = await fetch(chainConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC error: ${response.status}`);
    }

    const result = await response.json() as { result: string };
    const gasPriceWei = BigInt(result.result);
    const gasPriceGwei = Number(gasPriceWei) / 1e9;
    
    // Estimate standard swap gas
    const estimatedGas = 150000; // Standard swap
    const totalCostWei = gasPriceWei * BigInt(estimatedGas);
    const totalCostEth = Number(totalCostWei) / 1e18;
    const totalCostUsd = totalCostEth * chainConfig.gasTokenPriceUsd;

    return {
      chain,
      gasPrice: gasPriceWei.toString(),
      gasPriceGwei,
      estimatedGas,
      totalCostWei: totalCostWei.toString(),
      totalCostUsd,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.warn(
      { chain, error: error instanceof Error ? error.message : String(error) },
      'Failed to get gas price, using fallback'
    );
    
    // Fallback gas estimates
    const fallbackGwei = chain === 'ethereum' ? 30 : chain === 'bsc' ? 5 : 1;
    const gasPriceWei = BigInt(fallbackGwei) * BigInt(1e9);
    const estimatedGas = 150000;
    const totalCostWei = gasPriceWei * BigInt(estimatedGas);
    const totalCostUsd = Number(totalCostWei) / 1e18 * chainConfig.gasTokenPriceUsd;

    return {
      chain,
      gasPrice: gasPriceWei.toString(),
      gasPriceGwei: fallbackGwei,
      estimatedGas,
      totalCostWei: totalCostWei.toString(),
      totalCostUsd,
      timestamp: Date.now(),
    };
  }
}

/**
 * Calculate price from pool reserves
 */
export function calculatePoolPrice(
  reserve0: string,
  reserve1: string,
  decimals0: number,
  decimals1: number
): number {
  const r0 = parseFloat(reserve0) / Math.pow(10, decimals0);
  const r1 = parseFloat(reserve1) / Math.pow(10, decimals1);
  return r1 / r0;
}

/**
 * Get token address by symbol on a chain
 */
export function getTokenAddress(chain: ChainId, symbol: string): string | undefined {
  const tokens = COMMON_TOKENS[chain];
  return tokens[symbol.toUpperCase()];
}

/**
 * Fetch all active DEX pools
 */
export async function fetchAllPools(): Promise<SimpleDexPool[]> {
  const allPools: SimpleDexPool[] = [];
  
  for (const dexConfig of DEX_CONFIGS) {
    if (!dexConfig.isActive || !dexConfig.subgraphUrl) {
      continue;
    }

    try {
      const pools = await fetchSubgraphPools(
        dexConfig.subgraphUrl,
        dexConfig.protocol,
        dexConfig.chain,
        20
      );
      
      // Filter by minimum liquidity
      const filteredPools = pools.filter(
        p => p.reserveUsd >= DEX_SCANNER_DEFAULTS.minLiquidityUsd
      );
      
      allPools.push(...filteredPools);
      
      logger.debug(
        { dex: dexConfig.name, chain: dexConfig.chain, count: filteredPools.length },
        `Fetched ${filteredPools.length} pools from ${dexConfig.name}`
      );
    } catch (error) {
      logger.warn(
        { dex: dexConfig.name, error: error instanceof Error ? error.message : String(error) },
        'Failed to fetch pools'
      );
    }

    // Small delay between DEX queries
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  logger.info({ totalPools: allPools.length }, `Fetched ${allPools.length} DEX pools total`);
  return allPools;
}

/**
 * Update gas token prices from CEX prices
 */
export function updateGasTokenPrices(prices: Record<string, number>): void {
  if (prices['ETH']) {
    CHAIN_CONFIGS.ethereum.gasTokenPriceUsd = prices['ETH'];
    CHAIN_CONFIGS.arbitrum.gasTokenPriceUsd = prices['ETH'];
    CHAIN_CONFIGS.optimism.gasTokenPriceUsd = prices['ETH'];
    CHAIN_CONFIGS.base.gasTokenPriceUsd = prices['ETH'];
  }
  if (prices['BNB']) {
    CHAIN_CONFIGS.bsc.gasTokenPriceUsd = prices['BNB'];
  }
  if (prices['MATIC']) {
    CHAIN_CONFIGS.polygon.gasTokenPriceUsd = prices['MATIC'];
  }
  if (prices['AVAX']) {
    CHAIN_CONFIGS.avalanche.gasTokenPriceUsd = prices['AVAX'];
  }
  if (prices['SOL']) {
    CHAIN_CONFIGS.solana.gasTokenPriceUsd = prices['SOL'];
  }
}
