# ══════════════════════════════════════════════
# Right Order — Backend Dockerfile (multi-stage)
# ══════════════════════════════════════════════

# ── Stage 1: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

# Install ALL deps (devDeps needed for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Generate Prisma client BEFORE copying source
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --outDir dist

# Prune devDeps so we only carry production deps forward
RUN npm prune --omit=dev

# ── Stage 2: Production ──
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy everything needed from builder in one shot:
# - node_modules (with Prisma generated client intact)
# - compiled JS output
# - Prisma schema + config (for runtime migrations)
# - generated Prisma client source
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "dist/dashboard-main.js"]