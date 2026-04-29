import { Router, type Request, type Response } from 'express';
import { nowMs } from '../utils/time.js';
import {
  getAllUsers,
  setUserRole,
  updateSubscription,
  cleanupExpiredTokens,
  type SubscriptionPlan,
} from '../auth/auth-db.js';
import { getAllPayments, getPendingCryptoPayments } from '../payments/stripe-service.js';
import { requireAdmin } from '../auth/security.js';

const router = Router();

router.get('/api/admin/users', requireAdmin, async (req: Request, res: Response) => {
  const page = parseInt(String(req.query['page'] ?? '1'), 10);
  const limit = parseInt(String(req.query['limit'] ?? '50'), 10);
  const result = await getAllUsers(page, limit);
  res.json({ success: true, timestamp: nowMs(), ...result });
});

router.post('/api/admin/user/role', requireAdmin, async (req: Request, res: Response) => {
  const { userId, role } = req.body as { userId?: string; role?: string };
  if (!userId || !role || !['user', 'admin'].includes(role)) {
    res.status(400).json({ success: false, error: 'userId and role (user|admin) required' });
    return;
  }
  const updated = await setUserRole(userId, role as 'user' | 'admin');
  if (!updated) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, timestamp: nowMs(), user: updated });
});

router.post('/api/admin/user/subscription', requireAdmin, async (req: Request, res: Response) => {
  const { userId, plan } = req.body as { userId?: string; plan?: string };
  if (!userId || !plan) { res.status(400).json({ success: false, error: 'userId and plan required' }); return; }
  const expiresAt = plan === 'free' ? undefined : Date.now() + 365 * 24 * 60 * 60 * 1000;
  const updated = await updateSubscription(userId, plan as SubscriptionPlan, expiresAt);
  if (!updated) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, timestamp: nowMs(), user: updated });
});

router.post('/api/admin/cleanup-tokens', requireAdmin, async (_req: Request, res: Response) => {
  const count = await cleanupExpiredTokens();
  res.json({ success: true, timestamp: nowMs(), cleaned: count });
});

router.get('/api/admin/payments', requireAdmin, async (req: Request, res: Response) => {
  const page = parseInt(String(req.query['page'] ?? '1'), 10);
  const result = await getAllPayments(page);
  res.json({ success: true, timestamp: nowMs(), ...result });
});

router.get('/api/admin/payments/pending-crypto', requireAdmin, async (_req: Request, res: Response) => {
  const payments = await getPendingCryptoPayments();
  res.json({ success: true, timestamp: nowMs(), payments });
});

export default router;
