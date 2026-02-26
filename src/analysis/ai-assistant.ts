/**
 * AI Assistant — OpenAI GPT-4o-mini with retry logic
 * Injects top-5 spreads, deposit size, scanner stats into every prompt.
 * 3x retry with exponential backoff on 429/5xx.
 */

import { createLogger } from '../utils/logger.js';
import { getDashboardStore } from '../dashboard/store.js';
import { getFundingArbitrages, getFundingStats } from './funding-rates.js';

const logger = createLogger('ai-assistant');

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActivity: number;
}

export interface AIResponse {
  content: string;
  tokensUsed?: number | undefined;
  model?: string | undefined;
  error?: string | undefined;
  /** Seconds to wait before retry (set on 429) */
  retryAfter?: number | undefined;
  /** True when all retries are exhausted */
  rateLimited?: boolean | undefined;
}

type AIProvider = 'openai' | 'none';

// ============================================================================
// Configuration
// ============================================================================

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

const SYSTEM_PROMPT = `You are an expert crypto arbitrage assistant for Right Order scanner.
Analyze spreads, funding rates, futures basis, P2P opportunities.
Give precise profit calculations including fees and the user's deposit size.
Be direct, use tables when helpful.

You have access to real-time data (injected below each message):
- CEX cross-exchange spreads (simple + triangular)
- Funding rate arbitrage (perp vs spot)
- Futures basis arbitrage (spot vs futures)
- Statistical arbitrage (Z-score mean-reversion)
- Pairs trading (cointegrated pairs)
- P2P arbitrage (fiat on/off-ramp spreads)

Rules:
1. When showing profit, always deduct trading fees (~0.1% per trade) and network fees.
2. Use the user's deposit size for profit-in-$ calculations.
3. Warn about risks: slippage, withdrawal delays, KYC limits.
4. Format with Markdown: tables, bold, bullet points.
5. If data is missing, say so — never invent numbers.`;

// ============================================================================
// State
// ============================================================================

const sessions: Map<string, ChatSession> = new Map();
let activeProvider: AIProvider = 'none';

// ============================================================================
// API Key Management
// ============================================================================

function getOpenAIApiKey(): string | null {
  const key = process.env['OPENAI_API_KEY'];
  return key && key !== '' && key !== 'your_key' ? key : null;
}

function detectProvider(): AIProvider {
  if (getOpenAIApiKey()) {
    logger.info('AI Assistant using OpenAI API (gpt-4o-mini)');
    return 'openai';
  }
  logger.warn('No OPENAI_API_KEY found - AI chat will not work');
  return 'none';
}

// ============================================================================
// Context Building — ALWAYS injected, not conditional
// ============================================================================

function buildContext(): string {
  const store = getDashboardStore();
  const parts: string[] = [];

  // Top 5 spreads (always)
  try {
    const allSpreads = store.getSpreads();
    const sorted = [...allSpreads].sort((a, b) => b.netPercent - a.netPercent).slice(0, 5);
    if (sorted.length > 0) {
      parts.push('## Top 5 Current Spreads');
      parts.push('| Symbol | Buy@Exchange | Sell@Exchange | BuyPrice | SellPrice | Net% | Profit$ |');
      parts.push('|--------|-------------|--------------|----------|-----------|------|---------|');
      for (const s of sorted) {
        const route = s.type === 'triangular' ? (s.pathDescription ?? s.symbol) : s.symbol;
        parts.push(`| ${route} | ${s.buyExchange} | ${s.sellExchange} | ${(s.buyPrice ?? 0).toFixed(4)} | ${(s.sellPrice ?? 0).toFixed(4)} | ${s.netPercent.toFixed(3)}% | $${s.profitUsd.toFixed(2)} |`);
      }
    } else {
      parts.push('No active spreads currently.');
    }
  } catch { /* store may not be ready */ }

  // Funding arb top 3
  try {
    const arbs = getFundingArbitrages().filter(a => a.annualizedSpread >= 5).slice(0, 3);
    if (arbs.length > 0) {
      parts.push('\n## Top Funding Rate Arbs');
      parts.push('| Symbol | Long@Exchange | Short@Exchange | APY% |');
      parts.push('|--------|--------------|----------------|------|');
      for (const f of arbs) {
        parts.push(`| ${f.symbol} | ${f.longExchange} | ${f.shortExchange} | ${f.annualizedSpread.toFixed(1)}% |`);
      }
    }
    const fStats = getFundingStats();
    if (fStats.arbCount > 0) parts.push(`Funding: ${fStats.arbCount} arb opportunities`);
  } catch { /* funding may not be running */ }

  // Scanner stats
  try {
    const stats = store.getStats();
    parts.push(`\n## Scanner Stats`);
    parts.push(`Exchanges: ${stats.connectedExchanges}/${stats.totalExchanges} | Symbols: ${stats.activeSymbols instanceof Set ? stats.activeSymbols.size : stats.activeSymbols} | Spreads: ${stats.uniqueSpreads} | Best Net: ${stats.bestNetPercent.toFixed(3)}% | Uptime: ${Math.floor(stats.uptime / 60)}m`);
  } catch { /* */ }

  // User deposit size (default 1000)
  parts.push(`\nUser deposit size: $1000 (default)`);

  return parts.join('\n');
}

// ============================================================================
// API Call with Retry
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOpenAIAPI(messages: ChatMessage[], context: string): Promise<AIResponse> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return { content: '', error: 'OpenAI API key not configured' };
  }

  // Only keep last 10 user/assistant messages to save tokens
  const trimmed = messages.slice(-10);

  const apiMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT + '\n\n---\n## LIVE DATA (auto-injected)\n' + context },
    ...trimmed.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: apiMessages,
          max_tokens: 1500,
          temperature: 0.6,
        }),
      });

      // Rate limit — retry with backoff
      if (response.status === 429) {
        const retryHeader = response.headers.get('retry-after');
        const waitMs = RETRY_DELAYS_MS[attempt] ?? 8_000;
        logger.warn({ attempt: attempt + 1, waitMs, retryHeader }, 'OpenAI 429 rate limited, retrying');
        if (attempt < MAX_RETRIES - 1) {
          await sleep(waitMs);
          continue;
        }
        // Final attempt — tell frontend to show retry UI
        return {
          content: '',
          error: 'OpenAI rate limit reached. Please wait ~60 seconds and try again.',
          rateLimited: true,
          retryAfter: 60,
        };
      }

      // Server errors — retry
      if (response.status >= 500) {
        logger.warn({ status: response.status, attempt: attempt + 1 }, 'OpenAI server error, retrying');
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAYS_MS[attempt] ?? 4_000);
          continue;
        }
        return { content: '', error: `OpenAI server error: ${response.status}` };
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'OpenAI API error');
        return { content: '', error: `OpenAI API error: ${response.status}` };
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { total_tokens: number };
      };

      return {
        content: data.choices[0]?.message?.content || 'No response from OpenAI',
        tokensUsed: data.usage?.total_tokens,
        model: MODEL,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, attempt: attempt + 1 }, 'OpenAI API call failed');
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 4_000);
        continue;
      }
      return { content: '', error: errorMsg };
    }
  }

  return { content: '', error: 'All retry attempts exhausted' };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the AI assistant
 */
export function initAIAssistant(): void {
  activeProvider = detectProvider();
  logger.info({ provider: activeProvider }, 'AI Assistant initialized');
}

/**
 * Get or create a chat session
 */
export function getOrCreateSession(sessionId?: string): ChatSession {
  const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  let session = sessions.get(id);
  if (!session) {
    session = {
      id,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    sessions.set(id, session);
    logger.debug({ sessionId: id }, 'Created new chat session');
  }
  
  return session;
}

/**
 * Send a message and get AI response
 */
export async function chat(query: string, sessionId?: string): Promise<AIResponse & { sessionId: string }> {
  const session = getOrCreateSession(sessionId);
  
  // Add user message
  session.messages.push({
    role: 'user',
    content: query,
    timestamp: Date.now(),
  });
  session.lastActivity = Date.now();
  
  // Build context from current data (always, not conditional on query)
  const context = buildContext();
  
  // Get AI response - OpenAI only
  let response: AIResponse;
  
  if (activeProvider === 'openai') {
    response = await callOpenAIAPI(session.messages, context);
  } else {
    response = {
      content: '**AI not configured.** Please set OPENAI_API_KEY in your .env file to enable AI chat.\n\nExample: `OPENAI_API_KEY=sk-...`',
      error: 'No API key configured',
    };
  }
  
  // If API error, build user-facing message but preserve rateLimited/retryAfter
  if (response.error && activeProvider === 'openai') {
    logger.error({ error: response.error, rateLimited: response.rateLimited }, 'OpenAI API call failed');
    const errorContent = response.rateLimited
      ? `**Rate limit reached.** OpenAI is throttling requests. Please wait ~${response.retryAfter ?? 60}s and try again.`
      : `**AI Error:** ${response.error}\n\nPlease check your OPENAI_API_KEY and try again.`;
    response = {
      ...response,
      content: errorContent,
    };
  }
  
  // Add assistant response to session (only if we got content)
  if (response.content) {
    session.messages.push({
      role: 'assistant',
      content: response.content,
      timestamp: Date.now(),
    });
  }
  
  // Keep session size manageable (last 20 messages)
  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }
  
  logger.info(
    { sessionId: session.id, provider: response.model, tokensUsed: response.tokensUsed },
    'AI chat response generated'
  );
  
  return { ...response, sessionId: session.id };
}

/**
 * Get chat history for a session
 */
export function getChatHistory(sessionId: string): ChatMessage[] {
  const session = sessions.get(sessionId);
  return session?.messages || [];
}

/**
 * Clear a chat session
 */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
  logger.debug({ sessionId }, 'Chat session cleared');
}

/**
 * Get AI assistant status
 */
export function getAIStatus(): {
  provider: AIProvider;
  hasOpenAIKey: boolean;
  activeSessions: number;
  isConfigured: boolean;
} {
  return {
    provider: activeProvider,
    hasOpenAIKey: getOpenAIApiKey() !== null,
    activeSessions: sessions.size,
    isConfigured: activeProvider === 'openai',
  };
}

/**
 * Get current AI provider
 */
export function getAIProvider(): AIProvider {
  return activeProvider;
}
