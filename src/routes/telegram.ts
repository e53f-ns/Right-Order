import { Router, type Request, type Response } from 'express';
import { nowMs } from '../utils/time.js';
import { requireAuth } from '../auth/security.js';
import {
  setupTelegram,
  getTelegramStatus,
  toggleTelegram,
  updateMinNet,
  sendTestMessage,
} from '../telegram/telegram-bot.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('routes/telegram');
const router = Router();

router.post('/api/telegram/setup', requireAuth, (req: Request, res: Response) => {
  const { chatId, minNetPercent } = req.body as { chatId?: string; minNetPercent?: number };
  if (!chatId) { res.status(400).json({ success: false, error: 'chatId is required' }); return; }
  const result = setupTelegram(req.user!.id, chatId, minNetPercent);
  res.json({ ...result, timestamp: nowMs() });
});

router.get('/api/telegram/status', requireAuth, (req: Request, res: Response) => {
  const result = getTelegramStatus(req.user!.id);
  res.json({ ...result, timestamp: nowMs() });
});

router.post('/api/telegram/toggle', requireAuth, (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') { res.status(400).json({ success: false, error: 'enabled (boolean) is required' }); return; }
  const result = toggleTelegram(req.user!.id, enabled);
  res.json({ ...result, timestamp: nowMs() });
});

router.put('/api/telegram/min-net', requireAuth, (req: Request, res: Response) => {
  const { minNetPercent } = req.body as { minNetPercent?: number };
  if (typeof minNetPercent !== 'number' || minNetPercent < 0) {
    res.status(400).json({ success: false, error: 'minNetPercent (number >= 0) is required' });
    return;
  }
  const result = updateMinNet(req.user!.id, minNetPercent);
  res.json({ ...result, timestamp: nowMs() });
});

const handleTelegramTest = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  try {
    const result = await sendTestMessage(req.user.id);
    res.json({ ...result, timestamp: nowMs() });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Telegram test error');
    res.status(500).json({ success: false, error: 'Failed to send test message' });
  }
};

router.post('/api/telegram/test', handleTelegramTest);
router.post('/api/telegram/send-test', handleTelegramTest);

export default router;
