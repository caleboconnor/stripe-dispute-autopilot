# stripe-dispute-autopilot (MVP)

A Stripe dispute automation MVP focused on chargeback recovery workflows.

## Features in this build
- Stripe webhook ingestion for dispute events
- Reason-code evidence playbooks + evidence quality scoring
- Merchant-level automation settings (auto-submit, thresholds, allowed reason codes, statement descriptor, support channels)
- Info/coaching evidence profiles (terms/refund/cancellation/onboarding/delivery/support templates)
- Optional auto-submit based on score/rules (with manual review threshold)
- Merchant portal UI (`/portal.html`) with KPIs, deadline risk tracking, dispute ratio alerts, retry-submit, and one-click deflection refund action
- Stripe Connect OAuth flow for merchant account linking
- Alerts ingestion pipeline with duplicate detection + optional auto-refund deflection
- Inquiry queue endpoints (PayPal/Klarna/Afterpay/eBay) for early-stage dispute handling
- Success-fee + ROI estimate endpoint for pay-on-recovery pricing model
- Persistent local JSON storage (`data/db.json`) for merchants + disputes + alerts + inquiries + submission attempts

## Quick start

```bash
npm install
cp .env.example .env
# fill env values
npm run dev
```

## Required env vars
- `PORT`
- `APP_BASE_URL` (e.g. `http://localhost:3000`)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CLIENT_ID` (for Connect OAuth)
- `AUTO_SUBMIT=true|false`

## App URLs
- Dashboard: `http://localhost:3000/`
- Merchant portal: `http://localhost:3000/portal.html`

## Stripe setup
1. Create/connect a Stripe Connect application and set redirect URI:
   - `${APP_BASE_URL}/auth/stripe/callback`
2. Create webhook endpoint:
   - `POST ${APP_BASE_URL}/webhooks/stripe`
3. Subscribe to events:
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
4. Add webhook secret and keys to `.env`

## Endpoints
- `GET /health`
- `GET /api/merchants`
- `GET /disputes?merchantId=<optional>`
- `GET /disputes/:id/receipt-clarity-draft`
- `PATCH /disputes/:id/workflow` (owner/status/next action/notes)
- `POST /disputes/:id/retry-submit`
- `POST /disputes/:id/deflect`
- `GET /metrics?merchantId=<optional>`
- `GET /recommendations?merchantId=<optional>`
- `GET /api/disputes/queue?merchantId=<optional>` (prioritized open-dispute queue with readiness reasons)
- `GET /api/alerts?merchantId=<optional>`
- `POST /api/alerts/ingest` (dedupe + optional auto-refund)
- `GET /api/inquiries?merchantId=<optional>`
- `POST /api/inquiries`
- `PATCH /api/inquiries/:id`
- `GET /api/pricing/estimate?merchantId=<optional>`
- `GET /auth/stripe/start?merchantName=...`
- `GET /auth/stripe/callback`
- `POST /webhooks/stripe`

## How to verify it works
1. Run app with real Stripe test keys.
2. Open `/portal.html` and connect a Stripe account.
3. Use Stripe CLI to forward webhooks:
   ```bash
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```
4. Trigger a test dispute flow in Stripe test mode.
5. Confirm dispute appears in portal and evidence is updated/submitted in Stripe.

## Next improvements (recommended)
- Postgres + proper ORM
- per-merchant policy/evidence settings
- integrations (Shopify, Kajabi, support desk, LMS)
- approval workflow + audit logs
- role-based auth + billing
