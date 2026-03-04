/**
 * DEX Scanner Configuration
 * Chain configs, DEX protocols, and API endpoints
 */

import type { ChainConfig, ChainId, DexConfig, DexApiConfig } from './types.js';

/**
 * Blockchain network configurations
 */
export const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainIdHex: '0x1',
    rpcUrl: 'https://eth.llamarpc.com',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://etherscan.io',
    avgBlockTimeMs: 12000,
    gasTokenPriceUsd: 2500, // Updated dynamically
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Smart Chain',
    chainIdHex: '0x38',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    nativeCurrency: 'BNB',
    blockExplorer: 'https://bscscan.com',
    avgBlockTimeMs: 3000,
    gasTokenPriceUsd: 300,
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainIdHex: '0x89',
    rpcUrl: 'https://polygon-rpc.com',
    nativeCurrency: 'MATIC',
    blockExplorer: 'https://polygonscan.com',
    avgBlockTimeMs: 2000,
    gasTokenPriceUsd: 0.5,
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    chainIdHex: '0xa4b1',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://arbiscan.io',
    avgBlockTimeMs: 250,
    gasTokenPriceUsd: 2500,
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism',
    chainIdHex: '0xa',
    rpcUrl: 'https://mainnet.optimism.io',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://optimistic.etherscan.io',
    avgBlockTimeMs: 2000,
    gasTokenPriceUsd: 2500,
  },
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche C-Chain',
    chainIdHex: '0xa86a',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    nativeCurrency: 'AVAX',
    blockExplorer: 'https://snowtrace.io',
    avgBlockTimeMs: 2000,
    gasTokenPriceUsd: 25,
  },
  base: {
    id: 'base',
    name: 'Base',
    chainIdHex: '0x2105',
    rpcUrl: 'https://mainnet.base.org',
    nativeCurrency: 'ETH',
    blockExplorer: 'https://basescan.org',
    avgBlockTimeMs: 2000,
    gasTokenPriceUsd: 2500,
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    chainIdHex: 'solana', // Not EVM
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    nativeCurrency: 'SOL',
    blockExplorer: 'https://solscan.io',
    avgBlockTimeMs: 400,
    gasTokenPriceUsd: 100,
  },
};

/**
 * DEX protocol configurations
 */
export const DEX_CONFIGS: DexConfig[] = [
  // Ethereum
  {
    protocol: 'uniswap_v3',
    name: 'Uniswap V3',
    chain: 'ethereum',
    factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
    feePercent: 0.3,
    isActive: true,
  },
  {
    protocol: 'sushiswap',
    name: 'SushiSwap',
    chain: 'ethereum',
    factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
    routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/sushiswap/exchange',
    feePercent: 0.3,
    isActive: true,
  },
  
  // BSC
  {
    protocol: 'pancakeswap',
    name: 'PancakeSwap',
    chain: 'bsc',
    factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v2',
    feePercent: 0.25,
    isActive: true,
  },
  
  // Polygon
  {
    protocol: 'quickswap',
    name: 'QuickSwap',
    chain: 'polygon',
    factoryAddress: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    routerAddress: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/sameepsi/quickswap-v3',
    feePercent: 0.3,
    isActive: true,
  },
  
  // Avalanche
  {
    protocol: 'traderjoe',
    name: 'Trader Joe',
    chain: 'avalanche',
    factoryAddress: '0x9Ad6C38BE94206cA50bb0d90783181c4AaDcE8Bd',
    routerAddress: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4',
    subgraphUrl: 'https://api.thegraph.com/subgraphs/name/traderjoe-xyz/exchange',
    feePercent: 0.3,
    isActive: true,
  },
  
  // Arbitrum
  {
    protocol: 'camelot',
    name: 'Camelot',
    chain: 'arbitrum',
    factoryAddress: '0x6EcCab422D763aC031210895C81787E87B43A652',
    routerAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    feePercent: 0.3,
    isActive: true,
  },
  {
    protocol: 'sushiswap',
    name: 'SushiSwap (Arbitrum)',
    chain: 'arbitrum',
    factoryAddress: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    routerAddress: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    feePercent: 0.3,
    isActive: true,
  },
  
  // Base
  {
    protocol: 'aerodrome',
    name: 'Aerodrome',
    chain: 'base',
    factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
    routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    feePercent: 0.3,
    isActive: true,
  },
  
  // Optimism
  {
    protocol: 'velodrome',
    name: 'Velodrome',
    chain: 'optimism',
    factoryAddress: '0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746',
    routerAddress: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858',
    feePercent: 0.3,
    isActive: true,
  },
  
  // Solana
  {
    protocol: 'raydium',
    name: 'Raydium',
    chain: 'solana',
    feePercent: 0.25,
    isActive: true,
  },
  {
    protocol: 'orca',
    name: 'Orca',
    chain: 'solana',
    feePercent: 0.3,
    isActive: true,
  },
];

/**
 * API configurations for DEX data
 */
export const API_CONFIGS: Record<string, DexApiConfig> = {
  '1inch': {
    provider: '1inch',
    baseUrl: 'https://api.1inch.dev/swap/v6.0',
    rateLimit: 1, // 1 req/sec for free tier
  },
  moralis: {
    provider: 'moralis',
    baseUrl: 'https://deep-index.moralis.io/api/v2.2',
    rateLimit: 25, // 25 req/sec
  },
  thegraph: {
    provider: 'thegraph',
    baseUrl: 'https://api.thegraph.com/subgraphs/name',
    rateLimit: 5,
  },
};

/**
 * Chain ID mapping for 1inch API
 */
export const CHAIN_ID_MAP: Record<ChainId, number> = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  base: 8453,
  solana: 0, // Not supported by 1inch
};

/**
 * Common token addresses per chain
 */
export const COMMON_TOKENS: Record<ChainId, Record<string, string>> = {
  ethereum: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    DAI: '0x6B175474E89094C44Da98b954EescdeCB5BE1A85f',
  },
  bsc: {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  },
  polygon: {
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  },
  arbitrum: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  },
  optimism: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  },
  avalanche: {
    WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    USDT: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  },
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  solana: {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
};

/**
 * Top trading pairs to monitor per chain
 */
export const TOP_PAIRS: Record<ChainId, string[]> = {
  ethereum: ['WETH/USDT', 'WETH/USDC', 'WBTC/WETH', 'WETH/DAI'],
  bsc: ['WBNB/USDT', 'WBNB/BUSD', 'WBNB/USDC'],
  polygon: ['WMATIC/USDT', 'WMATIC/USDC', 'WETH/USDT'],
  arbitrum: ['WETH/USDT', 'WETH/USDC', 'WBTC/WETH'],
  optimism: ['WETH/USDT', 'WETH/USDC'],
  avalanche: ['WAVAX/USDT', 'WAVAX/USDC'],
  base: ['WETH/USDC'],
  solana: ['SOL/USDC', 'SOL/USDT'],
};

/**
 * Get active DEXes for a chain
 */
export function getActiveDexesForChain(chain: ChainId): DexConfig[] {
  return DEX_CONFIGS.filter(d => d.chain === chain && d.isActive);
}

/**
 * Get chain config by ID
 */
export function getChainConfig(chain: ChainId): ChainConfig {
  return CHAIN_CONFIGS[chain];
}

/**
 * Get all active chains
 */
export function getActiveChains(): ChainId[] {
  return Object.keys(CHAIN_CONFIGS) as ChainId[];
}

/**
 * Minimum values for DEX scanner
 */
export const DEX_SCANNER_DEFAULTS = {
  minProfitPercent: 0.3, // 0.3% minimum after fees/gas
  minLiquidityUsd: 10000, // $10k minimum pool liquidity
  maxSlippagePercent: 1.0, // 1% max slippage
  tradeSizeUsd: 500, // $500 default trade size for DEX
  scanIntervalMs: 10000, // 10 seconds between scans
  maxGasMultiplier: 1.5, // 50% buffer on gas estimates
};
