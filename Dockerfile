# ══════════════════════════════════════════════
# Right Order — Backend Dockerfile (multi-stage)
# ══════════════════════════════════════════════

# ── Stage 1: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client
RUN npx prisma generate

# TypeScript compile
RUN npx tsc --outDir dist

# ── Stage 2: Production ──
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy Prisma schema + generated client + migrations
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

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
