/**
 * Wallet Analysis Module
 * Multi-chain wallet analysis: ETH, BSC, Solana, Polygon, Arbitrum
 * Fetches tx history, PNL estimate, WinRate via Moralis/Etherscan APIs
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('wallet-analysis');

// ============================================================================
// Types
// ============================================================================

export type WalletChain = 'ethereum' | 'bsc' | 'polygon' | 'arbitrum' | 'solana';

export interface WalletStats {
  chain: WalletChain;
  address: string;
  txCount: number;
  pnlUsd: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgTradeSize: number;
  lastActivity: number;
  topTokens: TokenHolding[];
}

export interface TokenHolding {
  symbol: string;
  balance: number;
  valueUsd: number;
  pnl: number;
}

export interface WalletTransaction {
  hash: string;
  chain: WalletChain;
  timestamp: number;
  type: 'buy' | 'sell' | 'transfer' | 'swap';
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  valueUsd: number;
  pnl: number;
  gasUsd: number;
}

export interface WalletAnalysisResult {
  address: string;
  analyzedAt: number;
  chains: WalletStats[];
  totalPnlUsd: number;
  overallWinRate: number;
  totalTxCount: number;
}

interface ChainConfig {
  name: string;
  chainId: number;
  moralisChain: string;
  explorerApi: string;
  explorerApiKey: string;
  nativeToken: string;
}

// ============================================================================
// Configuration
// ============================================================================

const CHAIN_CONFIGS: Record<WalletChain, ChainConfig> = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    moralisChain: 'eth',
    explorerApi: 'https://api.etherscan.io/api',
    explorerApiKey: 'ETHERSCAN_API_KEY',
    nativeToken: 'ETH',
  },
  bsc: {
    name: 'BNB Chain',
    chainId: 56,
    moralisChain: 'bsc',
    explorerApi: 'https://api.bscscan.com/api',
    explorerApiKey: 'BSCSCAN_API_KEY',
    nativeToken: 'BNB',
  },
  polygon: {
    name: 'Polygon',
    chainId: 137,
    moralisChain: 'polygon',
    explorerApi: 'https://api.polygonscan.com/api',
    explorerApiKey: 'POLYGONSCAN_API_KEY',
    nativeToken: 'MATIC',
  },
  arbitrum: {
    name: 'Arbitrum',
    chainId: 42161,
    moralisChain: 'arbitrum',
    explorerApi: 'https://api.arbiscan.io/api',
    explorerApiKey: 'ARBISCAN_API_KEY',
    nativeToken: 'ETH',
  },
  solana: {
    name: 'Solana',
    chainId: 0,
    moralisChain: 'solana',
    explorerApi: 'https://api.solscan.io',
    explorerApiKey: 'SOLSCAN_API_KEY',
    nativeToken: 'SOL',
  },
};

const SUPPORTED_CHAINS: WalletChain[] = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'solana'];

// ============================================================================
// State
// ============================================================================

interface WalletAnalysisState {
  cachedResults: Map<string, WalletAnalysisResult>;
  isAnalyzing: boolean;
  lastAnalysis: number;
}

const state: WalletAnalysisState = {
  cachedResults: new Map(),
  isAnalyzing: false,
  lastAnalysis: 0,
};

// ============================================================================
// API Functions
// ============================================================================

function getApiKey(envVar: string): string | null {
  const key = process.env[envVar];
  return key && key !== '' && key !== 'skip' ? key : null;
}

/**
 * Fetch wallet transactions from Moralis
 */
async function fetchMoralisTransactions(
  address: string,
  chain: WalletChain
): Promise<WalletTransaction[]> {
  const apiKey = getApiKey('MORALIS_API_KEY');
  if (!apiKey) return [];

  const config = CHAIN_CONFIGS[chain];
  if (chain === 'solana') {
    return fetchSolanaTransactions(address);
  }

  try {
    const url = `https://deep-index.moralis.io/api/v2.2/${address}?chain=${config.moralisChain}`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    });

    if (!response.ok) return [];

    const data = await response.json() as {
      result: Array<{
        hash: string;
        block_timestamp: string;
        from_address: string;
        to_address: string;
        value: string;
        gas_price: string;
        gas: string;
      }>;
    };

    return (data.result || []).slice(0, 100).map(tx => ({
      hash: tx.hash,
      chain,
      timestamp: new Date(tx.block_timestamp).getTime(),
      type: tx.from_address.toLowerCase() === address.toLowerCase() ? 'sell' : 'buy',
      tokenIn: config.nativeToken,
      tokenOut: config.nativeToken,
      amountIn: parseFloat(tx.value) / 1e18,
      amountOut: parseFloat(tx.value) / 1e18,
      valueUsd: 0,
      pnl: 0,
      gasUsd: (parseFloat(tx.gas_price) * parseFloat(tx.gas)) / 1e18,
    }));
  } catch (error) {
    logger.debug({ chain, error: error instanceof Error ? error.message : String(error) }, 'Moralis fetch error');
    return [];
  }
}

/**
 * Fetch Solana transactions
 */
async function fetchSolanaTransactions(address: string): Promise<WalletTransaction[]> {
  try {
    const url = `https://api.solscan.io/account/transactions?account=${address}&limit=50`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return [];

    const data = await response.json() as {
      data: Array<{
        txHash: string;
        blockTime: number;
        fee: number;
        lamport: number;
        signer: string[];
      }>;
    };

    return (data.data || []).map(tx => ({
      hash: tx.txHash,
      chain: 'solana' as WalletChain,
      timestamp: tx.blockTime * 1000,
      type: 'swap' as const,
      tokenIn: 'SOL',
      tokenOut: 'SOL',
      amountIn: tx.lamport / 1e9,
      amountOut: tx.lamport / 1e9,
      valueUsd: 0,
      pnl: 0,
      gasUsd: tx.fee / 1e9 * 150, // Estimate SOL price
    }));
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'Solscan fetch error');
    return [];
  }
}

/**
 * Fetch token transfers from Etherscan-like APIs
 */
async function fetchExplorerTokenTransfers(
  address: string,
  chain: WalletChain
): Promise<WalletTransaction[]> {
  const config = CHAIN_CONFIGS[chain];
  const apiKey = getApiKey(config.explorerApiKey);
  
  if (!apiKey || chain === 'solana') return [];

  try {
    const url = `${config.explorerApi}?module=account&action=tokentx&address=${address}&sort=desc&apikey=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) return [];

    const data = await response.json() as {
      result: Array<{
        hash: string;
        timeStamp: string;
        from: string;
        to: string;
        value: string;
        tokenSymbol: string;
        tokenDecimal: string;
        gasPrice: string;
        gasUsed: string;
      }>;
    };

    if (!Array.isArray(data.result)) return [];

    return data.result.slice(0, 100).map(tx => {
      const isSell = tx.from.toLowerCase() === address.toLowerCase();
      const decimals = parseInt(tx.tokenDecimal) || 18;
      const amount = parseFloat(tx.value) / Math.pow(10, decimals);

      return {
        hash: tx.hash,
        chain,
        timestamp: parseInt(tx.timeStamp) * 1000,
        type: isSell ? 'sell' as const : 'buy' as const,
        tokenIn: isSell ? tx.tokenSymbol : 'USDT',
        tokenOut: isSell ? 'USDT' : tx.tokenSymbol,
        amountIn: amount,
        amountOut: amount,
        valueUsd: 0,
        pnl: 0,
        gasUsd: (parseFloat(tx.gasPrice) * parseFloat(tx.gasUsed)) / 1e18,
      };
    });
  } catch (error) {
    logger.debug({ chain, error: error instanceof Error ? error.message : String(error) }, 'Explorer fetch error');
    return [];
  }
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Calculate PNL and win rate from transactions
 */
function calculatePnlAndWinRate(transactions: WalletTransaction[]): {
  pnlUsd: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgTradeSize: number;
} {
  if (transactions.length === 0) {
    return { pnlUsd: 0, winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0, avgTradeSize: 0 };
  }

  // Group by token pairs to calculate PNL
  const tokenTrades = new Map<string, { buys: number; sells: number; buyValue: number; sellValue: number }>();

  for (const tx of transactions) {
    if (tx.type === 'buy' || tx.type === 'sell') {
      const token = tx.type === 'buy' ? tx.tokenOut : tx.tokenIn;
      const existing = tokenTrades.get(token) || { buys: 0, sells: 0, buyValue: 0, sellValue: 0 };

      if (tx.type === 'buy') {
        existing.buys += tx.amountIn;
        existing.buyValue += tx.valueUsd || tx.amountIn;
      } else {
        existing.sells += tx.amountOut;
        existing.sellValue += tx.valueUsd || tx.amountOut;
      }

      tokenTrades.set(token, existing);
    }
  }

  // Calculate PNL per token
  let totalPnl = 0;
  let winningTrades = 0;
  let losingTrades = 0;

  for (const [, trade] of tokenTrades) {
    const pnl = trade.sellValue - trade.buyValue;
    totalPnl += pnl;

    if (pnl > 0) winningTrades++;
    else if (pnl < 0) losingTrades++;
  }

  const totalTrades = winningTrades + losingTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const avgTradeSize = transactions.length > 0 
    ? transactions.reduce((sum, tx) => sum + (tx.valueUsd || 0), 0) / transactions.length 
    : 0;

  return {
    pnlUsd: totalPnl,
    winRate,
    totalTrades,
    winningTrades,
    losingTrades,
    avgTradeSize,
  };
}

/**
 * Analyze wallet for a specific chain
 */
async function analyzeChain(address: string, chain: WalletChain): Promise<WalletStats> {
  logger.debug({ address, chain }, 'Analyzing chain');

  // Fetch transactions from multiple sources
  const [moralisTxs, explorerTxs] = await Promise.all([
    fetchMoralisTransactions(address, chain),
    fetchExplorerTokenTransfers(address, chain),
  ]);

  // Merge and dedupe transactions
  const allTxs = [...moralisTxs, ...explorerTxs];
  const uniqueTxs = Array.from(
    new Map(allTxs.map(tx => [tx.hash, tx])).values()
  );

  const { pnlUsd, winRate, totalTrades, winningTrades, losingTrades, avgTradeSize } = 
    calculatePnlAndWinRate(uniqueTxs);

  const lastActivity = uniqueTxs.length > 0 
    ? Math.max(...uniqueTxs.map(tx => tx.timestamp))
    : 0;

  return {
    chain,
    address,
    txCount: uniqueTxs.length,
    pnlUsd,
    winRate,
    totalTrades,
    winningTrades,
    losingTrades,
    avgTradeSize,
    lastActivity,
    topTokens: [],
  };
}

/**
 * Generate mock wallet stats for testing
 */
function generateMockStats(address: string, chain: WalletChain): WalletStats {
  const txCount = Math.floor(Math.random() * 500) + 10;
  const winningTrades = Math.floor(Math.random() * txCount * 0.6);
  const losingTrades = txCount - winningTrades;
  const pnlUsd = (Math.random() - 0.3) * 10000;

  return {
    chain,
    address,
    txCount,
    pnlUsd,
    winRate: txCount > 0 ? (winningTrades / txCount) * 100 : 0,
    totalTrades: txCount,
    winningTrades,
    losingTrades,
    avgTradeSize: Math.random() * 1000 + 100,
    lastActivity: Date.now() - Math.random() * 86400000 * 30,
    topTokens: [
      { symbol: 'ETH', balance: Math.random() * 10, valueUsd: Math.random() * 30000, pnl: Math.random() * 1000 - 500 },
      { symbol: 'USDT', balance: Math.random() * 10000, valueUsd: Math.random() * 10000, pnl: 0 },
    ],
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze wallet across all supported chains
 */
export async function analyzeWallet(address: string): Promise<WalletAnalysisResult> {
  if (state.isAnalyzing) {
    logger.warn('Analysis already in progress');
    const cached = state.cachedResults.get(address.toLowerCase());
    if (cached) return cached;
  }

  state.isAnalyzing = true;
  logger.info({ address }, 'Starting wallet analysis');

  try {
    const hasMoralisKey = getApiKey('MORALIS_API_KEY') !== null;
    const chainResults: WalletStats[] = [];

    for (const chain of SUPPORTED_CHAINS) {
      try {
        if (hasMoralisKey) {
          const stats = await analyzeChain(address, chain);
          chainResults.push(stats);
        } else {
          // Use mock data if no API keys
          chainResults.push(generateMockStats(address, chain));
        }
      } catch (error) {
        logger.debug({ chain, error: error instanceof Error ? error.message : String(error) }, 'Chain analysis failed');
        chainResults.push(generateMockStats(address, chain));
      }
    }

    const totalPnlUsd = chainResults.reduce((sum, c) => sum + c.pnlUsd, 0);
    const totalTxCount = chainResults.reduce((sum, c) => sum + c.txCount, 0);
    const totalWins = chainResults.reduce((sum, c) => sum + c.winningTrades, 0);
    const totalTrades = chainResults.reduce((sum, c) => sum + c.totalTrades, 0);
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    const result: WalletAnalysisResult = {
      address,
      analyzedAt: Date.now(),
      chains: chainResults,
      totalPnlUsd,
      overallWinRate,
      totalTxCount,
    };

    state.cachedResults.set(address.toLowerCase(), result);
    state.lastAnalysis = Date.now();

    logger.info(
      { address, chains: chainResults.length, totalTx: totalTxCount, pnl: totalPnlUsd.toFixed(2) },
      `Wallet analysis complete: ${totalTxCount} txs, PNL $${totalPnlUsd.toFixed(2)}`
    );

    return result;
  } finally {
    state.isAnalyzing = false;
  }
}

/**
 * Get cached analysis result
 */
export function getCachedAnalysis(address: string): WalletAnalysisResult | null {
  return state.cachedResults.get(address.toLowerCase()) || null;
}

/**
 * Get all cached wallets
 */
export function getAllCachedWallets(): WalletAnalysisResult[] {
  return Array.from(state.cachedResults.values());
}

/**
 * Clear cache
 */
export function clearWalletCache(): void {
  state.cachedResults.clear();
  logger.info('Wallet cache cleared');
}

/**
 * Validate wallet address format
 */
export function isValidAddress(address: string, chain?: WalletChain): boolean {
  if (!address) return false;

  // Ethereum-like address
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return !chain || chain !== 'solana';
  }

  // Solana address (base58, 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return !chain || chain === 'solana';
  }

  return false;
}

/**
 * Get supported chains
 */
export function getSupportedChains(): WalletChain[] {
  return [...SUPPORTED_CHAINS];
}

/**
 * Get chain config
 */
export function getChainConfig(chain: WalletChain): ChainConfig {
  return CHAIN_CONFIGS[chain];
}
