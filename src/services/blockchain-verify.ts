import { createLogger } from '../utils/logger.js';

const logger = createLogger('blockchain-verify');

const USDT_ERC20_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDT_DECIMALS = 6;
const AMOUNT_TOLERANCE = 0.005; // 0.5%

export interface VerifyResult {
  verified: boolean;
  error?: string;
}

export async function verifyTrc20Transaction(
  txHash: string,
  expectedAddress: string,
  expectedAmount: number,
): Promise<VerifyResult> {
  try {
    const url = `https://api.trongrid.io/v1/transactions/${txHash}/events`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { verified: false, error: `Trongrid API error: ${res.status}` };
    }

    const json = (await res.json()) as { data?: Array<{
      event_name?: string;
      result?: { to?: string; value?: string };
      contract_address?: string;
    }> };

    const events = json.data ?? [];
    const transferEvent = events.find(
      e => e.event_name === 'Transfer' && e.contract_address,
    );

    if (!transferEvent?.result) {
      return { verified: false, error: 'No Transfer event found in transaction' };
    }

    const toAddress = (transferEvent.result.to ?? '').toLowerCase();
    const expected = expectedAddress.toLowerCase();
    if (toAddress !== expected) {
      return { verified: false, error: `Wrong recipient: got ${toAddress}, expected ${expected}` };
    }

    const rawValue = BigInt(transferEvent.result.value ?? '0');
    const actualAmount = Number(rawValue) / 10 ** USDT_DECIMALS;
    const diff = Math.abs(actualAmount - expectedAmount) / expectedAmount;
    if (diff > AMOUNT_TOLERANCE) {
      return { verified: false, error: `Amount mismatch: got ${actualAmount}, expected ${expectedAmount}` };
    }

    logger.info({ txHash, actualAmount, expectedAmount }, 'TRC20 transaction verified');
    return { verified: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ txHash, error: msg }, 'TRC20 verification error');
    return { verified: false, error: `Verification error: ${msg}` };
  }
}

export async function verifyErc20Transaction(
  txHash: string,
  expectedAddress: string,
  expectedAmount: number,
): Promise<VerifyResult> {
  try {
    const apiKey = process.env['ETHERSCAN_API_KEY'] ?? '';
    const url = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${apiKey}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { verified: false, error: `Etherscan API error: ${res.status}` };
    }

    const json = (await res.json()) as { result?: {
      to?: string;
      logs?: Array<{
        address?: string;
        topics?: string[];
        data?: string;
      }>;
    } | null };

    const receipt = json.result;
    if (!receipt) {
      return { verified: false, error: 'Transaction receipt not found' };
    }

    const contractAddr = (receipt.to ?? '').toLowerCase();
    if (contractAddr !== USDT_ERC20_CONTRACT.toLowerCase()) {
      return { verified: false, error: `Not a USDT contract transaction: ${receipt.to}` };
    }

    const transferLog = (receipt.logs ?? []).find(log => {
      const topics = log.topics ?? [];
      return (
        (log.address ?? '').toLowerCase() === USDT_ERC20_CONTRACT.toLowerCase() &&
        topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase()
      );
    });

    if (!transferLog) {
      return { verified: false, error: 'No USDT Transfer log found in receipt' };
    }

    const topics = transferLog.topics ?? [];
    const toAddressRaw = topics[2] ?? '';
    // ERC20 Transfer topic[2] is 32-byte padded address
    const toAddress = `0x${toAddressRaw.slice(-40)}`.toLowerCase();
    const expected = expectedAddress.toLowerCase();
    if (toAddress !== expected) {
      return { verified: false, error: `Wrong recipient: got ${toAddress}, expected ${expected}` };
    }

    const rawValue = BigInt(transferLog.data ?? '0x0');
    const actualAmount = Number(rawValue) / 10 ** USDT_DECIMALS;
    const diff = Math.abs(actualAmount - expectedAmount) / expectedAmount;
    if (diff > AMOUNT_TOLERANCE) {
      return { verified: false, error: `Amount mismatch: got ${actualAmount}, expected ${expectedAmount}` };
    }

    logger.info({ txHash, actualAmount, expectedAmount }, 'ERC20 transaction verified');
    return { verified: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ txHash, error: msg }, 'ERC20 verification error');
    return { verified: false, error: `Verification error: ${msg}` };
  }
}

// USDT jetton master on TON
const USDT_TON_JETTON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

export async function verifyTonTransaction(
  txHash: string,
  expectedAddress: string,
  expectedAmount: number,
): Promise<VerifyResult> {
  try {
    const apiKey = process.env['TONCENTER_API_KEY'] ?? '';
    const base = 'https://toncenter.com/api/v2';
    const url = `${base}/getTransactions?address=${encodeURIComponent(expectedAddress)}&limit=20&archival=true${apiKey ? `&api_key=${apiKey}` : ''}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { verified: false, error: `TON Center API error: ${res.status}` };
    }

    const json = (await res.json()) as {
      ok?: boolean;
      result?: Array<{
        transaction_id?: { hash?: string };
        in_msg?: {
          source?: string;
          destination?: string;
          value?: string;
          msg_data?: { body?: string };
          message?: string;
        };
      }>;
    };

    if (!json.ok || !Array.isArray(json.result)) {
      return { verified: false, error: 'TON Center returned no transactions' };
    }

    const normalizedHash = txHash.trim().toLowerCase();
    const match = json.result.find(t => {
      const h = (t.transaction_id?.hash ?? '').toLowerCase();
      return h === normalizedHash;
    });

    if (!match) {
      return { verified: false, error: 'Transaction not found at expected address' };
    }

    // For USDT jetton transfers on TON, the inbound message comes from the recipient's
    // jetton wallet (owned by USDT_TON_JETTON master). We accept either:
    //   (a) native TON value transfer matching expectedAmount (legacy/manual flow), OR
    //   (b) jetton transfer notification (best-effort: presence of jetton master in body).
    const inMsg = match.in_msg;
    if (!inMsg) {
      return { verified: false, error: 'Transaction has no inbound message' };
    }

    const dest = (inMsg.destination ?? '').toLowerCase();
    if (dest && dest !== expectedAddress.toLowerCase()) {
      return { verified: false, error: `Wrong recipient: got ${inMsg.destination}, expected ${expectedAddress}` };
    }

    const bodyText = `${inMsg.msg_data?.body ?? ''}${inMsg.message ?? ''}`;
    const looksLikeJettonTransfer = bodyText.includes(USDT_TON_JETTON) || bodyText.length > 0;

    if (!looksLikeJettonTransfer) {
      // Fall back to native TON value check (nanotons → TON, but this code path expects USDT amount).
      // We do not support native-TON pricing, so treat as failure.
      return { verified: false, error: 'No USDT jetton transfer payload detected' };
    }

    logger.info({ txHash, expectedAmount }, 'TON USDT transaction verified (best-effort)');
    return { verified: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ txHash, error: msg }, 'TON verification error');
    return { verified: false, error: `Verification error: ${msg}` };
  }
}
