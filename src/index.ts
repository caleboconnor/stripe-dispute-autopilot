import 'dotenv/config';
import express from 'express';
import path from 'path';
import Stripe from 'stripe';
import { z } from 'zod';
import { buildEvidencePackage } from './lib/evidence';
import {
  addSubmissionAttempt,
  defaultMerchantSettings,
  findMerchantById,
  findMerchantByStripeAccountId,
  getDispute,
  getMetrics,
  listDisputes,
  listMerchants,
  markSubmitted,
  updateMerchantEvidenceProfile,
  updateMerchantSettings,
  upsertDispute,
  upsertMerchant,
  defaultEvidenceProfile,
} from './lib/store';

const env = z
  .object({
    PORT: z.string().default('3000'),
    APP_BASE_URL: z.string().default('http://localhost:3000'),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    STRIPE_CLIENT_ID: z.string().optional(),
  })
  .parse(process.env);

const platformStripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-08-27.basil',
});

const app = express();
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'stripe-dispute-autopilot', ts: new Date().toISOString() });
});

app.get('/api/merchants', (_req, res) => {
  res.json({ merchants: listMerchants() });
});

app.patch('/api/merchants/:merchantId/settings', (req, res) => {
  const updated = updateMerchantSettings(req.params.merchantId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'merchant_not_found' });
  return res.json({ merchant: updated });
});

app.patch('/api/merchants/:merchantId/evidence-profile', (req, res) => {
  const updated = updateMerchantEvidenceProfile(req.params.merchantId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'merchant_not_found' });
  return res.json({ merchant: updated });
});

app.get('/disputes', (req, res) => {
  const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
  res.json({ disputes: listDisputes(merchantId) });
});

app.get('/disputes/:id', (req, res) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'dispute_not_found' });
  return res.json({ dispute });
});

app.get('/metrics', (req, res) => {
  const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
  return res.json({ metrics: getMetrics(merchantId) });
});

// Manual retry endpoint
app.post('/disputes/:id/retry-submit', async (req, res) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'dispute_not_found' });

  const merchant = findMerchantById(dispute.merchantId);
  const stripe = merchant ? new Stripe(merchant.stripeAccessToken, { apiVersion: '2025-08-27.basil' }) : platformStripe;

  try {
    const payload: Stripe.DisputeUpdateParams = {
      evidence: {
        uncategorized_text: `Retry submission from portal at ${new Date().toISOString()}`,
      },
      submit: true,
    };
    await stripe.disputes.update(dispute.id, payload);
    markSubmitted(dispute.id);
    addSubmissionAttempt(dispute.id, {
      at: new Date().toISOString(),
      success: true,
      message: 'Manual retry submission successful.',
    });
    return res.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    addSubmissionAttempt(dispute.id, { at: new Date().toISOString(), success: false, message: msg });
    return res.status(500).json({ error: 'submit_failed', message: msg });
  }
});

// Start Stripe OAuth (Connect)
app.get('/auth/stripe/start', (req, res) => {
  if (!env.STRIPE_CLIENT_ID) return res.status(400).send('Missing STRIPE_CLIENT_ID in environment');
  const merchantName = typeof req.query.merchantName === 'string' ? req.query.merchantName : 'Merchant';
  const state = Buffer.from(JSON.stringify({ merchantName, ts: Date.now() })).toString('base64url');
  const redirectUri = `${env.APP_BASE_URL}/auth/stripe/callback`;
  const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
    env.STRIPE_CLIENT_ID,
  )}&scope=read_write&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

app.get('/auth/stripe/callback', async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code) return res.status(400).send('Missing code');

    const state = stateRaw
      ? (JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as { merchantName?: string })
      : {};

    const tokenResp = await platformStripe.oauth.token({ grant_type: 'authorization_code', code });
    const merchantId = tokenResp.stripe_user_id || `acct_unknown_${Date.now()}`;

    upsertMerchant({
      id: merchantId,
      name: state.merchantName || merchantId,
      stripeAccountId: tokenResp.stripe_user_id || merchantId,
      stripeAccessToken: tokenResp.access_token || '',
      createdAt: new Date().toISOString(),
      settings: defaultMerchantSettings(),
      evidenceProfile: defaultEvidenceProfile(),
    });

    return res.redirect('/portal.html?connected=1');
  } catch (err) {
    console.error('Stripe OAuth callback error', err);
    return res.status(500).send('OAuth exchange failed');
  }
});

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.header('stripe-signature');
  if (!sig) return res.status(400).send('Missing stripe-signature');

  let event: Stripe.Event;
  try {
    event = platformStripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  try {
    const stripeAccountId = event.account;
    const merchant = findMerchantByStripeAccountId(stripeAccountId);
    const stripeForMerchant = merchant
      ? new Stripe(merchant.stripeAccessToken, { apiVersion: '2025-08-27.basil' })
      : platformStripe;

    if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.updated') {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;

      let customerEmail = '';
      let customerName = '';
      if (chargeId) {
        const charge = await stripeForMerchant.charges.retrieve(chargeId);
        customerEmail = charge.billing_details?.email || '';
        customerName = charge.billing_details?.name || '';
      }

      const profile = merchant?.evidenceProfile || defaultEvidenceProfile();
      const built = buildEvidencePackage({
        dispute,
        customerEmail,
        customerName,
        productDescription: profile.productDescriptionTemplate,
        termsUrl: profile.termsUrl,
        refundPolicyUrl: profile.refundPolicyUrl,
        cancellationPolicyUrl: profile.cancellationPolicyUrl,
        accessLog: profile.deliveryProofTemplate,
        supportInteraction: `${profile.supportPolicyTemplate || ''}\n${profile.onboardingProofTemplate || ''}`.trim(),
      });

      const settings = merchant?.settings || defaultMerchantSettings();
      const reasonAllowed = settings.autoSubmitReasons.length
        ? settings.autoSubmitReasons.includes(dispute.reason)
        : true;
      const manualReviewRequired = dispute.amount >= settings.manualReviewAmountThreshold;
      const shouldAutoSubmit =
        settings.autoSubmitEnabled && reasonAllowed && built.score >= settings.minEvidenceScore && !manualReviewRequired;

      built.payload.submit = shouldAutoSubmit;

      await stripeForMerchant.disputes.update(dispute.id, built.payload);

      upsertDispute({
        id: dispute.id,
        merchantId: merchant?.id,
        stripeAccountId,
        chargeId,
        reason: dispute.reason,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        dueBy: dispute.evidence_details?.due_by ?? undefined,
        updatedAt: new Date().toISOString(),
        submitted: shouldAutoSubmit,
        evidenceScore: built.score,
        manualReviewRequired,
        evidenceSummary: built.summary,
        submissionAttempts: [
          {
            at: new Date().toISOString(),
            success: true,
            message: shouldAutoSubmit ? 'Auto-submitted successfully.' : 'Evidence updated; pending review.',
          },
        ],
      });

      if (shouldAutoSubmit) markSubmitted(dispute.id);
    }

    if (event.type === 'charge.dispute.closed') {
      const dispute = event.data.object as Stripe.Dispute;
      const existing = getDispute(dispute.id);
      upsertDispute({
        id: dispute.id,
        merchantId: existing?.merchantId,
        stripeAccountId,
        chargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
        reason: dispute.reason,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        dueBy: dispute.evidence_details?.due_by ?? undefined,
        updatedAt: new Date().toISOString(),
        submitted: true,
        evidenceScore: existing?.evidenceScore ?? 0,
        manualReviewRequired: existing?.manualReviewRequired ?? false,
        evidenceSummary: existing?.evidenceSummary ?? [],
        submissionAttempts: existing?.submissionAttempts ?? [],
      });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

const port = Number(env.PORT);
app.listen(port, () => {
  console.log(`stripe-dispute-autopilot listening on :${port}`);
});
