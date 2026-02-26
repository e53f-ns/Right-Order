/**
 * Prisma client singleton — Prisma 7.x with @prisma/adapter-pg driver adapter
 * Reuses connection across hot-reloads in development
 */

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('prisma');

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    logger.warn('DATABASE_URL not set — Prisma client will fail on queries');
  }
  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  try {
    // Simple connectivity check — run a trivial query
    await prisma.$queryRawUnsafe('SELECT 1');
    logger.info('PostgreSQL connected via Prisma + pg adapter');
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to connect to PostgreSQL');
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}
