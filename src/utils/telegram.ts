/**
 * Telegram notification utility
 * Sends alerts for arbitrage opportunities meeting thresholds
 */

import { loadConfig, isTelegramConfigured } from '../config/index.js';
import { createLogger } from './logger.js';
import { nowMs } from './time.js';

const logger = createLogger('telegram');

/** Alert thresholds */
const ALERT_THRESHOLDS = {
  grossPercent: 0.05, // Alert if gross > 0.05%
  netPercent: -0.1,   // Alert if net > -0.1%
};

/** Cooldown between alerts for same route (ms) */
const ALERT_COOLDOWN_MS = 60000; // 1 minute

/** Track last alert times per route */
const lastAlertTimes = new Map<string, number>();

/** Telegram API base URL */
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Check if opportunity meets alert thresholds
 */
export function meetsAlertThreshold(grossPercent: number, netPercent: number): boolean {
  return grossPercent > ALERT_THRESHOLDS.grossPercent || netPercent > ALERT_THRESHOLDS.netPercent;
}

/**
 * Generate route key for deduplication
 */
function getRouteKey(type: string, symbol: string, buyExchange: string, sellExchange: string): string {
  return `${type}:${symbol}:${buyExchange}→${sellExchange}`;
}

/**
 * Check if we should send alert (respecting cooldown)
 */
function shouldSendAlert(routeKey: string): boolean {
  const now = nowMs();
  const lastAlert = lastAlertTimes.get(routeKey);
  
  if (lastAlert === undefined || now - lastAlert >= ALERT_COOLDOWN_MS) {
    lastAlertTimes.set(routeKey, now);
    return true;
  }
  
  return false;
}

/**
 * Format spread data for Telegram message
 */
function formatSpreadMessage(data: {
  type: 'simple' | 'triangular';
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  depthUsd?: number;
  pathDescription?: string;
  executable?: boolean;
}): string {
  const isExecutable = data.executable === true;
  const emoji = isExecutable ? '🚀 EXEC' : data.netPercent > 0 ? '�' : data.grossPercent > 0.1 ? '�' : '�';
  const typeLabel = data.type === 'triangular' ? '🔺 TRI' : '🔷 ARB';
  
  const route = data.type === 'triangular' && data.pathDescription 
    ? data.pathDescription 
    : `${data.buyExchange} → ${data.sellExchange}`;
  
  const netSign = data.netPercent >= 0 ? '+' : '';
  const grossSign = data.grossPercent >= 0 ? '+' : '';
  
  let msg = `${emoji} ${typeLabel}\n`;
  msg += `📌 ${data.symbol}\n`;
  msg += `🔄 ${route}\n`;
  msg += `📈 Gross: ${grossSign}${data.grossPercent.toFixed(3)}%\n`;
  msg += `💵 Net: ${netSign}${data.netPercent.toFixed(3)}%\n`;
  msg += `💰 ~$${data.profitUsd.toFixed(2)}`;
  
  if (data.depthUsd !== undefined && data.depthUsd > 0) {
    msg += `\n📊 Depth: $${Math.round(data.depthUsd).toLocaleString()}`;
  }
  
  return msg;
}

/**
 * Send message to Telegram
 */
async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) {
    return false;
  }
  
  const config = loadConfig();
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = config.env;
  
  if (TELEGRAM_BOT_TOKEN === undefined || TELEGRAM_CHAT_ID === undefined) {
    return false;
  }
  
  try {
    const url = `${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(
        { status: response.status, error: errorText.slice(0, 100) },
        'Telegram API error'
      );
      return false;
    }
    
    logger.debug('Telegram message sent');
    return true;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to send Telegram message'
    );
    return false;
  }
}

/**
 * Send arbitrage alert to Telegram
 * Only sends if thresholds are met and cooldown has passed
 */
export async function sendArbitrageAlert(data: {
  type: 'simple' | 'triangular';
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  grossPercent: number;
  netPercent: number;
  profitUsd: number;
  depthUsd?: number;
  pathDescription?: string;
  executable?: boolean;
}): Promise<boolean> {
  // Check thresholds
  if (!meetsAlertThreshold(data.grossPercent, data.netPercent)) {
    return false;
  }
  
  // Check cooldown
  const routeKey = getRouteKey(data.type, data.symbol, data.buyExchange, data.sellExchange);
  if (!shouldSendAlert(routeKey)) {
    return false;
  }
  
  // Format and send
  const message = formatSpreadMessage(data);
  return sendTelegramMessage(message);
}

/**
 * Send system notification to Telegram
 */
export async function sendSystemNotification(title: string, details: string): Promise<boolean> {
  if (!isTelegramConfigured()) {
    return false;
  }
  
  const message = `🔔 ${title}\n\n${details}`;
  return sendTelegramMessage(message);
}

/**
 * Get alert thresholds
 */
export function getAlertThresholds(): typeof ALERT_THRESHOLDS {
  return { ...ALERT_THRESHOLDS };
}

/**
 * Cleanup old alert times (call periodically)
 */
export function cleanupAlertTimes(): void {
  const now = nowMs();
  const maxAge = ALERT_COOLDOWN_MS * 10;
  
  for (const [key, time] of Array.from(lastAlertTimes.entries())) {
    if (now - time > maxAge) {
      lastAlertTimes.delete(key);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupAlertTimes, 300000);

logger.info(
  { 
    configured: isTelegramConfigured(),
    thresholds: ALERT_THRESHOLDS,
  },
  'Telegram notification module initialized'
);
