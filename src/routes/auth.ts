import { Router, type Request, type Response } from 'express';
import { nowMs } from '../utils/time.js';
import {
  register,
  login,
  refreshAccessToken,
  logout,
  logoutAll,
  updatePreferences,
  getAuthStats,
} from '../auth/auth-db.js';
import {
  requireAuth,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
} from '../auth/security.js';
import { setup2FA, verify2FA, confirm2FA, remove2FA } from '../auth/two-factor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('routes/auth');
const router = Router();

router.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password required' });
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    const result = await register(email, password, ip, ua);
    if (!result.success) { res.status(400).json(result); return; }
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
    }
    res.json({ success: true, timestamp: nowMs(), token: result.accessToken, user: result.user });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Register error');
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

router.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password required' });
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    const result = await login(email, password, ip, ua);
    if (!result.success) { res.status(401).json(result); return; }
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
    }
    res.json({ success: true, timestamp: nowMs(), token: result.accessToken, user: result.user });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Login error');
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

router.post('/api/auth/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      res.status(401).json({ success: false, error: 'No refresh token' });
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    const result = await refreshAccessToken(refreshToken, ip, ua);
    if (!result.success) {
      res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
      res.status(401).json(result);
      return;
    }
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
    }
    res.json({ success: true, timestamp: nowMs(), token: result.accessToken, user: result.user });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Refresh error');
    res.status(500).json({ success: false, error: 'Token refresh failed' });
  }
});

router.get('/api/auth/me', (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  res.json({ success: true, timestamp: nowMs(), user: req.user });
});

router.post('/api/auth/logout', async (req: Request, res: Response) => {
  const refreshToken = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE_NAME];
  if (refreshToken) await logout(refreshToken);
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
  res.json({ success: true, timestamp: nowMs(), message: 'Logged out' });
});

router.post('/api/auth/logout-all', requireAuth, async (req: Request, res: Response) => {
  await logoutAll(req.user!.id);
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
  res.json({ success: true, timestamp: nowMs(), message: 'All sessions revoked' });
});

router.put('/api/auth/preferences', requireAuth, async (req: Request, res: Response) => {
  const prefs = req.body as Record<string, unknown>;
  const updated = await updatePreferences(req.user!.id, prefs);
  if (!updated) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, timestamp: nowMs(), user: updated });
});

router.get('/api/auth/stats', async (_req: Request, res: Response) => {
  const stats = await getAuthStats();
  res.json({ success: true, timestamp: nowMs(), ...stats });
});

// 2FA
router.post('/api/auth/2fa/setup', requireAuth, async (req: Request, res: Response) => {
  const result = await setup2FA(req.user!.id, req.user!.email);
  if (!result) { res.status(500).json({ success: false, error: 'Failed to setup 2FA' }); return; }
  res.json({ success: true, timestamp: nowMs(), ...result });
});

router.post('/api/auth/2fa/confirm', requireAuth, async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ success: false, error: 'TOTP token required' }); return; }
  const ok = await confirm2FA(req.user!.id, token);
  if (!ok) { res.status(400).json({ success: false, error: 'Invalid TOTP token' }); return; }
  res.json({ success: true, timestamp: nowMs(), message: '2FA enabled' });
});

router.post('/api/auth/2fa/verify', requireAuth, async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ success: false, error: 'TOTP token required' }); return; }
  const ok = await verify2FA(req.user!.id, token);
  res.json({ success: ok, timestamp: nowMs() });
});

router.post('/api/auth/2fa/disable', requireAuth, async (req: Request, res: Response) => {
  await remove2FA(req.user!.id);
  res.json({ success: true, timestamp: nowMs(), message: '2FA disabled' });
});

export default router;
