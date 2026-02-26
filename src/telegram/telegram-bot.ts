/**
 * Telegram Bot Alerts
 * Uses a single global bot token from .env (TELEGRAM_BOT_TOKEN)
 * Each user only provides their Telegram chatId
 * Sends alerts for: CEX spreads (net > 1%), Funding Arb (APY > 10%), Futures Arb (APY > 5%), P2P Arb (spread > 1%)
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('telegram-bot');

// ============================================================================
// Types
// ============================================================================

export interface UserTelegramConfig {
  userId: string;
  chatId: string;
  enabled: boolean;
  minNetPercent: number;
  createdAt: number;
  lastAlertAt: number;
  alertsSent: number;
}

export interface TelegramSetupResult {
  success: boolean;
  error?: string;
  config?: SafeTelegramConfig;
}

export interface SafeTelegramConfig {
  chatId: string;
  enabled: boolean;
  minNetPercent: number;
  alertsSent: number;
  lastAlertAt: number;
  botConnected: boolean;
}

export interface SpreadAlert {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  netPercent: number;
  grossPercent: number;
  profitUsd: number;
  buyPrice: number;
  sellPrice: number;
  depositUsd?: number;
  ageMs?: number;
  confidence?: number;
}

export interface FundingArbAlert {
  symbol: string;
  longExchange: string;
  shortExchange: string;
  spreadRate: number;
  annualizedSpread: number;
  dailyProfit: number;
  confidence: number;
}

export interface FuturesArbAlert {
  symbol: string;
  exchange: string;
  spotPrice: number;
  futuresPrice: number;
  basisPercent: number;
  combinedApy: number;
  regime: string;
  direction: string;
  confidence: number;
}

export interface P2PAlert {
  symbol: string;
  fiatCurrency: string;
  p2pPlatform: string;
  cexPlatform: string;
  p2pPrice: number;
  cexPrice: number;
  spreadPercent: number;
  profitUsd: number;
  direction: string;
  hops: number;
  hopPath: string[];
  confidence: number;
}

// ============================================================================
// State
// ============================================================================

const configs = new Map<string, UserTelegramConfig>();

/** Cooldown between alerts per user (5 minutes) */
const USER_COOLDOWN_MS = 300_000;

/** Cooldown per route key to avoid duplicate alerts (5 minutes) */
const ROUTE_COOLDOWN_MS = 300_000;

/** Track last alert time per route */
const lastRouteAlertTimes = new Map<string, number>();

/** Default minimum net % for CEX spread alerts */
const DEFAULT_MIN_NET = 1.0;

/** Dashboard base URL for alert links */
const DASHBOARD_URL = 'https://rightorder.app/dashboard';

// ============================================================================
// Global Bot Token
// ============================================================================

function getBotToken(): string | undefined {
  return process.env['TELEGRAM_BOT_TOKEN'];
}

function isBotConfigured(): boolean {
  const token = getBotToken();
  return token !== undefined && token.length > 10;
}

// ============================================================================
// Helpers
// ============================================================================

function toSafeConfig(cfg: UserTelegramConfig): SafeTelegramConfig {
  return {
    chatId: cfg.chatId,
    enabled: cfg.enabled,
    minNetPercent: cfg.minNetPercent,
    alertsSent: cfg.alertsSent,
    lastAlertAt: cfg.lastAlertAt,
    botConnected: isBotConfigured(),
  };
}

function canSendToUser(config: UserTelegramConfig, now: number): boolean {
  if (!config.enabled || !config.chatId) return false;
  if (now - config.lastAlertAt < USER_COOLDOWN_MS) return false;
  return true;
}

function isRouteCooledDown(routeKey: string, now: number): boolean {
  const last = lastRouteAlertTimes.get(routeKey);
  if (last !== undefined && now - last < ROUTE_COOLDOWN_MS) return false;
  return true;
}

function formatPrice(price: number): string {
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Setup Telegram alerts for a user — only requires chatId
 * Bot token comes from .env
 */
export function setupTelegram(
  userId: string,
  chatId: string,
  minNetPercent?: number
): TelegramSetupResult {
  if (!isBotConfigured()) {
    return { success: false, error: 'Telegram bot not configured on server (TELEGRAM_BOT_TOKEN missing in .env)' };
  }
  if (!chatId || chatId.trim().length === 0) {
    return { success: false, error: 'Chat ID is required. Message @userinfobot on Telegram to get your ID.' };
  }

  const trimmedChatId = chatId.trim();
  const existing = configs.get(userId);
  const config: UserTelegramConfig = {
    userId,
    chatId: trimmedChatId,
    enabled: true,
    minNetPercent: minNetPercent ?? existing?.minNetPercent ?? DEFAULT_MIN_NET,
    createdAt: existing?.createdAt ?? Date.now(),
    lastAlertAt: existing?.lastAlertAt ?? 0,
    alertsSent: existing?.alertsSent ?? 0,
  };

  configs.set(userId, config);
  logger.info({ userId, chatId: trimmedChatId }, 'Telegram chatId saved');

  return { success: true, config: toSafeConfig(config) };
}

/**
 * Get Telegram status for a user
 */
export function getTelegramStatus(userId: string): TelegramSetupResult {
  const config = configs.get(userId);
  if (!config) {
    return { success: true, config: { chatId: '', enabled: false, minNetPercent: DEFAULT_MIN_NET, alertsSent: 0, lastAlertAt: 0, botConnected: isBotConfigured() } };
  }
  return { success: true, config: toSafeConfig(config) };
}

/**
 * Enable/disable Telegram alerts
 */
export function toggleTelegram(userId: string, enabled: boolean): TelegramSetupResult {
  const config = configs.get(userId);
  if (!config) {
    return { success: false, error: 'Telegram not configured. Save your Chat ID first.' };
  }
  config.enabled = enabled;
  logger.info({ userId, enabled }, 'Telegram alerts toggled');
  return { success: true, config: toSafeConfig(config) };
}

/**
 * Update minimum net % threshold
 */
export function updateMinNet(userId: string, minNetPercent: number): TelegramSetupResult {
  const config = configs.get(userId);
  if (!config) {
    return { success: false, error: 'Telegram not configured' };
  }
  config.minNetPercent = minNetPercent;
  logger.info({ userId, minNetPercent }, 'Telegram min net % updated');
  return { success: true, config: toSafeConfig(config) };
}

/**
 * Send a test message to verify bot + chatId work
 */
export async function sendTestMessage(userId: string): Promise<{ success: boolean; error?: string }> {
  const botToken = getBotToken();
  if (!botToken) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN not set in .env' };
  }

  const config = configs.get(userId);
  if (!config || !config.chatId) {
    return { success: false, error: 'No Chat ID saved. Enter your Chat ID first.' };
  }

  const text = [
    `✅ *Right Order — Test Alert*`,
    ``,
    `Bot connected and working!`,
    `Chat ID: \`${config.chatId}\``,
    `Min CEX spread: ${config.minNetPercent}%`,
    ``,
    `You will receive alerts for:`,
    `• CEX Spreads: net > ${config.minNetPercent}%`,
    `• Funding Arb: APY > 10%`,
    `• Futures Arb: combined APY > 5%`,
    `• P2P Arb: spread > 1% (direct) / > 3% (multi-hop)`,
    ``,
    `🔗 [Open Dashboard](${DASHBOARD_URL})`,
  ].join('\n');

  return sendTelegramMessage(botToken, config.chatId, text);
}

// ============================================================================
// Alert Processing
// ============================================================================

/**
 * Process CEX spread alert — sends when net > user's minNetPercent (default 1%)
 */
export async function processSpreadAlert(alert: SpreadAlert): Promise<void> {
  const botToken = getBotToken();
  if (!botToken) return;
  const now = Date.now();

  const routeKey = `spread:${alert.symbol}:${alert.buyExchange}:${alert.sellExchange}`;
  if (!isRouteCooledDown(routeKey, now)) return;

  for (const [_userId, config] of configs) {
    if (!canSendToUser(config, now)) continue;
    if (alert.netPercent < config.minNetPercent) continue;

    const deposit = alert.depositUsd ?? 1000;
    const profit = (alert.netPercent / 100) * deposit;
    const ageSec = alert.ageMs !== undefined ? Math.floor(alert.ageMs / 1000) : 0;
    const conf = alert.confidence !== undefined ? Math.round(alert.confidence * 100) : 0;

    const text = [
      `🚨 *Alert: ${alert.symbol}*`,
      `Net: *${alert.netPercent.toFixed(2)}%* | Profit: *$${profit.toFixed(2)}* (Deposit $${deposit})`,
      `Buy: ${alert.buyExchange} @ ${formatPrice(alert.buyPrice)} | Sell: ${alert.sellExchange} @ ${formatPrice(alert.sellPrice)}`,
      `Age: ${ageSec}s | Confidence: ${conf}%`,
      ``,
      `🔗 [Open Dashboard](${DASHBOARD_URL})`,
    ].join('\n');

    const result = await sendTelegramMessage(botToken, config.chatId, text);
    if (result.success) {
      config.lastAlertAt = now;
      config.alertsSent++;
      lastRouteAlertTimes.set(routeKey, now);
      logger.info({ userId: config.userId, symbol: alert.symbol, net: alert.netPercent.toFixed(2) }, 'Spread alert sent to Telegram');
    } else {
      logger.warn({ userId: config.userId, chatId: config.chatId, error: result.error }, 'Failed to send spread alert');
    }
  }
}

/**
 * Process Funding Arb alert — sends when APY > 10%
 */
export async function processFundingAlert(alert: FundingArbAlert): Promise<void> {
  const botToken = getBotToken();
  if (!botToken) return;
  const now = Date.now();
  const apy = alert.annualizedSpread ?? 0;
  if (apy < 10) return;

  const routeKey = `funding:${alert.symbol}:${alert.longExchange}:${alert.shortExchange}`;
  if (!isRouteCooledDown(routeKey, now)) return;

  for (const [_userId, config] of configs) {
    if (!canSendToUser(config, now)) continue;

    const conf = alert.confidence !== undefined ? Math.round(alert.confidence * 100) : 0;
    const text = [
      `💰 *Funding Arb: ${alert.symbol}*`,
      `APY: *${apy.toFixed(1)}%* | Daily: *$${(alert.dailyProfit ?? 0).toFixed(2)}*`,
      `Long: ${alert.longExchange} | Short: ${alert.shortExchange}`,
      `Spread: ${((alert.spreadRate ?? 0) * 100).toFixed(4)}% per 8h`,
      `Confidence: ${conf}%`,
      ``,
      `🔗 [Open Dashboard](${DASHBOARD_URL})`,
    ].join('\n');

    const result = await sendTelegramMessage(botToken, config.chatId, text);
    if (result.success) {
      config.lastAlertAt = now;
      config.alertsSent++;
      lastRouteAlertTimes.set(routeKey, now);
      logger.info({ userId: config.userId, symbol: alert.symbol, apy: apy.toFixed(1) }, 'Funding arb alert sent to Telegram');
    }
  }
}

/**
 * Process Futures Arb alert — sends when combined APY > 5%
 */
export async function processFuturesAlert(alert: FuturesArbAlert): Promise<void> {
  const botToken = getBotToken();
  if (!botToken) return;
  const now = Date.now();
  const apy = alert.combinedApy ?? 0;
  if (Math.abs(apy) < 5) return;

  const routeKey = `futures:${alert.symbol}:${alert.exchange}`;
  if (!isRouteCooledDown(routeKey, now)) return;

  for (const [_userId, config] of configs) {
    if (!canSendToUser(config, now)) continue;

    const dir = alert.direction === 'short_basis' ? 'Sell Futures / Buy Spot' : 'Buy Futures / Sell Spot';
    const conf = alert.confidence !== undefined ? Math.round(alert.confidence * 100) : 0;
    const text = [
      `📈 *Futures Arb: ${alert.symbol}* (${alert.exchange ?? 'N/A'})`,
      `Combined APY: *${apy.toFixed(1)}%* | Basis: ${(alert.basisPercent ?? 0).toFixed(4)}%`,
      `Spot: $${formatPrice(alert.spotPrice ?? 0)} | Futures: $${formatPrice(alert.futuresPrice ?? 0)}`,
      `Regime: ${(alert.regime ?? 'N/A').toUpperCase()} | ${dir}`,
      `Confidence: ${conf}%`,
      ``,
      `🔗 [Open Dashboard](${DASHBOARD_URL})`,
    ].join('\n');

    const result = await sendTelegramMessage(botToken, config.chatId, text);
    if (result.success) {
      config.lastAlertAt = now;
      config.alertsSent++;
      lastRouteAlertTimes.set(routeKey, now);
      logger.info({ userId: config.userId, symbol: alert.symbol, apy: apy.toFixed(1) }, 'Futures arb alert sent to Telegram');
    }
  }
}

/**
 * Process P2P Arb alert — sends when spread > 1% (simple) or > 3% (multi-hop)
 */
export async function processP2PAlert(alert: P2PAlert): Promise<void> {
  const botToken = getBotToken();
  if (!botToken) return;
  const now = Date.now();

  const threshold = alert.hops > 1 ? 3.0 : 1.0;
  if (alert.spreadPercent < threshold) return;

  const routeKey = `p2p:${alert.p2pPlatform}:${alert.fiatCurrency}:${alert.cexPlatform}`;
  if (!isRouteCooledDown(routeKey, now)) return;

  for (const [_userId, config] of configs) {
    if (!canSendToUser(config, now)) continue;

    const hopLabel = alert.hops > 1 ? `Multi-hop (${alert.hops} exchanges)` : 'Direct';
    const pathStr = alert.hopPath.map(p => p.replace(/_/g, ' ')).join(' → ');
    const conf = Math.round(alert.confidence * 100);

    const text = [
      `🔄 *P2P Alert: ${alert.symbol}*`,
      `Spread: *${alert.spreadPercent.toFixed(2)}%* | Profit: *$${alert.profitUsd.toFixed(2)}*`,
      `P2P: ${alert.p2pPlatform.replace(/_/g, ' ')} @ ${alert.p2pPrice.toFixed(2)} ${alert.fiatCurrency}`,
      `CEX: ${alert.cexPlatform} @ ${alert.cexPrice.toFixed(2)} ${alert.fiatCurrency}`,
      `Type: ${hopLabel} | Path: ${pathStr}`,
      `Confidence: ${conf}%`,
      ``,
      `🔗 [Open Dashboard](${DASHBOARD_URL})`,
    ].join('\n');

    const result = await sendTelegramMessage(botToken, config.chatId, text);
    if (result.success) {
      config.lastAlertAt = now;
      config.alertsSent++;
      lastRouteAlertTimes.set(routeKey, now);
      logger.info({ userId: config.userId, symbol: alert.symbol, spread: alert.spreadPercent.toFixed(2), hops: alert.hops }, 'P2P alert sent to Telegram');
    }
  }
}

// ============================================================================
// Low-level Telegram API
// ============================================================================

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  if (!botToken || !chatId) {
    return { success: false, error: 'Missing bot token or chat ID' };
  }
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    const json = await res.json() as { ok: boolean; description?: string; error_code?: number };
    if (!json.ok) {
      const errMsg = json.description ?? 'Telegram API error';
      // Handle specific error codes
      if (json.error_code === 403) {
        logger.warn({ chatId }, 'Bot blocked by user or invalid chat ID');
        return { success: false, error: 'Bot is blocked by user. Unblock the bot in Telegram.' };
      }
      if (json.error_code === 400) {
        logger.warn({ chatId, description: json.description }, 'Invalid chat ID');
        return { success: false, error: 'Invalid Chat ID. Message @userinfobot to get your correct ID.' };
      }
      logger.warn({ chatId, errorCode: json.error_code, description: json.description }, 'Telegram API error');
      return { success: false, error: errMsg };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'Telegram send failed');
    return { success: false, error: msg };
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/** Cleanup stale route cooldown entries every 10 minutes */
setInterval(() => {
  const now = Date.now();
  const maxAge = ROUTE_COOLDOWN_MS * 5;
  for (const [key, time] of Array.from(lastRouteAlertTimes.entries())) {
    if (now - time > maxAge) lastRouteAlertTimes.delete(key);
  }
}, 600_000);

logger.info({ botConfigured: isBotConfigured() }, 'Telegram alert module initialized');
