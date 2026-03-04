# Right Order (Local Dev Notes)

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or `docker compose` with the provided `docker-compose.yml`)

## Environment

1. Copy `.env.example` to `.env`.
2. Set at minimum:
   - `DATABASE_URL`
   - `POSTGRES_*` (if using Docker Compose)
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `COOKIE_SECRET`
   - Email provider config for verification codes:
     - Gmail SMTP (free): `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
     - OR Resend: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (verified domain sender)
   - `CORS_ORIGIN` (comma-separated whitelist, e.g. `https://app.example.com,https://admin.example.com`)
   - `PUBLIC_BASE_URL` (canonical public URL, used for payment redirect URLs)
3. Optional payment vars:
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `CRYPTO_USDT_TRC20_ADDRESS`, `CRYPTO_USDT_ERC20_ADDRESS`
   - `CRYPTO_WEBHOOK_SECRET` (for automatic USDT confirmation webhook)

Notes:
- Auth code accepts both `BCRYPT_ROUNDS` and legacy `BCRYPT_SALT_ROUNDS`.
- Auth code accepts both `JWT_ACCESS_SECRET` and legacy `JWT_SECRET` env names, but value must be strong (`>=32` chars, not placeholder).
- Registration is now 2-step: request code + verify code (`/api/auth/register/verify`).
- Login is now 2-step: request code + verify code (`/api/auth/login/verify`).
- CSRF protection is enabled for state-changing cookie-authenticated requests (origin/referrer validation against `CORS_ORIGIN`).

### DB Least Privilege (recommended)

Use a dedicated non-superuser role for the app instead of `postgres`:

```sql
CREATE ROLE rightorder_app LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
GRANT CONNECT ON DATABASE rightorder TO rightorder_app;
GRANT USAGE ON SCHEMA public TO rightorder_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rightorder_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rightorder_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rightorder_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO rightorder_app;
```

Then set `DATABASE_URL` to this role, for example:

```bash
DATABASE_URL=postgresql://rightorder_app:CHANGE_ME_STRONG_PASSWORD@localhost:5432/rightorder?schema=public
```

## Local Run

Backend:

```bash
npm install
npm run prisma:generate
npm run build
node dist/dashboard-main.js
```

Frontend:

```bash
cd frontend
npm install
npm run build
npm run dev
```

## Database Setup

Run migrations before testing registration/payments:

```bash
npx prisma migrate deploy
```

If the database is unavailable, registration now returns:
- HTTP `503`
- JSON error code `DB_UNAVAILABLE`

## Admin Bootstrap

Promote an existing user to admin from terminal:

```bash
npm run make-admin -- --email user@example.com
```

Demote back to regular user:

```bash
npm run make-admin -- --email user@example.com --role user
```

## Automatic USDT Confirmation (Webhook)

USDT payments can now be auto-confirmed via backend webhook (manual admin confirm still works as fallback).

Endpoint:

```bash
POST /api/payment/crypto/webhook
```

Auth:
- Header `x-crypto-webhook-secret: <CRYPTO_WEBHOOK_SECRET>`
  or
- Header `Authorization: Bearer <CRYPTO_WEBHOOK_SECRET>`

Example payload (match by network + amount + destination address):

```json
{
  "txHash": "0xabc... or tron txid",
  "network": "trc20",
  "amount": 39.217,
  "toAddress": "YOUR_TRC20_WALLET",
  "tokenSymbol": "USDT",
  "confirmations": 12
}
```

Alternative payload (direct payment match if your notifier stores `paymentId`):

```json
{
  "txHash": "0xabc...",
  "paymentId": "cm...."
}
```

Notes:
- Crypto invoices now use a unique USDT amount (e.g. `39.217`) to make automatic matching reliable on a shared wallet.
- Webhook processing is idempotent by `txHash`.
- TRC20 auto-confirm now validates on-chain via TronGrid before upgrade:
  - tx hash exists
  - USDT TRC20 contract matches
  - recipient address matches pending invoice
  - amount matches pending invoice
  - confirmations meet `TRON_MIN_CONFIRMATIONS`

### TRC20 Watcher (auto-send webhook)

This repo includes a polling watcher script for incoming TRC20 USDT transfers:

```bash
npm run watch:trc20-webhook
```

Required env:
- `CRYPTO_USDT_TRC20_ADDRESS`
- `CRYPTO_WEBHOOK_SECRET`

Optional env:
- `CRYPTO_WEBHOOK_URL` (default `http://localhost:3000/api/payment/crypto/webhook`)
- `TRONGRID_API_KEY`
- `TRON_POLL_MS` (default `15000`)
- `TRON_MIN_CONFIRMATIONS` (default `1`)

## Build Checks

Backend:

```bash
npm run build
```

Frontend:

```bash
npm --prefix frontend run build
```
