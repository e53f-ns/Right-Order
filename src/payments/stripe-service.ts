/**
 * Stripe payment service — checkout sessions, webhooks, auto-upgrade
 * Also includes crypto payment stubs for USDT TRC20/ERC20
 */

import Stripe from 'stripe';
import crypto from 'crypto';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../utils/logger.js';
import type { SubscriptionPlan as PrismaSubPlan, PaymentMethod as PrismaPaymentMethod } from '../generated/prisma/client.js';
import { verifyTrc20Transaction, verifyErc20Transaction } from '../services/blockchain-verify.js';

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
): Promise<CryptoPaymentResult> {
  const prices = PLAN_PRICES[plan];
  if (!prices) {
    return { success: false, error: `Invalid plan: ${plan}` };
  }

  const amount = prices[billing];
  const envKey = network === 'trc20' ? 'CRYPTO_USDT_TRC20_ADDRESS' : 'CRYPTO_USDT_ERC20_ADDRESS';
  const address = process.env[envKey];

  if (!address) {
    return { success: false, error: `${network.toUpperCase()} USDT address not configured` };
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 2); // 2 hour window

  const method: PrismaPaymentMethod = network === 'trc20' ? 'crypto_usdt_trc20' : 'crypto_usdt_erc20';

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

  const isTrc20 = payment.method === 'crypto_usdt_trc20';
  const expectedAddress = payment.cryptoAddress ?? '';
  const verify = isTrc20
    ? await verifyTrc20Transaction(txHash, expectedAddress, payment.amount)
    : await verifyErc20Transaction(txHash, expectedAddress, payment.amount);
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
