/**
 * Dashboard Server
 * Express + WebSocket server for real-time arbitrage spread visualization
 */

import { createServer, type Server as HttpServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import express, { type Express, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';

import { createLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';
import { getDashboardStore } from './store.js';
import { applySecurityMiddleware } from '../auth/security.js';
import { connectDatabase } from '../db/prisma.js';

import spreadRoutes from '../routes/spreads.js';
import authRoutes from '../routes/auth.js';
import paymentRoutes from '../routes/payments.js';
import adminRoutes from '../routes/admin.js';
import scannerRoutes from '../routes/scanner.js';
import tradingRoutes from '../routes/trading.js';
import serviceRoutes from '../routes/services.js';
import telegramRoutes from '../routes/telegram.js';

const logger = createLogger('dashboard-server');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DashboardServerConfig {
  port: number;
  host: string;
}

const DEFAULT_CONFIG: DashboardServerConfig = {
  port: 3000,
  host: 'localhost',
};

export class DashboardServer {
  private readonly config: DashboardServerConfig;
  private readonly app: Express;
  private readonly server: HttpServer;
  private readonly wss: WebSocketServer;
  private isRunning = false;

  getApp(): Express {
    return this.app;
  }

  constructor(config: Partial<DashboardServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    // Stripe webhook needs raw body BEFORE json parser
    this.app.post('/api/payment/webhook', express.raw({ type: 'application/json' }));

    this.app.use(express.json());
    applySecurityMiddleware(this.app);

    const publicPath = join(__dirname, '../../public');
    this.app.use(express.static(publicPath));

    const viewsPath = join(__dirname, '../../views');
    this.app.set('view engine', 'ejs');
    this.app.set('views', viewsPath);

    this.app.use((req, _res, next) => {
      logger.debug({ method: req.method, path: req.path }, 'HTTP request');
      next();
    });
  }

  private setupRoutes(): void {
    // Landing page
    this.app.get('/', (_req: Request, res: Response) => {
      const store = getDashboardStore();
      const spreads = store.getSpreads();
      const stats = store.getStats();
      res.render('index', {
        title: 'Arbitrage Dashboard',
        spreads,
        stats: {
          activeExchanges: Array.from(stats.activeExchanges),
          activeSymbols: stats.activeSymbols.size,
          totalCalculations: stats.totalCalculations,
          bestGrossPercent: stats.bestGrossPercent.toFixed(4),
          bestNetPercent: stats.bestNetPercent.toFixed(4),
          opportunitiesCount: stats.opportunitiesCount,
          uptime: stats.uptime,
        },
        refreshInterval: 5000,
      });
    });

    this.app.use(spreadRoutes);
    this.app.use(authRoutes);
    this.app.use(paymentRoutes);
    this.app.use(adminRoutes);
    this.app.use(scannerRoutes);
    this.app.use(tradingRoutes);
    this.app.use(serviceRoutes);
    this.app.use(telegramRoutes);
  }

  private setupWebSocket(): void {
    const clientAliveMap = new Map<WebSocket, boolean>();

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress;
      logger.info({ clientIp }, 'WebSocket client connected');

      const store = getDashboardStore();
      store.addClient(ws);
      clientAliveMap.set(ws, true);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            clientAliveMap.set(ws, true);
          }
        } catch {
          // Ignore non-JSON messages
        }
      });

      ws.on('close', () => {
        store.removeClient(ws);
        clientAliveMap.delete(ws);
        logger.debug({ clientIp }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error({ error: error.message, clientIp }, 'WebSocket error');
        store.removeClient(ws);
        clientAliveMap.delete(ws);
      });

      ws.on('pong', () => {
        clientAliveMap.set(ws, true);
        logger.debug({ clientIp }, 'WS pong received');
      });

      const spreads = store.getSpreads();
      const rawStats = store.getStats();
      const safeStats = {
        connectedExchanges: rawStats.connectedExchanges,
        totalExchanges: rawStats.totalExchanges,
        activeSymbols: rawStats.activeSymbols instanceof Set
          ? rawStats.activeSymbols.size
          : (typeof rawStats.activeSymbols === 'number' ? rawStats.activeSymbols : 0),
        uniqueSpreads: rawStats.uniqueSpreads,
        bestNetPercent: rawStats.bestNetPercent,
        bestGrossPercent: rawStats.bestGrossPercent,
        totalCalculations: rawStats.totalCalculations,
        opportunitiesCount: rawStats.opportunitiesCount,
        uptime: rawStats.uptime,
      };

      logger.info({ count: spreads.length }, `WS initial send: ${spreads.length} spreads`);
      if (spreads.length > 0) {
        ws.send(JSON.stringify({ type: 'spreads', data: spreads, timestamp: Date.now() }));
      }
      ws.send(JSON.stringify({ type: 'stats', data: safeStats, timestamp: Date.now() }));
    });

    const missedPongCount = new Map<WebSocket, number>();
    setInterval(() => {
      let alive = 0;
      let dead = 0;
      for (const ws of this.wss.clients) {
        if (ws.readyState === 1) {
          const isAlive = clientAliveMap.get(ws);
          if (isAlive === false) {
            const missed = (missedPongCount.get(ws) ?? 0) + 1;
            missedPongCount.set(ws, missed);
            if (missed >= 3) {
              logger.warn({ missed }, 'Terminating unresponsive WebSocket client (45s no pong)');
              ws.terminate();
              clientAliveMap.delete(ws);
              missedPongCount.delete(ws);
              dead++;
              continue;
            }
          } else {
            missedPongCount.set(ws, 0);
          }
          clientAliveMap.set(ws, false);
          ws.ping();
          alive++;
        }
      }
      logger.debug({ alive, dead }, 'WS ping sent to all clients');
    }, 15000);

    logger.info('WebSocket server configured with ping/pong keep-alive (15s interval, 45s timeout)');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Server already running');
      return;
    }

    try {
      await connectDatabase();
    } catch (err: unknown) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'PostgreSQL not available — falling back to degraded mode (auth will fail)',
      );
    }

    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.config.port, this.config.host, () => {
          this.isRunning = true;
          logger.info(
            { host: this.config.host, port: this.config.port, url: `http://${this.config.host}:${this.config.port}` },
            `Dashboard server started on http://${this.config.host}:${this.config.port}`,
          );
          resolve();
        });
        this.server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            logger.error({ port: this.config.port }, `Port ${this.config.port} is already in use`);
          }
          reject(error);
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    return new Promise((resolve) => {
      for (const ws of this.wss.clients) ws.close();
      this.server.close(() => {
        this.isRunning = false;
        logger.info('Dashboard server stopped');
        resolve();
      });
    });
  }

  getWss(): WebSocketServer {
    return this.wss;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}

let serverInstance: DashboardServer | null = null;

export function getDashboardServer(config?: Partial<DashboardServerConfig>): DashboardServer {
  serverInstance ??= new DashboardServer(config);
  return serverInstance;
}

export function resetDashboardServer(): void {
  if (serverInstance !== null) {
    void serverInstance.stop();
    serverInstance = null;
  }
}

// suppress unused import warning — nowMs is re-exported for consumers
void nowMs;
