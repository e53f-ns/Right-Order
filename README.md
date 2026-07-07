# Right Order

Real-time crypto arbitrage platform: scans CEX/DEX markets for cross-exchange spreads, statistical arbitrage and P2P opportunities, and serves them through a subscription web app.

## Features

- Cross-exchange arbitrage scanner built on [ccxt](https://github.com/ccxt/ccxt) (spot spreads across major exchanges)
- Statistical arbitrage & pairs trading signals
- P2P / multi-hop arbitrage routes
- CEX–DEX detector with constant-product (x*y=k) price-impact estimation from pool reserves
- Subscription billing via Stripe (monthly/yearly tiers)
- JWT auth with separate access/refresh secrets, rate limiting, helmet hardening

## Stack

- **Backend:** Node.js, Express, Prisma (PostgreSQL), Pino logging
- **Frontend:** SPA in `frontend/`
- **Infra:** Docker / docker-compose

## Run

```bash
cp .env.example .env   # fill in DB, JWT and Stripe keys
docker-compose up -d
npm install && npm start
```

See `docs/` for payment setup and the market-readiness audit.
