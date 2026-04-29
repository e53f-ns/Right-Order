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
