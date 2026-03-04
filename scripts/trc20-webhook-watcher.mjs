import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const TRONGRID_API_URL = 'https://api.trongrid.io/v1';
const USDT_TRC20_CONTRACT = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';

const env = {
  walletAddress: process.env.CRYPTO_USDT_TRC20_ADDRESS?.trim(),
  webhookSecret: process.env.CRYPTO_WEBHOOK_SECRET?.trim(),
  webhookUrl: process.env.CRYPTO_WEBHOOK_URL?.trim() || 'http://localhost:3000/api/payment/crypto/webhook',
  tronApiKey: process.env.TRONGRID_API_KEY?.trim(),
  pollMs: Number.parseInt(process.env.TRON_POLL_MS ?? '15000', 10),
  minConfirmations: Number.parseInt(process.env.TRON_MIN_CONFIRMATIONS ?? '1', 10),
};

if (!env.walletAddress) {
  console.error('[trc20-watcher] CRYPTO_USDT_TRC20_ADDRESS is required');
  process.exit(1);
}
if (!env.webhookSecret) {
  console.error('[trc20-watcher] CRYPTO_WEBHOOK_SECRET is required');
  process.exit(1);
}

const stateDir = path.resolve('.cache');
const stateFile = path.join(stateDir, 'trc20-watcher-state.json');

/**
 * @typedef {{ processed: string[] }} WatcherState
 */

/** @type {Set<string>} */
const processedTxs = new Set();
let pollTimer = null;
let isPolling = false;

async function loadState() {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    /** @type {WatcherState} */
    const parsed = JSON.parse(raw);
    for (const txHash of parsed.processed ?? []) {
      if (typeof txHash === 'string' && txHash) processedTxs.add(txHash.toLowerCase());
    }
  } catch {
    // no state yet
  }
}

async function saveState() {
  await fs.mkdir(stateDir, { recursive: true });
  const recent = Array.from(processedTxs).slice(-2000);
  await fs.writeFile(stateFile, JSON.stringify({ processed: recent }, null, 2), 'utf8');
}

function normalizeAmount(amount) {
  return Math.round(amount * 1000) / 1000;
}

function parseConfirmations(tx) {
  if (typeof tx.confirmations === 'number') return tx.confirmations;
  if (typeof tx.block_confirmations === 'number') return tx.block_confirmations;
  if (typeof tx.confirmed === 'boolean') return tx.confirmed ? 1 : 0;
  return undefined;
}

function toWebhookPayload(tx) {
  const tokenInfo = tx.token_info ?? {};
  const decimals = Number.parseInt(String(tokenInfo.decimals ?? '6'), 10);
  const rawValue = typeof tx.value === 'string' ? tx.value : String(tx.value ?? '0');
  const amount = Number(rawValue) / (10 ** (Number.isFinite(decimals) ? decimals : 6));
  return {
    txHash: String(tx.transaction_id ?? '').trim(),
    network: 'trc20',
    amount: normalizeAmount(amount),
    toAddress: String(tx.to ?? env.walletAddress),
    tokenSymbol: String(tokenInfo.symbol ?? 'USDT'),
    confirmations: parseConfirmations(tx),
  };
}

async function fetchRecentTrc20Transactions() {
  const url = new URL(`${TRONGRID_API_URL}/accounts/${env.walletAddress}/transactions/trc20`);
  url.searchParams.set('limit', '50');
  url.searchParams.set('only_to', 'true');
  url.searchParams.set('order_by', 'block_timestamp,desc');

  const headers = {};
  if (env.tronApiKey) headers['TRON-PRO-API-KEY'] = env.tronApiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TronGrid request failed ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function sendWebhook(payload) {
  const res = await fetch(env.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-crypto-webhook-secret': env.webhookSecret,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { res, json };
}

function isUsdtTrc20(tx) {
  const tokenInfo = tx.token_info ?? {};
  const symbol = String(tokenInfo.symbol ?? '').toUpperCase();
  const contract = String(tokenInfo.address ?? '').trim();
  if (symbol !== 'USDT') return false;
  if (!contract) return true;
  return contract === USDT_TRC20_CONTRACT;
}

function isIncomingToWallet(tx) {
  return String(tx.to ?? '').trim() === env.walletAddress;
}

async function pollOnce() {
  if (isPolling) return;
  isPolling = true;
  try {
    const txs = await fetchRecentTrc20Transactions();
    for (const tx of txs) {
      if (!isUsdtTrc20(tx)) continue;
      if (!isIncomingToWallet(tx)) continue;

      const txHash = String(tx.transaction_id ?? '').trim().toLowerCase();
      if (!txHash || processedTxs.has(txHash)) continue;

      const confirmations = parseConfirmations(tx);
      if (typeof confirmations === 'number' && confirmations < env.minConfirmations) {
        continue;
      }

      const payload = toWebhookPayload(tx);
      if (!payload.txHash) continue;

      console.log('[trc20-watcher] webhook ->', payload);
      const { res, json } = await sendWebhook(payload);
      console.log('[trc20-watcher] webhook <-', res.status, json);

      const terminalNoMatch =
        res.status === 400 &&
        json &&
        typeof json === 'object' &&
        String(json.error ?? '').includes('No matching pending crypto payment found');

      if (res.ok || terminalNoMatch) {
        processedTxs.add(txHash);
      }
    }

    if (processedTxs.size > 2000) {
      const keep = Array.from(processedTxs).slice(-2000);
      processedTxs.clear();
      for (const txHash of keep) processedTxs.add(txHash);
    }
    await saveState();
  } catch (err) {
    console.error('[trc20-watcher] poll error:', err instanceof Error ? err.message : err);
  } finally {
    isPolling = false;
  }
}

async function main() {
  await loadState();
  console.log('[trc20-watcher] started');
  console.log('[trc20-watcher] wallet:', env.walletAddress);
  console.log('[trc20-watcher] webhook:', env.webhookUrl);
  console.log('[trc20-watcher] pollMs:', env.pollMs);
  console.log('[trc20-watcher] minConfirmations:', env.minConfirmations);

  await pollOnce();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, Math.max(3000, env.pollMs));
}

process.on('SIGINT', async () => {
  if (pollTimer) clearInterval(pollTimer);
  await saveState();
  console.log('\n[trc20-watcher] stopped');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (pollTimer) clearInterval(pollTimer);
  await saveState();
  process.exit(0);
});

void main();
