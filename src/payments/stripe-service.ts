/**
 * Stripe payment service — checkout sessions, webhooks, auto-upgrade
 * Also includes crypto payment stubs for USDT TRC20/ERC20
 */

import Stripe from 'stripe';
import crypto from 'crypto';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import { isValidTxHashFormat } from '../security/validators.js';
import type { SubscriptionPlan as PrismaSubPlan, PaymentMethod as PrismaPaymentMethod } from '../generated/prisma/client.js';

const logger = createLogger('payments');

// ============================================================================
// Types
// ============================================================================

export type BillingPeriod = 'monthly' | 'yearly';

export interface CreateCheckoutResult {
  success: boolean;
  url?: string;
  sessionId?: string;
  error?: string;
}

export interface CryptoPaymentResult {
  success: boolean;
  paymentId?: string;
  address?: string;
  amount?: number;
  currency?: string;
  network?: 'TRC20' | 'ERC20';
  expiresAt?: number;
  error?: string;
}

export interface CryptoWebhookPayload {
  txHash?: string;
  network?: 'trc20' | 'erc20' | 'TRC20' | 'ERC20';
  amount?: number | string;
  toAddress?: string;
  tokenSymbol?: string;
  confirmations?: number;
  paymentId?: string;
}

// ============================================================================
// Plan price mapping
// ============================================================================

const PLAN_PRICES: Record<string, Record<BillingPeriod, number>> = {
  pro:      { monthly: 39,  yearly: 349 },
  elite:    { monthly: 89,  yearly: 799 },
  ultimate: { monthly: 199, yearly: 1799 },
};

const PAYMENT_IDEMPOTENCY_WINDOW_MS = 15 * 60 * 1000;
const CRYPTO_AMOUNT_DECIMALS = 3;
const CRYPTO_MATCH_TOLERANCE = 0.0005;
const TRONGRID_API_URL = 'https://api.trongrid.io/v1';
const USDT_TRC20_CONTRACT = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const TRON_MIN_CONFIRMATIONS = Number.parseInt(process.env['TRON_MIN_CONFIRMATIONS'] ?? '1', 10);
const TRONGRID_API_KEY = process.env['TRONGRID_API_KEY']?.trim();

// ============================================================================
// Stripe client (lazy init — only if key is configured)
// ============================================================================

let stripeClient: Stripe | null = null;

function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key || key === 'sk_test_PLACEHOLDER') {
    logger.warn('Stripe secret key not configured — payment processing disabled');
    return null;
  }
  stripeClient = new Stripe(key);
  logger.info('Stripe client initialized');
  return stripeClient;
}

function normalizeTxHash(txHash: string): string {
  return txHash.trim().toLowerCase();
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function roundCryptoAmount(amount: number): number {
  return Math.round(amount * 10 ** CRYPTO_AMOUNT_DECIMALS) / 10 ** CRYPTO_AMOUNT_DECIMALS;
}

function createUniqueCryptoInvoiceAmount(baseAmount: number): number {
  const suffix = Math.floor(Math.random() * 899) + 1; // 0.001..0.899
  return roundCryptoAmount(baseAmount + suffix / 1000);
}

interface Trc20TransferEvent {
  event_name?: string;
  contract_address?: string;
  result?: Record<string, unknown>;
  block_number?: number;
}

function parseEventAmountUsdt(event: Trc20TransferEvent): number | null {
  const result = event.result;
  if (!result) return null;
  const raw = result['value'] ?? result['_value'] ?? result['amount'] ?? result['2'];
  if (raw === undefined) return null;
  const rawNum = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(rawNum) || rawNum <= 0) return null;
  return rawNum / 1_000_000;
}

function parseEventToAddress(event: Trc20TransferEvent): string | null {
  const result = event.result;
  if (!result) return null;
  const value = result['to'] ?? result['_to'] ?? result['1'];
  if (value === undefined) return null;
  const address = String(value).trim();
  return address || null;
}

async function getLatestTronBlockNumber(): Promise<number | null> {
  try {
    const headers: Record<string, string> = {};
    if (TRONGRID_API_KEY) {
      headers['TRON-PRO-API-KEY'] = TRONGRID_API_KEY;
    }
    const res = await fetch(`${TRONGRID_API_URL}/blocks/latest`, { headers });
    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, 'Failed to fetch latest Tron block');
      return null;
    }
    const json = await res.json() as {
      data?: Array<{ block_header?: { raw_data?: { number?: number } } }>;
    };
    const number = json.data?.[0]?.block_header?.raw_data?.number;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
  } catch (err: unknown) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to fetch latest Tron block');
    return null;
  }
}

async function verifyTrc20UsdtPaymentOnChain(
  txHash: string,
  expectedToAddress: string,
  expectedAmount: number,
): Promise<{ success: boolean; error?: string; confirmations?: number }> {
  const headers: Record<string, string> = {};
  if (TRONGRID_API_KEY) {
    headers['TRON-PRO-API-KEY'] = TRONGRID_API_KEY;
  }

  try {
    const res = await fetch(`${TRONGRID_API_URL}/transactions/${txHash}/events`, { headers });
    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, txHash }, 'TronGrid tx events request failed');
      return { success: false, error: 'Unable to verify transaction on-chain (TronGrid unavailable)' };
    }

    const json = await res.json() as { data?: Trc20TransferEvent[] };
    const events = Array.isArray(json.data) ? json.data : [];
    if (events.length === 0) {
      return { success: false, error: 'Transaction not found on-chain or has no transfer events yet' };
    }

    const normalizedExpectedAddress = normalizeAddress(expectedToAddress);
    const matchingTransfer = events.find(event => {
      if (event.event_name !== 'Transfer') return false;
      const contract = String(event.contract_address ?? '').trim();
      if (contract !== USDT_TRC20_CONTRACT) return false;
      const toAddress = parseEventToAddress(event);
      if (!toAddress) return false;
      return normalizeAddress(toAddress) === normalizedExpectedAddress;
    });

    if (!matchingTransfer) {
      return { success: false, error: 'On-chain transfer recipient does not match payment address' };
    }

    const amount = parseEventAmountUsdt(matchingTransfer);
    if (amount === null) {
      return { success: false, error: 'Unable to parse on-chain transfer amount' };
    }

    if (Math.abs(roundCryptoAmount(amount) - roundCryptoAmount(expectedAmount)) > CRYPTO_MATCH_TOLERANCE) {
      return {
        success: false,
        error: `On-chain transfer amount mismatch (expected ${roundCryptoAmount(expectedAmount)}, got ${roundCryptoAmount(amount)})`,
      };
    }

    const latestBlock = await getLatestTronBlockNumber();
    const txBlock = matchingTransfer.block_number;
    let confirmations: number | undefined;
    if (typeof latestBlock === 'number' && typeof txBlock === 'number') {
      confirmations = Math.max(0, latestBlock - txBlock + 1);
      if (confirmations < TRON_MIN_CONFIRMATIONS) {
        return {
          success: false,
          error: `Transaction has ${confirmations} confirmations, waiting for ${TRON_MIN_CONFIRMATIONS}`,
          confirmations,
        };
      }
    }

    const verifiedResult: { success: boolean; error?: string; confirmations?: number } = { success: true };
    if (typeof confirmations === 'number') {
      verifiedResult.confirmations = confirmations;
    }
    return verifiedResult;
  } catch (err: unknown) {
    logger.error({ txHash, error: err instanceof Error ? err.message : String(err) }, 'TRC20 verification failed');
    return { success: false, error: 'On-chain verification failed' };
  }
}

// ============================================================================
// Stripe Checkout
// ============================================================================

export async function createCheckoutSession(
  userId: string,
  email: string,
  plan: string,
  billing: BillingPeriod,
  successUrl: string,
  cancelUrl: string,
  idempotencyKey?: string,
): Promise<CreateCheckoutResult> {
  const stripe = getStripe();
  if (!stripe) {
    return { success: false, error: 'Stripe not configured. Use crypto payment or contact support.' };
  }

  const prices = PLAN_PRICES[plan];
  if (!prices) {
    return { success: false, error: `Invalid plan: ${plan}` };
  }

  const amount = prices[billing];
  const description = `Right Order ${plan.charAt(0).toUpperCase() + plan.slice(1)} — ${billing}`;
  const recentSince = new Date(Date.now() - PAYMENT_IDEMPOTENCY_WINDOW_MS);

  try {
    const existingPending = await prisma.payment.findFirst({
      where: {
        userId,
        plan: plan as PrismaSubPlan,
        billing,
        method: 'stripe' as PrismaPaymentMethod,
        status: 'pending',
        createdAt: { gte: recentSince },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending?.stripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(existingPending.stripeSessionId);
      if (existingSession.url) {
        logger.info(
          { userId, plan, billing, paymentId: existingPending.id, sessionId: existingPending.stripeSessionId },
          'Reusing existing pending Stripe checkout session'
        );
        return { success: true, sessionId: existingPending.stripeSessionId, url: existingSession.url };
      }
    }

    // Ensure Stripe customer exists
    let user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
    let customerId = user?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: description },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        metadata: { userId, plan, billing },
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    // Create pending payment record
    const paymentCreateData: {
      userId: string;
      plan: PrismaSubPlan;
      billing: BillingPeriod;
      amount: number;
      currency: string;
      method: PrismaPaymentMethod;
      status: 'pending';
      stripeSessionId: string;
      metadata?: { checkoutUrl: string; idempotencyKey: string | null };
    } = {
      userId,
      plan: plan as PrismaSubPlan,
      billing,
      amount,
      currency: 'USD',
      method: 'stripe' as PrismaPaymentMethod,
      status: 'pending',
      stripeSessionId: session.id,
    };
    if (session.url) {
      paymentCreateData.metadata = { checkoutUrl: session.url, idempotencyKey: idempotencyKey ?? null };
    }
    await prisma.payment.create({ data: paymentCreateData });

    logger.info({ userId, plan, billing, amount, sessionId: session.id }, 'Stripe checkout session created');

    const result: CreateCheckoutResult = { success: true, sessionId: session.id };
    if (session.url) result.url = session.url;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ userId, plan, billing, idempotencyKey, error: msg, stack: err instanceof Error ? err.stack : undefined }, 'Failed to create Stripe checkout session');
    return { success: false, error: msg };
  }
}

// ============================================================================
// Stripe Webhook handler
// ============================================================================

export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string,
): Promise<{ success: boolean; error?: string }> {
  const stripe = getStripe();
  if (!stripe) return { success: false, error: 'Stripe not configured' };

  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!webhookSecret || webhookSecret === 'whsec_PLACEHOLDER') {
    return { success: false, error: 'Webhook secret not configured' };
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'Stripe webhook signature verification failed');
    return { success: false, error: `Webhook signature failed: ${msg}` };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    await processSuccessfulPayment(session);
  }

  return { success: true };
}

async function processSuccessfulPayment(session: Stripe.Checkout.Session): Promise<void> {
  const { userId, plan, billing } = (session.metadata ?? {}) as Record<string, string>;
  if (!userId || !plan) {
    logger.error({ sessionId: session.id }, 'Stripe webhook missing userId/plan metadata');
    return;
  }

  try {
    const existing = await prisma.payment.findFirst({
      where: { stripeSessionId: session.id },
      select: { id: true, status: true },
    });
    if (existing?.status === 'completed') {
      logger.info({ sessionId: session.id, paymentId: existing.id }, 'Skipping duplicate Stripe webhook for completed payment');
      return;
    }

    // Update payment record
    const txId = typeof session.payment_intent === 'string' ? session.payment_intent : undefined;
    const updateData: Record<string, unknown> = { status: 'completed', completedAt: new Date() };
    if (txId) updateData['transactionId'] = txId;
    await prisma.payment.updateMany({
      where: { stripeSessionId: session.id },
      data: updateData as { status: 'completed'; completedAt: Date; transactionId?: string },
    });

    // Calculate expiry
    const expiresAt = new Date();
    if (billing === 'yearly') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    // Upgrade user subscription
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscription: plan as PrismaSubPlan,
        subscriptionExpiresAt: expiresAt,
      },
    });

    logger.info({ userId, plan, billing, sessionId: session.id }, 'Subscription upgraded via Stripe payment');
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err), sessionId: session.id }, 'Failed to process Stripe payment');
  }
}

// ============================================================================
// Crypto payment (stub — manual confirmation)
// ============================================================================

export async function createCryptoPayment(
  userId: string,
  plan: string,
  billing: BillingPeriod,
  network: 'trc20' | 'erc20',
  idempotencyKey?: string,
): Promise<CryptoPaymentResult> {
  const prices = PLAN_PRICES[plan];
  if (!prices) {
    return { success: false, error: `Invalid plan: ${plan}` };
  }

  const baseAmount = prices[billing];
  const envKey = network === 'trc20' ? 'CRYPTO_USDT_TRC20_ADDRESS' : 'CRYPTO_USDT_ERC20_ADDRESS';
  const address = process.env[envKey];

  if (!address) {
    return { success: false, error: `${network.toUpperCase()} USDT address not configured` };
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 2); // 2 hour window

  const method: PrismaPaymentMethod = network === 'trc20' ? 'crypto_usdt_trc20' : 'crypto_usdt_erc20';
  const recentSince = new Date(Date.now() - PAYMENT_IDEMPOTENCY_WINDOW_MS);

  try {
    const existingPending = await prisma.payment.findFirst({
      where: {
        userId,
        plan: plan as PrismaSubPlan,
        billing,
        method,
        status: 'pending',
        createdAt: { gte: recentSince },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      logger.info({ userId, plan, billing, network, paymentId: existingPending.id }, 'Reusing existing pending crypto payment');
      const reused: CryptoPaymentResult = {
        success: true,
        paymentId: existingPending.id,
        address: existingPending.cryptoAddress ?? address,
        amount: existingPending.amount,
        currency: existingPending.currency,
        network: network === 'trc20' ? 'TRC20' : 'ERC20',
      };
      if (existingPending.expiresAt) {
        reused.expiresAt = existingPending.expiresAt.getTime();
      }
      return reused;
    }

    const invoiceAmount = createUniqueCryptoInvoiceAmount(baseAmount);
    const payment = await prisma.payment.create({
      data: {
        userId,
        plan: plan as PrismaSubPlan,
        billing,
        amount: invoiceAmount,
        currency: 'USDT',
        method,
        status: 'pending',
        cryptoAddress: address,
        transactionId: `crypto_${crypto.randomBytes(16).toString('hex')}`,
        expiresAt,
        metadata: { idempotencyKey: idempotencyKey ?? null, baseAmount, invoiceAmount },
      },
    });

    logger.info({ userId, plan, billing, amount: invoiceAmount, baseAmount, network, paymentId: payment.id }, 'Crypto payment created');

    return {
      success: true,
      paymentId: payment.id,
      address,
      amount: invoiceAmount,
      currency: 'USDT',
      network: network === 'trc20' ? 'TRC20' : 'ERC20',
      expiresAt: expiresAt.getTime(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ userId, plan, billing, network, idempotencyKey, error: msg, stack: err instanceof Error ? err.stack : undefined }, 'Failed to create crypto payment');
    return { success: false, error: msg };
  }
}

export async function confirmCryptoPayment(
  paymentId: string,
  txHash: string,
  adminUserId: string,
): Promise<{ success: boolean; error?: string }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return { success: false, error: 'Payment not found' };
  }
  if (payment.status !== 'pending') {
    return { success: false, error: `Payment already ${payment.status}` };
  }

  await completeCryptoPayment(payment, txHash);

  logger.info({ paymentId, txHash, userId: payment.userId, plan: payment.plan, confirmedBy: adminUserId }, 'Crypto payment confirmed, subscription upgraded');

  return { success: true };
}

export async function autoConfirmCryptoPaymentFromWebhook(
  payload: CryptoWebhookPayload,
): Promise<{ success: boolean; error?: string; paymentId?: string; alreadyProcessed?: boolean }> {
  const txHashRaw = payload.txHash?.trim();
  const networkRaw = payload.network?.toString().trim().toLowerCase();
  const amountRaw = typeof payload.amount === 'string' ? Number.parseFloat(payload.amount) : payload.amount;
  const toAddressRaw = payload.toAddress?.trim();
  const paymentId = payload.paymentId?.trim();

  if (!txHashRaw) return { success: false, error: 'txHash is required' };
  if (!isValidTxHashFormat(txHashRaw)) return { success: false, error: 'Invalid txHash format' };
  const txHash = normalizeTxHash(txHashRaw);

  const existingByTx = await prisma.payment.findFirst({
    where: { cryptoTxHash: txHash },
    select: { id: true, status: true },
  });
  if (existingByTx) {
    const alreadyProcessedResult: { success: boolean; paymentId?: string; alreadyProcessed?: boolean; error?: string } = {
      success: true,
      paymentId: existingByTx.id,
      alreadyProcessed: true,
    };
    if (existingByTx.status !== 'completed') {
      alreadyProcessedResult.error = `Payment already ${existingByTx.status}`;
    }
    return alreadyProcessedResult;
  }

  let payment = paymentId
    ? await prisma.payment.findUnique({ where: { id: paymentId } })
    : null;

  if (!payment) {
    if (!networkRaw || !['trc20', 'erc20'].includes(networkRaw)) {
      return { success: false, error: 'network is required (trc20|erc20) when paymentId is not provided' };
    }
    if (typeof amountRaw !== 'number' || !Number.isFinite(amountRaw) || amountRaw <= 0) {
      return { success: false, error: 'amount is required when paymentId is not provided' };
    }
    if (!toAddressRaw) {
      return { success: false, error: 'toAddress is required when paymentId is not provided' };
    }

    const method: PrismaPaymentMethod = networkRaw === 'trc20' ? 'crypto_usdt_trc20' : 'crypto_usdt_erc20';
    const normalizedAddress = normalizeAddress(toAddressRaw);
    const now = new Date();
    const amount = roundCryptoAmount(amountRaw);
    const matches = await prisma.payment.findMany({
      where: {
        method,
        status: 'pending',
        cryptoAddress: { equals: toAddressRaw },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const filtered = matches.filter((p) =>
      p.cryptoAddress &&
      normalizeAddress(p.cryptoAddress) === normalizedAddress &&
      Math.abs(p.amount - amount) <= CRYPTO_MATCH_TOLERANCE,
    );

    if (filtered.length === 0) {
      return { success: false, error: 'No matching pending crypto payment found' };
    }
    if (filtered.length > 1) {
      logger.warn({ txHash, network: networkRaw, amount, toAddress: toAddressRaw, matchCount: filtered.length }, 'Ambiguous crypto webhook match');
      return { success: false, error: 'Multiple pending payments match this transaction' };
    }
    payment = filtered[0]!;
  }

  if (payment.status !== 'pending') {
    return { success: false, error: `Payment already ${payment.status}`, paymentId: payment.id };
  }

  const expectedAddress = payment.cryptoAddress?.trim() ?? toAddressRaw ?? '';
  if (!expectedAddress) {
    return { success: false, error: 'Payment destination address is missing' };
  }

  if (payment.method === 'crypto_usdt_trc20') {
    const verification = await verifyTrc20UsdtPaymentOnChain(txHash, expectedAddress, payment.amount);
    if (!verification.success) {
      logger.warn(
        {
          paymentId: payment.id,
          txHash,
          expectedAddress,
          expectedAmount: payment.amount,
          error: verification.error,
          confirmations: verification.confirmations,
        },
        'TRC20 on-chain verification rejected webhook confirmation',
      );
      return { success: false, error: verification.error ?? 'On-chain verification failed', paymentId: payment.id };
    }
  }

  await completeCryptoPayment(payment, txHash);
  logger.info(
  {
      paymentId: payment.id,
      txHash,
      method: payment.method,
      amount: payment.amount,
      userId: payment.userId,
      confirmations: payload.confirmations,
      tokenSymbol: payload.tokenSymbol,
    },
    'Crypto payment auto-confirmed via webhook'
  );

  return { success: true, paymentId: payment.id };
}

async function completeCryptoPayment(
  payment: {
    id: string;
    userId: string;
    plan: PrismaSubPlan;
    billing: string;
  },
  txHash: string,
): Promise<void> {
  const normalizedTxHash = normalizeTxHash(txHash);
  const expiresAt = new Date();
  if (payment.billing === 'yearly') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'completed', cryptoTxHash: normalizedTxHash, completedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: payment.userId },
      data: { subscription: payment.plan, subscriptionExpiresAt: expiresAt },
    }),
  ]);
}

// ============================================================================
// Stub upgrade (no payment — for testing)
// ============================================================================

export async function stubUpgrade(
  userId: string,
  plan: string,
  billing: BillingPeriod,
): Promise<{ success: boolean; error?: string }> {
  const validPlans = ['free', 'pro', 'elite', 'ultimate'];
  if (!validPlans.includes(plan)) {
    return { success: false, error: 'Invalid plan' };
  }

  const expiresAt = plan === 'free' ? null : new Date();
  if (expiresAt) {
    if (billing === 'yearly') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscription: plan as PrismaSubPlan,
      subscriptionExpiresAt: expiresAt,
    },
  });

  logger.info({ userId, plan, billing }, 'Stub subscription upgrade (no payment)');

  return { success: true };
}

// ============================================================================
// Payment history
// ============================================================================

export async function getPaymentHistory(userId: string, page = 1, limit = 20): Promise<{
  payments: Array<{
    id: string;
    plan: string;
    billing: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    createdAt: number;
    completedAt: number | null;
  }>;
  total: number;
}> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const safeLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.trunc(limit))) : 20;
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
    prisma.payment.count({ where: { userId } }),
  ]);

  return {
    payments: payments.map(p => ({
      id: p.id,
      plan: p.plan,
      billing: p.billing,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt.getTime(),
      completedAt: p.completedAt?.getTime() ?? null,
    })),
    total,
  };
}

// ============================================================================
// Admin: all payments (with user email)
// ============================================================================

export async function getAllPayments(page = 1, limit = 30): Promise<{
  payments: Array<{
    id: string;
    userId: string;
    userEmail: string;
    plan: string;
    billing: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    createdAt: number;
    completedAt: number | null;
    cryptoTxHash: string | null;
  }>;
  total: number;
}> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const safeLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.trunc(limit))) : 30;
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
      include: { user: { select: { email: true } } },
    }),
    prisma.payment.count(),
  ]);

  return {
    payments: payments.map(p => ({
      id: p.id,
      userId: p.userId,
      userEmail: p.user.email,
      plan: p.plan,
      billing: p.billing,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt.getTime(),
      completedAt: p.completedAt?.getTime() ?? null,
      cryptoTxHash: p.cryptoTxHash,
    })),
    total,
  };
}

// ============================================================================
// Admin: pending crypto payments
// ============================================================================

export async function getPendingCryptoPayments(): Promise<Array<{
  id: string;
  userId: string;
  userEmail: string;
  plan: string;
  amount: number;
  currency: string;
  method: string;
  createdAt: number;
  expiresAt: number | null;
}>> {
  const payments = await prisma.payment.findMany({
    where: { status: 'pending', method: { in: ['crypto_usdt_trc20', 'crypto_usdt_erc20'] } },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { email: true } } },
  });

  return payments.map(p => ({
    id: p.id,
    userId: p.userId,
    userEmail: p.user.email,
    plan: p.plan,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    createdAt: p.createdAt.getTime(),
    expiresAt: p.expiresAt?.getTime() ?? null,
  }));
}

logger.info('Payment service initialized');
