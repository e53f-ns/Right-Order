# ══════════════════════════════════════════════
# Right Order — Backend Dockerfile (multi-stage)
# ══════════════════════════════════════════════

# ── Stage 1: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

# Install ALL deps (including devDeps for tsc + prisma)
COPY package.json package-lock.json ./
RUN npm ci

# Copy prisma schema + config, then generate client
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --outDir dist

# ── Stage 2: Production ──
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy generated Prisma client from builder (lives in src/generated/prisma)
COPY --from=builder /app/src/generated ./src/generated

# Copy Prisma schema + config (needed at runtime for migrations)
COPY prisma ./prisma
COPY prisma.config.ts ./

# Copy compiled JS
COPY --from=builder /app/dist ./dist

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/stats || exit 1

# Run as non-root
USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "dist/dashboard-main.js"]
