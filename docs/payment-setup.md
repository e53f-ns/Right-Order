# Payment Setup — Production Deployment Checklist

Right Order accepts two payment methods: **Stripe** (cards) and **USDT crypto** (TRC20, ERC20, TON). This document is the step-by-step for switching from test mode to live production.

## 1. Subscription Tiers (must match in Stripe dashboard, app code, and marketing)

| Plan      | Monthly | Yearly  |
| --------- | ------- | ------- |
| Free      | $0      | $0      |
| Pro       | $39     | $349    |
| Elite     | $89     | $799    |
| Ultimate  | $199    | $1799   |

Source of truth: `src/auth/subscription.ts` (`PLANS`) and `src/payments/stripe-service.ts` (`PLAN_PRICES`).

## 2. Environment Variables

Set these on the production host (or in your `.env`):

```
# Stripe — LIVE mode keys, not sk_test_*
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# USDT receiving wallets (use ones you control on a hardware wallet, never hot keys)
CRYPTO_USDT_TRC20_ADDRESS=T...
CRYPTO_USDT_ERC20_ADDRESS=0x...
CRYPTO_USDT_TON_ADDRESS=UQ...

# Optional: raise on-chain API rate limits
ETHERSCAN_API_KEY=
TONCENTER_API_KEY=
```

Test mode vs live mode is determined **purely by which Stripe key is set** — no code changes needed. If `STRIPE_SECRET_KEY` is missing or set to `sk_test_PLACEHOLDER`, all Stripe processing is disabled and a clear error is returned to the client.

## 3. Switching Stripe to Live Mode

1. **Activate your Stripe account** (Dashboard → Settings → Activate account). Provide business details, bank account, etc.
2. **Generate a live restricted key** in `Developers → API keys` (toggle "View test data" OFF). Copy `sk_live_...` and `pk_live_...`.
3. Replace `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in production env.
4. Redeploy the service (the Stripe client is initialized lazily per process and reads from env on first use).
5. Verify with a real $0.50 charge on the live key, then refund.

## 4. Webhook Endpoint

Stripe must call our backend on payment events.

1. In Stripe Dashboard → `Developers → Webhooks → Add endpoint`.
2. **Endpoint URL:** `https://<your-domain>/api/payment/webhook`
3. **Events to listen for** (must match what the code handles):
   - `checkout.session.completed` — one-shot checkout success
   - `customer.subscription.updated` — period renewal / plan change
   - `customer.subscription.deleted` — cancellation
   - `invoice.payment_failed` — flag failed renewals
4. After creating the endpoint, copy the **signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET`. Redeploy.
5. Click **Send test webhook** in Stripe → choose `checkout.session.completed` → confirm a `200 OK` response.

The webhook route is at `src/routes/payments.ts`, handler in `src/payments/stripe-service.ts:handleStripeWebhook`. It verifies the signature against `STRIPE_WEBHOOK_SECRET` — requests with bad signatures are rejected.

## 5. Crypto Wallet Setup

For each network you accept:

- **TRC20 (Tron):** create a wallet (TronLink / Ledger), set `CRYPTO_USDT_TRC20_ADDRESS`. Verification uses Trongrid public API.
- **ERC20 (Ethereum):** create a wallet (Ledger / hardware), set `CRYPTO_USDT_ERC20_ADDRESS`. Verification uses Etherscan API; set `ETHERSCAN_API_KEY` for higher rate limits.
- **TON:** create a wallet (Tonkeeper / Ledger TON app), set `CRYPTO_USDT_TON_ADDRESS`. Verification uses TON Center; set `TONCENTER_API_KEY` for higher rate limits.

**Pending crypto payments expire after 2 hours** (`src/payments/stripe-service.ts:createCryptoPayment`). Run `expireStaleCryptoPayments()` on a cron (every 15 min) to flip stale rows to `expired` status.

After the user submits a tx hash, an admin confirms via `POST /api/payment/crypto/confirm`. The handler calls `verifyTrc20Transaction` / `verifyErc20Transaction` / `verifyTonTransaction` which check on-chain that the transfer went to the expected address for the expected amount (±0.5%).

## 6. Verification Checklist Before Going Live

- [ ] `STRIPE_SECRET_KEY` starts with `sk_live_` in production env
- [ ] `STRIPE_WEBHOOK_SECRET` is set and matches the dashboard webhook
- [ ] All three `CRYPTO_USDT_*_ADDRESS` env vars point to wallets you own
- [ ] Webhook test from Stripe Dashboard returns `200`
- [ ] DB migration `20260430120000_add_ton_payment_method` is applied (`prisma migrate deploy`)
- [ ] A real card test purchase upgrades the user's subscription in the DB
- [ ] `customer.subscription.deleted` test event downgrades the user to `free`
- [ ] A real USDT transfer (small amount) on each network can be confirmed via the admin endpoint

## 7. Smoke Tests

```bash
# 1. Plans endpoint returns the four tiers with correct prices
curl https://<host>/api/subscription/plans | jq '.plans[] | {id, monthlyPrice, yearlyPrice}'

# 2. Checkout creation (requires logged-in user JWT)
curl -X POST https://<host>/api/payment/checkout \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro","billing":"monthly"}'

# 3. Crypto payment creation
curl -X POST https://<host>/api/payment/crypto \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro","billing":"monthly","network":"ton"}'
```

## 8. Rollback

If a live charge goes wrong:

1. Refund via Stripe Dashboard.
2. Manually downgrade the user: `UPDATE "User" SET subscription = 'free' WHERE id = '...';`
3. Revert env to `sk_test_PLACEHOLDER` to disable further charges while you investigate.
