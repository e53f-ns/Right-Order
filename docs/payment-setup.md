# Payment System Production Setup

This guide covers switching the Right-Order payment system from test/sandbox to live production for both Stripe (card) and USDT (TRC20/ERC20) crypto payments.

## Plan Pricing

| Plan     | Monthly | Yearly |
|----------|---------|--------|
| Free     | $0      | $0     |
| Pro      | $39     | $349   |
| Elite    | $89     | $799   |
| Ultimate | $199    | $1799  |

Prices live in `src/payments/stripe-service.ts` (`PLAN_PRICES`) and `src/auth/subscription.ts`. Update both if pricing changes.

## Required Environment Variables

| Var                          | Required for | Notes |
|------------------------------|--------------|-------|
| `STRIPE_SECRET_KEY`          | Stripe       | `sk_live_…` for production. `sk_test_…` triggers a startup warning when `NODE_ENV=production`. |
| `STRIPE_WEBHOOK_SECRET`      | Stripe       | `whsec_…` from the live webhook endpoint dashboard. |
| `CRYPTO_USDT_TRC20_ADDRESS`  | TRC20 USDT   | Tron wallet address (e.g. `T…`). |
| `CRYPTO_USDT_ERC20_ADDRESS`  | ERC20 USDT   | Ethereum wallet address (e.g. `0x…`). |
| `ETHERSCAN_API_KEY`          | ERC20 USDT   | Used for on-chain receipt lookup. |

When `NODE_ENV=production` and any payment var is missing or holds a placeholder (`sk_test_PLACEHOLDER`, `whsec_PLACEHOLDER`), the server logs a warning at boot and disables that payment method.

## 1. Switching Stripe to Live Mode

1. In the Stripe Dashboard, toggle the view from **Test mode** to **Live mode** (top-right).
2. Copy the live secret key (`sk_live_…`) from **Developers → API keys**.
3. Set `STRIPE_SECRET_KEY=sk_live_…` in the production environment (host secrets, not committed).
4. Redeploy. Boot logs should show `Stripe client initialized` and **no** warning about test keys.

## 2. Configuring the Stripe Webhook

The app exposes the webhook at `POST /api/payment/webhook`. It expects the raw JSON body (already wired in `src/dashboard/server.ts`).

1. Go to **Developers → Webhooks → Add endpoint** in Stripe.
2. Endpoint URL: `https://<your-domain>/api/payment/webhook`.
3. Select these events:
   - `checkout.session.completed` — completes one-time plan purchases and upgrades the user.
   - `customer.subscription.updated` — handles plan changes / cancellations on recurring subs.
   - `customer.subscription.deleted` — downgrades user to `free`.
   - `invoice.payment_failed` — logs a warning so the team can follow up.
4. Reveal the **Signing secret** (`whsec_…`) and set `STRIPE_WEBHOOK_SECRET` in env. Redeploy.
5. From the Stripe Dashboard, click **Send test webhook** for `checkout.session.completed` and confirm a `200 OK` response in the logs.

## 3. Configuring USDT Crypto Receiving

1. Generate or select dedicated TRC20 and ERC20 USDT receiving wallets. Use cold or multisig wallets for security.
2. Set `CRYPTO_USDT_TRC20_ADDRESS` and `CRYPTO_USDT_ERC20_ADDRESS` in env.
3. Set `ETHERSCAN_API_KEY` for on-chain ERC20 verification (TRC20 uses public TronGrid API and needs no key).
4. Each crypto payment expires **2 hours** after creation. Past that, `confirmCryptoPayment` rejects it as expired.
5. On-chain verification (`src/services/blockchain-verify.ts`) checks: correct contract (USDT), correct recipient address, and amount within 0.5% tolerance.

## 4. Verifying Payments Work

After deploying with live keys:

1. **Stripe smoke test (small amount)**
   - Manually adjust `PLAN_PRICES` in a staging build to $1, or use Stripe's "Send test webhook" with a real event.
   - Walk a real card through the checkout flow.
   - Confirm: `payments` row goes `pending → completed`, `users.subscription` updates, `users.subscriptionExpiresAt` is +1 month.
2. **Webhook signature**
   - Tail server logs while sending a test event. A signature mismatch logs `Stripe webhook signature verification failed` — that means `STRIPE_WEBHOOK_SECRET` is wrong or the body is being parsed as JSON before the raw handler.
3. **Crypto payment**
   - Initiate a small ($1) USDT payment via `/api/payment/crypto`.
   - Send funds from a test wallet.
   - Have an admin call `/api/payment/crypto/confirm` with the tx hash.
   - Confirm on-chain verification succeeds and the user is upgraded.
4. **Admin dashboards**
   - `/api/admin/payments` shows all payments.
   - `/api/admin/payments/pending-crypto` shows unconfirmed crypto payments.

## 5. Post-Launch Monitoring

Watch these for at least the first week, then set up alerts:

- **Server logs** — filter for the `payments` and `blockchain-verify` loggers. Alert on:
  - `Stripe webhook signature verification failed` (wrong secret or proxy stripping body)
  - `Failed to process Stripe payment` (DB or Stripe API errors after a successful charge — payment captured but user not upgraded)
  - `On-chain verification failed` (suspicious or wrong-amount crypto submissions)
  - `Invoice payment failed` (recurring sub cards declining)
- **Stripe Dashboard**
  - Webhook delivery success rate — should be ≥99%.
  - Disputes/chargebacks.
  - Failed payment intents.
- **Database**
  - Pending payments older than 2 hours that have not flipped to `completed` or `expired` — indicates a stuck flow.
  - Subscriptions that completed in Stripe but have no matching `subscriptionExpiresAt` update — webhook delivery gap.
- **Wallet balances** — reconcile incoming USDT vs. `payments` table at least daily during ramp-up.

## Rollback

If live payments misbehave:

1. Replace `STRIPE_SECRET_KEY` with the test key and redeploy. New checkouts hit Stripe test mode immediately.
2. Disable the live webhook endpoint in the Stripe Dashboard.
3. Crypto: blank out `CRYPTO_USDT_TRC20_ADDRESS` / `CRYPTO_USDT_ERC20_ADDRESS` to disable new crypto payments. Existing pending payments still expire after 2h.
