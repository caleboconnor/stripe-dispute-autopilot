# stripe-dispute-autopilot (MVP)

A minimal Stripe dispute automation service focused on chargeback recovery workflows.

## Features in this MVP
- Stripe webhook ingestion for dispute events
- Automatic evidence packet construction
- Optional auto-submit to Stripe
- Lightweight dispute tracking endpoint

## Quick start

```bash
npm install
cp .env.example .env
# fill env values
npm run dev
```

### Required env vars
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `AUTO_SUBMIT=true|false`

## Stripe setup
1. Create a webhook endpoint to: `POST /webhooks/stripe`
2. Subscribe to:
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
3. Put webhook signing secret in `.env`

## Endpoints
- `GET /health`
- `GET /disputes`
- `POST /webhooks/stripe`

## Notes
This is intentionally an MVP scaffold. Next improvements:
- persistent DB storage
- per-merchant OAuth + multi-tenant architecture
- richer evidence ingestion (CRM, LMS, shipping, helpdesk)
- queue/retry system
- human QA approvals
