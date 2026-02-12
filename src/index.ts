import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { buildEvidencePayload } from './lib/evidence';
import { listDisputes, markSubmitted, upsertDispute } from './lib/store';

const env = z
  .object({
    PORT: z.string().default('3000'),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    AUTO_SUBMIT: z.string().optional(),
  })
  .parse(process.env);

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-08-27.basil',
});

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'stripe-dispute-autopilot', ts: new Date().toISOString() });
});

app.get('/disputes', (_req, res) => {
  res.json({ disputes: listDisputes() });
});

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.header('stripe-signature');
  if (!sig) {
    return res.status(400).send('Missing stripe-signature');
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  try {
    if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.updated') {
      const dispute = event.data.object as Stripe.Dispute;

      upsertDispute({
        id: dispute.id,
        chargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
        reason: dispute.reason,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        dueBy: dispute.evidence_details?.due_by ?? undefined,
        updatedAt: new Date().toISOString(),
        submitted: dispute.status === 'warning_needs_response' ? false : false,
      });

      // Pull charge/customer details for stronger evidence
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      let customerEmail = '';
      let customerName = '';
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        customerEmail = charge.billing_details?.email || '';
        customerName = charge.billing_details?.name || '';
      }

      const payload = buildEvidencePayload({
        dispute,
        customerEmail,
        customerName,
        productDescription: 'Digital product/service fulfilled per purchase terms.',
        termsUrl: 'https://example.com/terms',
        refundPolicyUrl: 'https://example.com/refund-policy',
        cancellationPolicyUrl: 'https://example.com/cancellation-policy',
        accessLog: 'Customer access and delivery logs available on request.',
        supportInteraction: 'Support communications retained and available.',
      });

      payload.submit = env.AUTO_SUBMIT === 'true';

      await stripe.disputes.update(dispute.id, payload);
      if (payload.submit) {
        markSubmitted(dispute.id);
      }
    }

    if (event.type === 'charge.dispute.closed') {
      const dispute = event.data.object as Stripe.Dispute;
      upsertDispute({
        id: dispute.id,
        chargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
        reason: dispute.reason,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        dueBy: dispute.evidence_details?.due_by ?? undefined,
        updatedAt: new Date().toISOString(),
        submitted: true,
      });
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

const port = Number(env.PORT);
app.listen(port, () => {
  console.log(`stripe-dispute-autopilot listening on :${port}`);
});
