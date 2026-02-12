# stripe-dispute-autopilot (MVP)

A Stripe dispute automation MVP focused on chargeback recovery workflows.

## Features in this build
- Stripe webhook ingestion for dispute events
- Automatic evidence packet construction
- Optional auto-submit (`AUTO_SUBMIT=true`)
- Merchant portal UI (`/portal.html`)
- Stripe Connect OAuth flow for merchant account linking
- Persistent local JSON storage (`data/db.json`) for merchants + disputes

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
