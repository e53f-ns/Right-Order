# Right Order — Market-Readiness Audit

**Date:** 2026-04-30
**Branch:** `main` @ `9c1098d`
**Auditor:** Honest pass. Scored 1–10 (10 = ship-ready, 5 = needs work, 1 = broken).

---

## TL;DR — Overall: **5.4 / 10**

| # | Category | Score | One-line verdict |
|---|---|---|---|
| 1 | Code Quality | 7 | Builds clean, tests green, but small stubs and scattered TODOs remain |
| 2 | Security | 6 | Solid foundations; **JWT env-var mismatch will brick prod boot** |
| 3 | Payments | 6 | Stripe + crypto wired, but no portal, no refunds, fragile tx flow |
| 4 | Data Integrity | 5 | Real CCXT for spreads, **NFTs and dashboard mock are still fake** |
| 5 | Infrastructure | 7 | Compose hardened, backups exist; **no monitoring/alerting** |
| 6 | Legal | **1** | **Zero compliance content shipped** — blocker for paid product |
| 7 | UX | 6 | Frontend loads fast, looks polished; backend `/health` not reachable from internet |
| 8 | Business | 4 | Pricing visible, **no support channel, no analytics, no onboarding** |

**🚨 Three hard launch blockers:**
1. `JWT_SECRET` mismatch — backend will crash on first start in production (see §2).
2. No Terms / Privacy / Risk Disclaimer — illegal to take payments in most jurisdictions (§6).
3. No support email or contact channel anywhere on the public site (§8).

Build: ✅ `npm run build` clean. Tests: ✅ 26/26 passing in 562 ms.

---

## 1. Code Quality — **7/10**

**Build & tests**
- ✅ `npm run build` — clean, Prisma client regenerates, `tsc --outDir dist` succeeds.
- ✅ `npm test` — 26/26 passing across 3 files (`env`, `orderbook-service`, `subscription`).
- ✅ TypeScript strict mode in `tsconfig.json` (no implicit any in app code; only in Prisma generated stubs).
- ✅ Route modules well-split after `2aeb199` refactor: [src/routes/](src/routes/) has 8 focused files, 60–290 LoC each.
- ✅ Logging via `pino` is structured throughout.
- ✅ Error handling at route boundaries is consistent (try/catch + JSON error envelope).
- ✅ Global error handler at [src/dashboard/server.ts:140](src/dashboard/server.ts:140).

**🔧 Fix before launch**
- TODOs still in shipping code paths:
  - [src/index.ts:89,127](src/index.ts:89) — Telegram alert wiring deferred (`Send to Telegram notifier when implemented`).
  - [src/routes/spreads.ts:198](src/routes/spreads.ts:198) — multi-hop spread uses a flat multiplier instead of real intermediate-pair prices. Affects displayed numbers.
  - [src/dex/cex-dex-detector.ts:247](src/dex/cex-dex-detector.ts:247) — `priceImpact: 0` (hardcoded; you're showing 0% slippage that isn't real).

**📋 Nice-to-have**
- Test coverage is light: only 3 unit-test files, **zero integration tests**, **zero frontend tests**. Auth flows, payment webhooks, route guards, and websocket lifecycle are uncovered.
- No ESLint run in CI (config exists but not in build pipeline that I can verify).
- Two near-identical entry points (`dashboard-main.ts`, `index-with-dashboard.ts`) — confusing.

---

## 2. Security — **6/10**

**✅ Good**
- bcrypt password hashing with min 10 rounds enforced ([auth-db.ts:63](src/auth/auth-db.ts:63)).
- Refresh-token rotation via httpOnly cookie with `secure` + `sameSite=strict` in prod ([security.ts:68](src/auth/security.ts:68)).
- 2FA module present (TOTP + AES-256-GCM secret encryption per commit `caec08f`).
- Rate limiting layered: 20 auth/15 min, 120 API/min, 10 payments/hour ([security.ts:32](src/auth/security.ts:32)).
- Helmet + CORS with credentials configured ([security.ts:127](src/auth/security.ts:127)).
- `requireAuth` now mounted on protected `/api/*` prefixes (commit `0767be2`, today).
- Stripe webhook **signature verification** before processing ([stripe-service.ts:162](src/payments/stripe-service.ts:162)).
- No hardcoded secrets in source — `grep` for password/secret/key returned only generated Prisma stubs.
- Postgres not exposed to host in compose; backend binds to `127.0.0.1`; frontend nginx is the only public surface.
- VPS hardening script ([scripts/harden-vps.sh](scripts/harden-vps.sh)): UFW, fail2ban, key-only SSH, sysctl, unattended upgrades.

**🚨 Launch blocker — env-var name mismatch**
- [src/config/env.ts:9](src/config/env.ts:9) requires a single `JWT_SECRET` (≥16 chars).
- [src/auth/auth-db.ts:61](src/auth/auth-db.ts:61) reads `process.env['JWT_SECRET']` and **throws on boot** if absent.
- [docker-compose.yml:67](docker-compose.yml:67) and [.env.example:17](.env.example:17) only set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
- **Result: `npm start` exits with FATAL on a fresh production VPS.** This is reproducible — `npm test` log shows the same FATAL pattern at boot.
- Same shape problem for bcrypt: code reads `BCRYPT_SALT_ROUNDS`; compose/env set `BCRYPT_ROUNDS` (silent fallback to 12 — works, but the variable people are told to tune does nothing).

**🔧 Fix before launch**
- Pick one naming scheme and align all four files. Easiest: have `env.ts` read `JWT_ACCESS_SECRET` (the more descriptive name) and update `auth-db.ts`.
- Add a startup self-test (or expand `validateEnv`) that verifies `JWT_SECRET` length AND the var name code actually reads.
- `extractUser` ([security.ts:80](src/auth/security.ts:80)) silently swallows token validation errors at debug level. A flood of forged tokens would be invisible — log at `warn` with rate-limited dedupe.
- No CSP configured in production (helmet is on, but `crossOriginEmbedderPolicy: false` and no explicit CSP directives).
- No `Strict-Transport-Security` max-age verified — relying on helmet defaults; should pin `max-age=31536000; includeSubDomains; preload`.
- Refresh-cookie path is `/api/auth` — fine, but logout doesn't seem to invalidate the access JWT (only the refresh row); short 15 m TTL mitigates but doesn't eliminate.

**📋 Nice-to-have**
- Add a `/api/auth/sessions` endpoint so users can see and revoke active devices.
- WebAuthn / passkey support for the high-value tier.
- Dependency audit (`npm audit`) wasn't run as part of CI.

---

## 3. Payments — **6/10**

**✅ Good**
- Stripe Checkout flow with customer creation + metadata threading ([stripe-service.ts:70](src/payments/stripe-service.ts:70)).
- Webhook handles `checkout.session.completed`, `subscription.updated`, `subscription.deleted`, `invoice.payment_failed` ([stripe-service.ts:169](src/payments/stripe-service.ts:169)).
- Crypto: TRC20, ERC20, **TON USDT** with on-chain verification through TronGrid / Etherscan / TON Center ([blockchain-verify.ts](src/services/blockchain-verify.ts)).
- 2-hour expiry window on crypto payments + `expireStaleCryptoPayments()` sweep helper ([stripe-service.ts:539](src/payments/stripe-service.ts:539)).
- Confirm-time guard rejects already-`completed`/`failed` and expired payments ([stripe-service.ts:355](src/payments/stripe-service.ts:355)).
- Subscription upgrade is wrapped in `prisma.$transaction` for atomicity ([stripe-service.ts:391](src/payments/stripe-service.ts:391)).
- Production-mode warnings if Stripe key is `sk_test_*` ([env.ts:65](src/config/env.ts:65)).

**🔧 Fix before launch**
- **Mode is `payment`, not `subscription`** ([stripe-service.ts:104](src/payments/stripe-service.ts:104)) — you're charging one-off then computing local expiry. That means:
  - No automatic renewal — user must repurchase manually each period.
  - `customer.subscription.*` webhooks **will never fire** for this account because no subscription was created. The downgrade-on-cancel logic at [stripe-service.ts:193](src/payments/stripe-service.ts:193) is dead code.
  - To make this real recurring SaaS, switch to `mode: 'subscription'` with Stripe Prices.
- No **Stripe Customer Portal** — users cannot self-serve cancellation, payment-method update, or invoice download. This will become your #1 support ticket category.
- No **refund** path. If a charge needs to be reversed, an admin has to do it manually in the Stripe dashboard *and* update Prisma by hand.
- No **proration** logic for upgrades mid-period.
- Crypto stale-payment expiry helper exists but **is not scheduled** (no cron / setInterval calling it). Pending payments will accumulate forever in the DB.
- Pending `checkout.session` records are never reconciled if Stripe webhook is missed (no `expireStalePending` for stripe rows like there is for crypto).
- VAT / sales tax / Stripe Tax: not configured. Selling to EU/UK/CA buyers without VAT collection is a legal liability above the threshold.

**📋 Nice-to-have**
- Coupons / promo codes.
- Annual-prepay discount UI affordance (the `yearly` price exists but there's no comparison nudge).
- Multi-currency display.

---

## 4. Data Integrity — **5/10**

**✅ Good**
- Spreads + multi-hop now use real CCXT data (commit `4d7970c`).
- Real orderbook fetch with 5 s TTL cache + graceful null-on-failure ([orderbook-service.ts:48](src/services/orderbook-service.ts:48)).
- Connection manager + circuit breaker + rate limiter under [src/exchanges/](src/exchanges/) — proper failover scaffolding.
- Symbol manager dynamically tracks active arbitrage symbols.
- Decimal math via `decimal.js` (not `Number`) in trading-critical paths — no float drift.

**🚨 Still fake**
- [src/analysis/nft-scanner.ts:179–210](src/analysis/nft-scanner.ts:179) — entire NFT opportunity feed is `Math.random()`. Floor prices, discounts, rarity ranks, marketplace assignment all fabricated.
- [src/dashboard-main.ts:30–130](src/dashboard-main.ts:30) — generates synthetic spreads. This is the **production `npm start` entrypoint** (`"start": "node dist/dashboard-main.js"` in package.json). Need to confirm prod actually starts the real scanner, not the mock generator.
- [src/dex/cex-dex-detector.ts:247](src/dex/cex-dex-detector.ts:247) — `priceImpact: 0` always. UI will show 0% slippage on every CEX↔DEX opportunity, which is misleading.
- [src/routes/spreads.ts:198](src/routes/spreads.ts:198) — multi-hop spread approximation; numbers shown to users aren't fully derived from intermediate prices.

**🔧 Fix before launch**
- Verify which entry the production container actually runs and whether it generates mocks.
- Either implement real NFT data (OpenSea/Blur/Reservoir API) **or** hide the NFT tab behind a "coming soon" flag. Showing fake numbers in a paid product is a refund risk.
- Wire real `priceImpact` from order book depth in `cex-dex-detector`.
- Fix multi-hop calculation or label the column "Estimated".

**📋 Nice-to-have**
- Persist orderbook snapshots for backtesting and dispute resolution.
- Per-exchange health dashboard for ops.

---

## 5. Infrastructure — **7/10**

**✅ Good**
- Multi-stage Dockerfile, non-root user, `read_only: true` on backend, `tmpfs` for /tmp, `no-new-privileges`.
- Compose: split `backend-net` / `frontend-net`; Postgres only on backend-net; backend bound to loopback.
- Healthchecks on both Postgres and backend with `start_period`.
- Resource limits set (`512M` backend, `1G` postgres).
- Log rotation: `max-size: 10m, max-file: 3` per service.
- Postgres tuning via mounted `postgres/postgresql.conf` + connection pool params in DSN (`connection_limit=15&pool_timeout=20`).
- DB backup script with 7-day rotation, idempotent, cron-friendly ([scripts/backup-db.sh](scripts/backup-db.sh)).
- VPS hardening script — UFW, fail2ban, SSH key-only ([scripts/harden-vps.sh](scripts/harden-vps.sh)).
- CI pipeline added recently (commit `2a9b149`).

**❌ Missing**
- **No monitoring or alerting.** No Sentry, Datadog, Prometheus, Grafana, UptimeRobot, BetterStack — `grep` returns zero matches. You will not know your site is down until a user emails you.
- **No log aggregation.** Pino logs go to container stdout → docker json-file driver → eventual rotation. No central viewer, no search, no retention policy.
- No backup *off-site*: the script writes to local disk. A VPS disk failure loses everything. Pipe to S3/B2 or rsync to a second host.
- No backup *restore drill* documented. Untested backups are theatre.
- No deployment runbook in `docs/` (only `payment-setup.md`).

**🔧 Fix before launch**
- Stand up at least one external uptime monitor pointing at `https://yourdomain/health` with email/Telegram alerts. (Free tier of UptimeRobot covers this.)
- Add Sentry to backend (`@sentry/node`) and frontend (`@sentry/react`) — single file, ~30 lines.
- Off-site rotation for `backups/`: `aws s3 sync` or `rclone` in the same cron.

**📋 Nice-to-have**
- Replace `dashboard-main.js` with a proper systemd / PM2 supervisor outside Docker, or add `tini` as PID 1 so signals work cleanly.
- `docker-compose.override.yml` for staging.
- TLS termination details aren't in compose — assuming nginx in `frontend` service handles it; verify cert renewal automation.

---

## 6. Legal — **1/10** 🚨

**❌ Missing — every single item.**
- **Terms of Service:** no `Terms.tsx`, no `terms.html`, no link from Landing or PricingPage. `grep -r "Terms"` in frontend returns nothing relevant.
- **Privacy Policy:** same — zero.
- **Cookie Consent:** none. You set httpOnly auth cookies + likely have analytics cookies; under GDPR/ePrivacy this is non-compliant for any EU visitor.
- **Risk Disclaimer:** none. You are showing live trading opportunities — most regulators (US, EU, UK, AU) require an explicit "not investment advice / past performance / capital at risk" notice.
- **Refund Policy:** none in `docs/` or frontend. Stripe requires this to be reachable from checkout.
- **Imprint / Company info:** not visible. EU sellers must show legal entity, address, registration number.
- **AML/KYC notice:** you accept crypto USDT payments. Depending on jurisdiction (e.g. EU MiCA, US FinCEN MSB) you may need a KYC tier and a "we may report transactions" notice.
- **Data Processing Addendum:** if any B2B customer asks, you have nothing to send.

**🔧 Fix before launch — minimum viable legal pack**
1. Generate baseline Terms + Privacy with [Termly](https://termly.io) or [Iubenda](https://iubenda.com) (~$10–30/mo). Customise to your data flows.
2. Add `<Footer>` with links to `/terms`, `/privacy`, `/refunds`, `/contact`.
3. Add a one-line **risk disclaimer** persistently visible in the dashboard footer ("Right Order is information only. Not investment advice. Crypto trading carries substantial risk.").
4. Cookie banner — even minimum-viable like [klaro!](https://klaro.org) or `cookie-consent-vanilla`. Block analytics until consent.
5. Have a lawyer sanity-check before you accept the first paying customer. This is not a place to save $300.

**📋 Nice-to-have**
- DMCA / abuse contact.
- Trademark filing for "Right Order".

---

## 7. UX — **6/10**

**Live test**
- ✅ `curl http://147.45.157.120:3100/` → **HTTP 200, 1.84 KB, 74 ms**. React Vite SPA shell loads. Solid SEO meta (OG, Twitter card, canonical, robots).
- ⚠️ `curl http://147.45.157.120:3100/health` → **timeout** (no response). The backend health check passes inside docker (`wget http://localhost:3000/health`) but it's not proxied through nginx to the public port. Means external uptime monitors can't probe it.
- ✅ `curl http://147.45.157.120:3100/api/auth/me` → 401 with proper JSON envelope. Auth gate is working in production.
- ⚠️ Site served on plain HTTP, port 3100, raw IP. **No TLS, no domain.** Zero customers will trust this with a credit card. Get the cert + DNS sorted before launch.

**✅ Good**
- React + Tailwind frontend with proper component split (`Landing`, `LoginPage`, `PricingPage`, `DashboardHome`, tabs for each strategy).
- WebSocket client with reconnect + ping/pong (`useWebSocket`).
- Error boundary present ([ErrorBoundary.tsx](frontend/src/components/ErrorBoundary.tsx)).
- Connection overlay for WS-down state.
- Mobile viewport configured.

**🔧 Fix before launch**
- Expose `/health` (and ideally `/api/health`) via the nginx config in the `frontend` service so external monitors and Docker swarm/k8s probes work.
- Ship behind HTTPS at a real domain. Letsencrypt + nginx, ~30 min of work.
- No 404 page seen, only the JSON envelope from `/api/health`. Frontend SPA fallback should serve `index.html` for unknown routes.
- No loading skeletons evidenced for the dashboard tables (visible `LoadingSpinner` exists; verify it gates initial paint).
- 1042 LOC across `Landing.tsx` + `PricingPage.tsx` + `LoginPage.tsx` — getting unwieldy; split when you next touch them.

**📋 Nice-to-have**
- Empty states with copy ("No spreads above 0.5% right now — try lowering the filter").
- Onboarding tour for first login.
- Keyboard shortcuts visible in a `?` modal.
- Light theme (preference exists in `UserPreferences` but no toggle UI seen).

---

## 8. Business — **4/10**

**✅ Good**
- Pricing tiers visible: Pro $39/mo, Elite $89/mo, Ultimate $199/mo with annual discounts (~25–30%).
- Plan-limit hooks on frontend (`usePlanLimits.ts`) — gating already wired.
- Free tier exists.

**❌ Missing**
- **Support channel.** No `support@` email, no help widget, no Telegram link, no Intercom, no Crisp, no Discord — nothing on the public surface. The single line `Contact support if you need immediate activation` in [PricingPage.tsx:324](frontend/src/components/PricingPage.tsx:324) doesn't link anywhere.
- **Analytics.** Zero matches for `gtag`, `posthog`, `mixpanel`, `amplitude`, `plausible`, `umami`. You have **no idea** how many visitors hit landing, where they drop off, or which plan converts.
- **Onboarding.** No welcome email, no first-run checklist, no `/onboarding` route, no sample alert, no demo data toggle.
- **Email infrastructure.** No Resend/Postmark/SendGrid integration — meaning no password reset, no payment receipt, no expiry warning. (Stripe sends its own receipts only if you toggle it on.)
- **Status page.** A paying customer will eventually see a 5xx and ask "is it me?" — you have no public statuspage.io / instatus.
- **Changelog / release notes.** Trust signal for a paid analytics product.

**🔧 Fix before launch**
1. Add a `support@rightorder.io` mailto in the footer + a Telegram channel link. Cheap, builds trust.
2. Drop in **Plausible or Umami** (cookie-friendly, GDPR-light) on the frontend — 1 line.
3. Hook up **Resend** for transactional email: welcome, reset, payment receipt, expiring-soon.
4. Add a "What's New" or `/changelog` page from your git history.

**📋 Nice-to-have**
- Affiliate program (high-leverage in the trading-tools niche).
- Public live demo (read-only) so visitors can see the dashboard before signing up.
- Comparison page vs CoinGlass / Cryptohopper / Hummingbot.
- Founders' page / About — humans buy from humans.

---

## Prioritised Pre-Launch Punch List

**P0 — must fix this week (will break or get you sued):**
1. Resolve `JWT_SECRET` env-var mismatch (§2). 30 min.
2. Add Terms / Privacy / Risk Disclaimer + cookie banner (§6). 1 day.
3. Add support email + footer with legal links (§6, §8). 30 min.
4. Hide or fix mock NFT data and CEX-DEX `priceImpact: 0` (§4). Half day.
5. Confirm prod entry point is the real scanner, not `generateMockSpread()` (§4). 30 min.
6. HTTPS + real domain (§7). Half day.

**P1 — fix before paid users hit ~50:**
7. Switch Stripe to `mode: 'subscription'` + Customer Portal (§3). 1 day.
8. Schedule the `expireStaleCryptoPayments` sweep + reconcile stuck Stripe pendings (§3). 2 hours.
9. Sentry + UptimeRobot (§5). 1 hour.
10. Off-site DB backup rotation (§5). 1 hour.
11. Plausible + Resend (§8). 2 hours.

**P2 — within first month:**
12. Integration tests on auth + payment webhook flows.
13. Stripe Tax / VAT collection.
14. Public status page.
15. Onboarding flow + welcome email.

---

*Score is a snapshot. The codebase is structurally sound — clean module boundaries, real data, good security primitives. The gaps are operational and legal, not architectural. Two days of focused work plus a $30 legal-template subscription closes most P0s.*
