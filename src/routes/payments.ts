import { Router, type Request, type Response } from 'express';
import { nowMs } from '../utils/time.js';
import {
  createCheckoutSession,
  handleStripeWebhook,
  createCryptoPayment,
  confirmCryptoPayment,
  getPaymentHistory,
} from '../payments/stripe-service.js';
import {
  getAllPlans,
  getPlanLimits,
  getPlanInfo,
} from '../auth/subscription.js';
import { requireAuth, requireAdmin } from '../auth/security.js';
import type { SubscriptionPlan } from '../auth/auth-db.js';

const router = Router();

router.get('/api/subscription/plans', (_req: Request, res: Response) => {
  res.json({ success: true, timestamp: nowMs(), plans: getAllPlans() });
});

router.get('/api/subscription/status', requireAuth, (req: Request, res: Response) => {
  const plan = req.user!.subscription ?? 'free';
  const info = getPlanInfo(plan as SubscriptionPlan);
  const limits = getPlanLimits(plan as SubscriptionPlan);
  res.json({
    success: true, timestamp: nowMs(),
    subscription: { plan, planInfo: info, limits, expiresAt: req.user!.subscriptionExpiresAt, isPro: plan !== 'free' },
  });
});

router.post('/api/subscription/upgrade', requireAuth, async (_req: Request, res: Response) => {
  res.status(403).json({ success: false, error: 'Direct upgrade disabled. Use Stripe checkout or crypto payment.' });
});

router.post('/api/payment/checkout', requireAuth, async (req: Request, res: Response) => {
  const { plan, billing } = req.body as { plan?: string; billing?: 'monthly' | 'yearly' };
  if (!plan || !billing) { res.status(400).json({ success: false, error: 'plan and billing required' }); return; }
  const baseUrl = `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
  const result = await createCheckoutSession(
    req.user!.id, req.user!.email, plan, billing,
    `${baseUrl}/dashboard?payment=success`,
    `${baseUrl}/pricing?payment=cancelled`,
  );
  res.json({ ...result, timestamp: nowMs() });
});

router.post('/api/payment/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string | undefined;
  if (!sig) { res.status(400).json({ success: false, error: 'No signature' }); return; }
  const result = await handleStripeWebhook(req.body as Buffer, sig);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/api/payment/crypto', requireAuth, async (req: Request, res: Response) => {
  const { plan, billing, network } = req.body as { plan?: string; billing?: 'monthly' | 'yearly'; network?: 'trc20' | 'erc20' };
  if (!plan || !billing || !network) { res.status(400).json({ success: false, error: 'plan, billing, network required' }); return; }
  const result = await createCryptoPayment(req.user!.id, plan, billing, network);
  res.json({ ...result, timestamp: nowMs() });
});

router.post('/api/payment/crypto/confirm', requireAdmin, async (req: Request, res: Response) => {
  const { paymentId, txHash } = req.body as { paymentId?: string; txHash?: string };
  if (!paymentId || !txHash) { res.status(400).json({ success: false, error: 'paymentId and txHash required' }); return; }
  const result = await confirmCryptoPayment(paymentId, txHash, req.user!.id);
  res.json({ ...result, timestamp: nowMs() });
});

router.get('/api/payment/history', requireAuth, async (req: Request, res: Response) => {
  const page = parseInt(String(req.query['page'] ?? '1'), 10);
  const result = await getPaymentHistory(req.user!.id, page);
  res.json({ success: true, timestamp: nowMs(), ...result });
});

export default router;
