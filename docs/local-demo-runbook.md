# Local demo runbook

This runbook is for a safe buyer demonstration. It uses local, non-production configuration only.

## Prerequisites

- Docker Desktop running.
- Node.js 20 or newer.

## Demo flow

1. Copy `.env.example` into a new local-only environment file.
2. Use newly generated local PostgreSQL and JWT values; never reuse production credentials.
3. Start the isolated Compose project with distinct local ports.
4. Run Prisma migrations inside the backend container.
5. Open the dashboard, label all sample/fixture values honestly, and walk through the product architecture and deployment guide.

## Do not disclose

- Production `.env` files, exchange credentials, payment credentials, wallet addresses, customer data or personal accounts.
- VPS access or a source archive before buyer qualification and agreed diligence terms.

## Handover checklist

- Buyer clones the release commit and runs the local demo successfully.
- Buyer receives a fresh environment template only.
- Buyer creates or connects its own payment, exchange, infrastructure and domain accounts.
- Transfer occurs after cleared payment under agreed escrow or contract terms.
