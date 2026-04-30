/**
 * Stripe payment service — checkout sessions, webhooks, auto-upgrade
 * Also includes crypto payment stubs for USDT TRC20/ERC20
 */

import Stripe from 'stripe';
import crypto from 'crypto';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import type { SubscriptionPlan as PrismaSubPlan, PaymentMethod as PrismaPaymentMethod } from '../generated/prisma/client.js';
import { verifyTrc20Transaction, verifyErc20Transaction, verifyTonTransaction } from '../services/blockchain-verify.js';

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
  expiresAt?: number;
  error?: string;
}

// ============================================================================
// Plan price mapping
// ============================================================================

const PLAN_PRICES: Record<string, Record<BillingPeriod, number>> = {
  pro:      { monthly: 39,  yearly: 349 },
  elite:    { monthly: 89,  yearly: 799 },
  ultimate: { monthly: 199, yearly: 1799 },
};

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

  try {
    // Ensure Stripe customer exists
    let user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
    let customerId = user?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
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
    });

    // Create pending payment record
    await prisma.payment.create({
      data: {
        userId,
        plan: plan as PrismaSubPlan,
        billing,
        amount,
        currency: 'USD',
        method: 'stripe' as PrismaPaymentMethod,
        status: 'pending',
        stripeSessionId: session.id,
      },
    });

    logger.info({ userId, plan, billing, amount, sessionId: session.id }, 'Stripe checkout session created');

    const result: CreateCheckoutResult = { success: true, sessionId: session.id };
    if (session.url) result.url = session.url;
    return result;
  } catch (err: unknown) {
    logger.error({ userId, plan, error: err instanceof Error ? err.message : String(err) }, 'Failed to create Stripe checkout session');
    return { success: false, error: 'Payment processing failed. Please try again.' };
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
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Stripe webhook signature verification failed');
    return { success: false, error: 'Payment processing failed. Please try again.' };
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await processSuccessfulPayment(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await processSubscriptionChange(event.data.object as Stripe.Subscription, event.type);
        break;
      }
      case 'invoice.payment_failed': {
        await processInvoiceFailure(event.data.object as Stripe.Invoice);
        break;
      }
      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe event');
    }
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err), type: event.type }, 'Error handling Stripe event');
  }

  return { success: true };
}

async function processSubscriptionChange(sub: Stripe.Subscription, eventType: string): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
  if (!user) {
    logger.warn({ customerId, eventType }, 'Subscription event for unknown customer');
    return;
  }

  if (eventType === 'customer.subscription.deleted' || sub.status === 'canceled' || sub.status === 'unpaid') {
    await prisma.user.update({
      where: { id: user.id },
      data: { subscription: 'free' as PrismaSubPlan, subscriptionExpiresAt: new Date() },
    });
    logger.info({ userId: user.id, status: sub.status }, 'Subscription downgraded to free');
    return;
  }

  // current_period_end is unix seconds
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (periodEnd) {
    await prisma.user.update({
      where: { id: user.id },
      data: { subscriptionExpiresAt: new Date(periodEnd * 1000) },
    });
    logger.info({ userId: user.id, periodEnd }, 'Subscription expiry updated from Stripe');
  }
}

async function processInvoiceFailure(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
  if (!user) return;
  logger.warn({ userId: user.id, invoiceId: invoice.id }, 'Stripe invoice payment failed');
  // Mark any matching pending payments as failed (best-effort by customer).
  await prisma.payment.updateMany({
    where: { userId: user.id, status: 'pending', method: 'stripe' as PrismaPaymentMethod },
    data: { status: 'failed' },
  });
}

async function processSuccessfulPayment(session: Stripe.Checkout.Session): Promise<void> {
  const { userId, plan, billing } = (session.metadata ?? {}) as Record<string, string>;
  if (!userId || !plan) {
    logger.error({ sessionId: session.id }, 'Stripe webhook missing userId/plan metadata');
    return;
  }

  try {
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

export type CryptoNetwork = 'trc20' | 'erc20' | 'ton';

const CRYPTO_NETWORK_ENV: Record<CryptoNetwork, string> = {
  trc20: 'CRYPTO_USDT_TRC20_ADDRESS',
  erc20: 'CRYPTO_USDT_ERC20_ADDRESS',
  ton:   'CRYPTO_USDT_TON_ADDRESS',
};

const CRYPTO_NETWORK_METHOD: Record<CryptoNetwork, PrismaPaymentMethod> = {
  trc20: 'crypto_usdt_trc20',
  erc20: 'crypto_usdt_erc20',
  ton:   'crypto_usdt_ton' as PrismaPaymentMethod,
};

export async function createCryptoPayment(
  userId: string,
  plan: string,
  billing: BillingPeriod,
  network: CryptoNetwork,
): Promise<CryptoPaymentResult> {
  const prices = PLAN_PRICES[plan];
  if (!prices) {
    return { success: false, error: `Invalid plan: ${plan}` };
  }

  const envKey = CRYPTO_NETWORK_ENV[network];
  if (!envKey) {
    return { success: false, error: `Unsupported network: ${network}` };
  }
  const amount = prices[billing];
  const address = process.env[envKey];

  if (!address) {
    return { success: false, error: `${network.toUpperCase()} USDT address not configured` };
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 2); // 2 hour window

  const method: PrismaPaymentMethod = CRYPTO_NETWORK_METHOD[network];

  const payment = await prisma.payment.create({
    data: {
      userId,
      plan: plan as PrismaSubPlan,
      billing,
      amount,
      currency: 'USDT',
      method,
      status: 'pending',
      cryptoAddress: address,
      transactionId: `crypto_${crypto.randomBytes(16).toString('hex')}`,
      expiresAt,
    },
  });

  logger.info({ userId, plan, billing, amount, network, paymentId: payment.id }, 'Crypto payment created');

  return {
    success: true,
    paymentId: payment.id,
    address,
    amount,
    currency: 'USDT',
    expiresAt: expiresAt.getTime(),
  };
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
  if (payment.expiresAt && payment.expiresAt.getTime() < Date.now()) {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'expired' } });
    return { success: false, error: 'Payment expired. Please create a new payment.' };
  }

  const expectedAddress = payment.cryptoAddress ?? '';
  let verify;
  switch (payment.method) {
    case 'crypto_usdt_trc20':
      verify = await verifyTrc20Transaction(txHash, expectedAddress, payment.amount);
      break;
    case 'crypto_usdt_erc20':
      verify = await verifyErc20Transaction(txHash, expectedAddress, payment.amount);
      break;
    case 'crypto_usdt_ton' as PrismaPaymentMethod:
      verify = await verifyTonTransaction(txHash, expectedAddress, payment.amount);
      break;
    default:
      return { success: false, error: `Unsupported payment method: ${payment.method}` };
  }
  if (!verify.verified) {
    logger.warn({ paymentId, txHash, reason: verify.error }, 'On-chain verification failed');
    return { success: false, error: `On-chain verification failed: ${verify.error}` };
  }

  const expiresAt = new Date();
  const billing = payment.billing;
  if (billing === 'yearly') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'completed', cryptoTxHash: txHash, completedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: payment.userId },
      data: { subscription: payment.plan, subscriptionExpiresAt: expiresAt },
    }),
  ]);

  logger.info({ paymentId, txHash, userId: payment.userId, plan: payment.plan, confirmedBy: adminUserId }, 'Crypto payment confirmed, subscription upgraded');

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
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
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
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
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
    where: { status: 'pending', method: { in: ['crypto_usdt_trc20', 'crypto_usdt_erc20', 'crypto_usdt_ton' as PrismaPaymentMethod] } },
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

// ============================================================================
// Expire pending crypto payments past their window
// ============================================================================

export async function expireStaleCryptoPayments(): Promise<number> {
  const result = await prisma.payment.updateMany({
    where: {
      status: 'pending',
      method: { in: ['crypto_usdt_trc20', 'crypto_usdt_erc20', 'crypto_usdt_ton' as PrismaPaymentMethod] },
      expiresAt: { lt: new Date() },
    },
    data: { status: 'expired' },
  });
  if (result.count > 0) {
    logger.info({ count: result.count }, 'Expired stale crypto payments');
  }
  return result.count;
}

logger.info('Payment service initialized');
