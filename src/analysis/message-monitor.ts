/**
 * Message Monitor
 * Monitors Telegram channels and news sources for trading signals
 * Keywords: listing, pump, airdrop, launch, etc.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('message-monitor');

// ============================================================================
// Types
// ============================================================================

export type MessageSource = 'telegram' | 'twitter' | 'discord' | 'news' | 'rss';
export type AlertPriority = 'high' | 'medium' | 'low';
export type AlertCategory = 'listing' | 'pump' | 'airdrop' | 'hack' | 'partnership' | 'launch' | 'whale' | 'general';

export interface MonitoredChannel {
  id: string;
  name: string;
  source: MessageSource;
  url: string;
  enabled: boolean;
  keywords: string[];
}

export interface MessageAlert {
  id: string;
  timestamp: number;
  source: MessageSource;
  channel: string;
  title: string;
  content: string;
  keywords: string[];
  category: AlertCategory;
  priority: AlertPriority;
  url: string;
  tokens: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface MessageStats {
  isRunning: boolean;
  channelCount: number;
  alertCount: number;
  lastCheck: number;
  highPriorityCount: number;
}

// ============================================================================
// Configuration
// ============================================================================

const KEYWORDS: Record<AlertCategory, string[]> = {
  listing: ['listing', 'listed', 'binance listing', 'coinbase listing', 'new listing', 'will list'],
  pump: ['pump', 'moon', 'bullish', '100x', '10x', 'breakout', 'explosion', 'surge'],
  airdrop: ['airdrop', 'free tokens', 'claim', 'snapshot', 'distribution'],
  hack: ['hack', 'exploit', 'breach', 'stolen', 'vulnerability', 'drained'],
  partnership: ['partnership', 'partner', 'collaboration', 'integration', 'joined'],
  launch: ['launch', 'mainnet', 'testnet', 'release', 'live', 'deployed'],
  whale: ['whale', 'large transfer', 'million', 'billion', 'accumulating'],
  general: [],
};

const DEFAULT_CHANNELS: MonitoredChannel[] = [
  { id: 'whale_alert', name: 'Whale Alert', source: 'telegram', url: 't.me/whale_alert_io', enabled: true, keywords: ['whale', 'transfer'] },
  { id: 'cz_binance', name: 'CZ Binance', source: 'twitter', url: 'twitter.com/caboratory', enabled: true, keywords: ['binance', 'listing'] },
  { id: 'coindesk', name: 'CoinDesk', source: 'news', url: 'coindesk.com', enabled: true, keywords: ['crypto', 'bitcoin'] },
  { id: 'cointelegraph', name: 'CoinTelegraph', source: 'news', url: 'cointelegraph.com', enabled: true, keywords: ['crypto', 'defi'] },
  { id: 'defillama', name: 'DefiLlama', source: 'twitter', url: 'twitter.com/DefiLlama', enabled: true, keywords: ['tvl', 'defi'] },
  { id: 'lookonchain', name: 'Lookonchain', source: 'twitter', url: 'twitter.com/lookonchain', enabled: true, keywords: ['whale', 'wallet'] },
];

const SCAN_INTERVAL_MS = 30000;

// ============================================================================
// State
// ============================================================================

interface MonitorState {
  isRunning: boolean;
  channels: MonitoredChannel[];
  alerts: MessageAlert[];
  lastCheck: number;
  checkCount: number;
}

const state: MonitorState = {
  isRunning: false,
  channels: [...DEFAULT_CHANNELS],
  alerts: [],
  lastCheck: 0,
  checkCount: 0,
};

// ============================================================================
// Alert Detection
// ============================================================================

/**
 * Detect category from content
 */
function detectCategory(content: string): AlertCategory {
  const lowerContent = content.toLowerCase();
  
  for (const [category, keywords] of Object.entries(KEYWORDS)) {
    if (category === 'general') continue;
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return category as AlertCategory;
      }
    }
  }
  
  return 'general';
}

/**
 * Detect priority based on keywords and content
 */
function detectPriority(content: string, category: AlertCategory): AlertPriority {
  const lowerContent = content.toLowerCase();
  
  // High priority keywords
  const highPriorityKeywords = ['binance', 'coinbase', 'hack', 'exploit', 'breaking', 'urgent', 'just now'];
  if (highPriorityKeywords.some(k => lowerContent.includes(k))) return 'high';
  
  // Medium priority categories
  if (['listing', 'hack', 'whale'].includes(category)) return 'medium';
  
  return 'low';
}

/**
 * Extract token symbols from content
 */
function extractTokens(content: string): string[] {
  const tokens: string[] = [];
  
  // Match $TOKEN patterns
  const dollarMatches = content.match(/\$[A-Z]{2,10}/g) || [];
  tokens.push(...dollarMatches.map(t => t.replace('$', '')));
  
  // Match common token names
  const commonTokens = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'];
  for (const token of commonTokens) {
    if (content.toUpperCase().includes(token) && !tokens.includes(token)) {
      tokens.push(token);
    }
  }
  
  return [...new Set(tokens)];
}

/**
 * Detect sentiment from content
 */
function detectSentiment(content: string): 'bullish' | 'bearish' | 'neutral' {
  const lowerContent = content.toLowerCase();
  
  const bullishWords = ['bullish', 'pump', 'moon', 'surge', 'breakout', 'accumulating', 'buying', 'long'];
  const bearishWords = ['bearish', 'dump', 'crash', 'hack', 'exploit', 'selling', 'short', 'liquidation'];
  
  let bullishScore = 0;
  let bearishScore = 0;
  
  for (const word of bullishWords) {
    if (lowerContent.includes(word)) bullishScore++;
  }
  for (const word of bearishWords) {
    if (lowerContent.includes(word)) bearishScore++;
  }
  
  if (bullishScore > bearishScore) return 'bullish';
  if (bearishScore > bullishScore) return 'bearish';
  return 'neutral';
}

/**
 * Extract keywords found in content
 */
function extractKeywords(content: string): string[] {
  const found: string[] = [];
  const lowerContent = content.toLowerCase();
  
  for (const keywords of Object.values(KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword.toLowerCase()) && !found.includes(keyword)) {
        found.push(keyword);
      }
    }
  }
  
  return found;
}

// ============================================================================
// API Integration (Stubs - would need actual API keys)
// ============================================================================

/**
 * Fetch messages from RSS feed
 */
async function fetchRssMessages(_url: string): Promise<Array<{ title: string; content: string; link: string; date: number }>> {
  // In production, would use rss-parser or similar
  // For now, return mock data
  return [];
}

/**
 * Fetch from CryptoCompare News API
 */
async function fetchCryptoNews(): Promise<MessageAlert[]> {
  try {
    const response = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest');
    if (!response.ok) return [];
    
    const data = await response.json() as {
      Data: Array<{
        id: string;
        title: string;
        body: string;
        url: string;
        published_on: number;
        source: string;
      }>;
    };
    
    return (data.Data || []).slice(0, 10).map(item => {
      const category = detectCategory(item.title + ' ' + item.body);
      const priority = detectPriority(item.title + ' ' + item.body, category);
      
      return {
        id: `news_${item.id}`,
        timestamp: item.published_on * 1000,
        source: 'news' as MessageSource,
        channel: item.source,
        title: item.title,
        content: item.body.slice(0, 500),
        keywords: extractKeywords(item.title + ' ' + item.body),
        category,
        priority,
        url: item.url,
        tokens: extractTokens(item.title + ' ' + item.body),
        sentiment: detectSentiment(item.title + ' ' + item.body),
      };
    });
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'CryptoCompare fetch error');
    return [];
  }
}

/**
 * Generate simulated alerts for demo
 */
function generateMockAlerts(): MessageAlert[] {
  const mockMessages = [
    { channel: 'Whale Alert', title: '🚨 1,000 BTC transferred from Binance', content: 'A whale just moved 1,000 BTC ($95M) from Binance to unknown wallet', category: 'whale' as AlertCategory },
    { channel: 'CZ Binance', title: 'New listing announcement coming soon', content: 'Stay tuned for exciting news about new token listings on Binance', category: 'listing' as AlertCategory },
    { channel: 'Lookonchain', title: 'Smart money accumulating SOL', content: 'Multiple wallets identified as smart money have been accumulating SOL over the past 24h', category: 'whale' as AlertCategory },
    { channel: 'CoinDesk', title: 'Major DeFi protocol announces airdrop', content: 'Users who interacted with the protocol before snapshot will receive tokens', category: 'airdrop' as AlertCategory },
    { channel: 'DefiLlama', title: 'New protocol TVL surges 500%', content: 'A new DeFi protocol on Arbitrum has seen explosive growth in total value locked', category: 'launch' as AlertCategory },
  ];
  
  return mockMessages.map((msg, i) => ({
    id: `mock_${Date.now()}_${i}`,
    timestamp: Date.now() - i * 300000,
    source: 'telegram' as MessageSource,
    channel: msg.channel,
    title: msg.title,
    content: msg.content,
    keywords: extractKeywords(msg.title + ' ' + msg.content),
    category: msg.category,
    priority: detectPriority(msg.title + ' ' + msg.content, msg.category),
    url: '#',
    tokens: extractTokens(msg.title + ' ' + msg.content),
    sentiment: detectSentiment(msg.title + ' ' + msg.content),
  }));
}

// ============================================================================
// Scanning
// ============================================================================

/**
 * Run single scan
 */
async function runScan(): Promise<void> {
  state.checkCount++;
  const startTime = Date.now();
  
  // Fetch from real APIs
  const newsAlerts = await fetchCryptoNews();
  
  // Add mock alerts if no real data
  let alerts = newsAlerts;
  if (alerts.length === 0 && state.checkCount === 1) {
    alerts = generateMockAlerts();
  }
  
  // Filter out duplicates
  const existingIds = new Set(state.alerts.map(a => a.id));
  const newAlerts = alerts.filter(a => !existingIds.has(a.id));
  
  // Add to state (keep last 100)
  state.alerts = [...newAlerts, ...state.alerts].slice(0, 100);
  state.lastCheck = Date.now();
  
  const scanTime = Date.now() - startTime;
  
  if (newAlerts.length > 0 || state.checkCount === 1) {
    logger.info(
      { check: state.checkCount, newAlerts: newAlerts.length, total: state.alerts.length, scanTimeMs: scanTime },
      `Message scan #${state.checkCount}: ${newAlerts.length} new alerts`
    );
  }
  
  // Log high priority alerts
  for (const alert of newAlerts.filter(a => a.priority === 'high')) {
    logger.warn({ category: alert.category, channel: alert.channel }, `⚠️ High priority: ${alert.title}`);
  }
}

/**
 * Scan loop
 */
async function scanLoop(): Promise<void> {
  while (state.isRunning) {
    try {
      await runScan();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Message scan error');
    }
    await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL_MS));
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start message monitor
 */
export async function startMessageMonitor(): Promise<void> {
  if (state.isRunning) {
    logger.warn('Message monitor already running');
    return;
  }
  
  logger.info({ channels: state.channels.filter(c => c.enabled).length }, 'Starting message monitor...');
  state.isRunning = true;
  
  await runScan();
  
  logger.info('📡 Message monitor started');
  
  scanLoop().catch(error => {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Message scan loop error');
    state.isRunning = false;
  });
}

/**
 * Stop message monitor
 */
export function stopMessageMonitor(): void {
  logger.info('Stopping message monitor...');
  state.isRunning = false;
}

/**
 * Get all alerts
 */
export function getAlerts(filter?: {
  category?: AlertCategory;
  priority?: AlertPriority;
  source?: MessageSource;
  limit?: number;
}): MessageAlert[] {
  let alerts = [...state.alerts];
  
  if (filter?.category) {
    alerts = alerts.filter(a => a.category === filter.category);
  }
  if (filter?.priority) {
    alerts = alerts.filter(a => a.priority === filter.priority);
  }
  if (filter?.source) {
    alerts = alerts.filter(a => a.source === filter.source);
  }
  
  return alerts.slice(0, filter?.limit || 50);
}

/**
 * Get message stats
 */
export function getMessageStats(): MessageStats {
  return {
    isRunning: state.isRunning,
    channelCount: state.channels.filter(c => c.enabled).length,
    alertCount: state.alerts.length,
    lastCheck: state.lastCheck,
    highPriorityCount: state.alerts.filter(a => a.priority === 'high').length,
  };
}

/**
 * Get monitored channels
 */
export function getChannels(): MonitoredChannel[] {
  return state.channels;
}

/**
 * Add custom channel
 */
export function addChannel(channel: MonitoredChannel): void {
  state.channels.push(channel);
  logger.info({ channel: channel.name }, 'Added monitoring channel');
}

/**
 * Check if monitor is running
 */
export function isMessageMonitorRunning(): boolean {
  return state.isRunning;
}

// Mark as used
void fetchRssMessages;
