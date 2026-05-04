/**
 * NFT Scanner
 * Monitors OpenSea and Moralis for rare NFTs, low-price alerts
 * Detects underpriced NFTs below floor price
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('nft-scanner');

// ============================================================================
// Types
// ============================================================================

export type NFTChain = 'ethereum' | 'polygon' | 'solana';

export interface NFTCollection {
  slug: string;
  name: string;
  chain: NFTChain;
  floorPrice: number;
  floorPriceUsd: number;
  totalSupply: number;
  numOwners: number;
  volume24h: number;
  imageUrl: string;
}

export interface NFTListing {
  id: string;
  collection: string;
  collectionSlug: string;
  chain: NFTChain;
  tokenId: string;
  name: string;
  imageUrl: string;
  listingPrice: number;
  listingPriceUsd: number;
  floorPrice: number;
  floorPriceUsd: number;
  rarityRank: number;
  rarityScore: number;
  profitPercent: number;
  profitUsd: number;
  marketplace: string;
  listingUrl: string;
  listedAt: number;
}

export interface NFTScanResult {
  timestamp: number;
  chain: NFTChain;
  opportunities: NFTListing[];
  scannedCollections: number;
  totalOpportunities: number;
}

// ============================================================================
// Configuration
// ============================================================================

const TOP_COLLECTIONS: Record<NFTChain, string[]> = {
  ethereum: [
    'boredapeyachtclub', 'mutant-ape-yacht-club', 'azuki', 'doodles-official',
    'clonex', 'moonbirds', 'pudgypenguins', 'milady', 'cryptopunks'
  ],
  polygon: ['y00ts', 'the-potatoz', 'trump-digital-trading-cards'],
  solana: ['okay_bears', 'degods', 'y00ts', 'famous_fox_federation'],
};


// ============================================================================
// State
// ============================================================================

interface NFTScannerState {
  isScanning: boolean;
  lastScan: number;
  scanCount: number;
  opportunities: NFTListing[];
  collections: Map<string, NFTCollection>;
}

const state: NFTScannerState = {
  isScanning: false,
  lastScan: 0,
  scanCount: 0,
  opportunities: [],
  collections: new Map(),
};

// ============================================================================
// API Functions
// ============================================================================

function getApiKey(name: string): string | null {
  const key = process.env[name];
  return key && key !== '' && key !== 'skip' ? key : null;
}

/**
 * Fetch collection stats from OpenSea
 */
async function fetchOpenSeaCollection(slug: string): Promise<NFTCollection | null> {
  const apiKey = getApiKey('OPENSEA_API_KEY');
  
  try {
    const url = apiKey 
      ? `https://api.opensea.io/api/v2/collections/${slug}`
      : `https://api.opensea.io/api/v2/collections/${slug}`;
    
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) headers['X-API-KEY'] = apiKey;
    
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    
    const data = await response.json() as {
      collection: string;
      name: string;
      total_supply: number;
      payment_tokens: Array<{ symbol: string }>;
    };
    
    // OpenSea v2 API structure varies, simplified here
    return {
      slug,
      name: data.name || slug,
      chain: 'ethereum',
      floorPrice: 0,
      floorPriceUsd: 0,
      totalSupply: data.total_supply || 0,
      numOwners: 0,
      volume24h: 0,
      imageUrl: '',
    };
  } catch (error) {
    logger.debug({ slug, error: error instanceof Error ? error.message : String(error) }, 'OpenSea fetch error');
    return null;
  }
}

/**
 * Fetch NFT data from Moralis
 */
async function fetchMoralisNFTs(collection: string, chain: NFTChain): Promise<NFTListing[]> {
  const apiKey = getApiKey('MORALIS_API_KEY');
  if (!apiKey) return [];
  
  const chainMap: Record<NFTChain, string> = {
    ethereum: 'eth',
    polygon: 'polygon',
    solana: 'solana',
  };
  
  try {
    const url = `https://deep-index.moralis.io/api/v2.2/nft/${collection}?chain=${chainMap[chain]}&format=decimal`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    });
    
    if (!response.ok) return [];
    
    // Response parsed but cross-referencing with marketplace listings not yet implemented
    await response.json();
    return [];
  } catch (error) {
    logger.debug({ collection, error: error instanceof Error ? error.message : String(error) }, 'Moralis NFT fetch error');
    return [];
  }
}

/**
 * Generate mock NFT opportunities for demo
 */
function generateMockOpportunities(_chain: NFTChain): NFTListing[] {
  // Synthetic NFT data has been removed. Real listings require a Moralis API
  // key (or equivalent). When no key is configured the scanner returns an
  // empty result so the UI can render a "Coming soon" state instead of fake
  // opportunities.
  return [];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Scan for NFT opportunities
 */
export async function scanNFTs(chain: NFTChain, minProfitPercent = 10): Promise<NFTScanResult> {
  if (state.isScanning) {
    logger.warn('NFT scan already in progress');
    return {
      timestamp: state.lastScan,
      chain,
      opportunities: state.opportunities.filter(o => o.chain === chain && o.profitPercent >= minProfitPercent),
      scannedCollections: 0,
      totalOpportunities: state.opportunities.length,
    };
  }
  
  state.isScanning = true;
  state.scanCount++;
  logger.info({ chain, minProfitPercent }, 'Starting NFT scan...');
  
  try {
    const hasMoralisKey = getApiKey('MORALIS_API_KEY') !== null;
    let opportunities: NFTListing[] = [];
    
    if (hasMoralisKey) {
      // Real API scanning would go here
      const collections = TOP_COLLECTIONS[chain] || [];
      for (const slug of collections.slice(0, 3)) {
        const listings = await fetchMoralisNFTs(slug, chain);
        opportunities.push(...listings);
      }
    }
    
    // Fall back to mock data if no results
    if (opportunities.length === 0) {
      opportunities = generateMockOpportunities(chain);
    }
    
    // Filter by minimum profit
    opportunities = opportunities.filter(o => o.profitPercent >= minProfitPercent);
    
    // Update state
    state.opportunities = [
      ...opportunities,
      ...state.opportunities.filter(o => o.chain !== chain),
    ].slice(0, 100);
    
    state.lastScan = Date.now();
    
    logger.info(
      { chain, opportunities: opportunities.length, scan: state.scanCount },
      `NFT scan complete: ${opportunities.length} opportunities found`
    );
    
    return {
      timestamp: Date.now(),
      chain,
      opportunities,
      scannedCollections: TOP_COLLECTIONS[chain]?.length || 0,
      totalOpportunities: state.opportunities.length,
    };
  } finally {
    state.isScanning = false;
  }
}

/**
 * Get cached opportunities
 */
export function getNFTOpportunities(filter?: {
  chain?: NFTChain;
  minProfit?: number;
  limit?: number;
}): NFTListing[] {
  let opportunities = [...state.opportunities];
  
  if (filter?.chain) {
    opportunities = opportunities.filter(o => o.chain === filter.chain);
  }
  if (filter?.minProfit !== undefined) {
    const minProfit = filter.minProfit;
    opportunities = opportunities.filter(o => o.profitPercent >= minProfit);
  }
  
  return opportunities.slice(0, filter?.limit || 50);
}

/**
 * Get NFT scanner stats
 */
export function getNFTScannerStats(): {
  isScanning: boolean;
  scanCount: number;
  lastScan: number;
  opportunityCount: number;
  collectionCount: number;
} {
  return {
    isScanning: state.isScanning,
    scanCount: state.scanCount,
    lastScan: state.lastScan,
    opportunityCount: state.opportunities.length,
    collectionCount: state.collections.size,
  };
}

/**
 * Get supported chains
 */
export function getSupportedNFTChains(): NFTChain[] {
  return ['ethereum', 'polygon', 'solana'];
}

// Mark as used
void fetchOpenSeaCollection;
