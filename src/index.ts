import 'dotenv/config';
import express from 'express';
import path from 'path';
import Stripe from 'stripe';
import { z } from 'zod';
import { buildEvidencePackage, generateEvidenceDraft } from './lib/evidence';
import {
  addSubmissionAttempt,
  defaultMerchantSettings,
  findMerchantById,
  findMerchantByStripeAccountId,
  getDispute,
  getMetrics,
  listDisputes,
  listMerchants,
  markDeflected,
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
    AUTO_RETRY_ENABLED: z.string().optional(),
    AUTO_RETRY_INTERVAL_MS: z.string().default('60000'),
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

app.get('/api/version', (_req, res) => {
  res.json({
    service: 'stripe-dispute-autopilot',
    deployedAt: new Date().toISOString(),
    features: [
      'merchant-connect',
      'reason-scoring',
      'auto-submit-rules',
      'coaching-evidence-profiles',
      'retry-sweep',
      'recommendations',
      'evidence-draft-generator',
      'descriptor-receipt-clarity',
    ],
  });
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

app.post('/api/merchants/:merchantId/optimize-reasons', (req, res) => {
  const merchant = findMerchantById(req.params.merchantId);
  if (!merchant) return res.status(404).json({ error: 'merchant_not_found' });

  const minCases = Number(req.body?.minCases || 3);
  const minWinRatePct = Number(req.body?.minWinRatePct || 30);
  const metrics = getMetrics(merchant.id);
  const byReason = metrics.byReason || {};

  const riskyReasons = Object.entries(byReason)
    .filter(([, v]) => v.total >= minCases)
    .filter(([, v]) => (v.won / Math.max(1, v.total)) * 100 < minWinRatePct)
    .map(([reason]) => reason);

  const observedReasons = Object.keys(byReason);
  const nextAllowed = observedReasons.filter((reason) => !riskyReasons.includes(reason));

  const currentReasons = merchant.settings.autoSubmitReasons || [];
  const fallbackToCurrent = nextAllowed.length === 0 ? currentReasons : nextAllowed;

  const updated = updateMerchantSettings(merchant.id, {
    autoSubmitReasons: fallbackToCurrent,
  });

  return res.json({
    merchant: updated,
    optimized: true,
    minCases,
    minWinRatePct,
    riskyReasons,
    autoSubmitReasons: updated?.settings.autoSubmitReasons || [],
    note:
      nextAllowed.length === 0
        ? 'No safe reason codes met thresholds; kept current auto-submit list.'
        : 'Auto-submit reasons updated based on recent win-rate performance.',
  });
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

app.get('/disputes/:id/evidence-draft', (req, res) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'dispute_not_found' });

  const merchant = dispute.merchantId ? findMerchantById(dispute.merchantId) : undefined;
  const profile = merchant?.evidenceProfile || defaultEvidenceProfile();
  const draft = generateEvidenceDraft({
    disputeId: dispute.id,
    reason: dispute.reason,
    amount: dispute.amount,
    currency: dispute.currency,
    dueBy: dispute.dueBy,
    evidenceSummary: dispute.evidenceSummary,
    productDescription: profile.productDescriptionTemplate,
    termsUrl: profile.termsUrl,
    refundPolicyUrl: profile.refundPolicyUrl,
    cancellationPolicyUrl: profile.cancellationPolicyUrl,
    onboardingProof: profile.onboardingProofTemplate,
    deliveryProof: profile.deliveryProofTemplate,
    supportPolicy: profile.supportPolicyTemplate,
  });

  return res.json({ draft });
});

app.get('/disputes/:id/receipt-clarity-draft', (req, res) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'dispute_not_found' });

  const merchant = dispute.merchantId ? findMerchantById(dispute.merchantId) : undefined;
  const settings = merchant?.settings || defaultMerchantSettings();
  const profile = merchant?.evidenceProfile || defaultEvidenceProfile();

  const clarityDraft = {
    headline: `Receipt clarity draft for ${dispute.id}`,
    statementDescriptor: settings.statementDescriptor || '[set descriptor] ',
    customerSupport: {
      email: settings.supportEmail || '[set support email]',
      phone: settings.supportPhone || '[set support phone]',
      url: settings.supportUrl || '[set support portal]',
    },
    receiptFooterTemplate: [
      `Need help with your purchase? Contact ${settings.supportEmail || '[support-email]'}${
        settings.supportPhone ? ` or call ${settings.supportPhone}` : ''
      }.`,
      `Manage refunds/cancellations: ${settings.supportUrl || profile.cancellationPolicyUrl || '[support-url]'}`,
      `Statement descriptor: ${settings.statementDescriptor || '[descriptor]'}`,
    ].join(' '),
  };

  return res.json({ draft: clarityDraft });
});

app.get('/metrics', (req, res) => {
  const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
  return res.json({ metrics: getMetrics(merchantId) });
});

function getSubmissionReadiness(disputeId: string) {
  const dispute = getDispute(disputeId);
  if (!dispute) {
    return { ready: false, reason: 'dispute_not_found' as const, priority: 0 };
  }

  const merchant = findMerchantById(dispute.merchantId);
  const settings = merchant?.settings || defaultMerchantSettings();
  const reasonAllowed = settings.autoSubmitReasons.length
    ? settings.autoSubmitReasons.includes(dispute.reason)
    : true;

  const nowSec = Math.floor(Date.now() / 1000);
  const delayWindowSec = (settings.submissionDelayMinutes || 0) * 60;
  const isWithinDelayWindow = !!(
    dispute.disputeCreatedAt &&
    delayWindowSec > 0 &&
    nowSec - dispute.disputeCreatedAt < delayWindowSec
  );

  if (dispute.status === 'won' || dispute.status === 'lost') return { ready: false, reason: 'closed', priority: 0 };
  if (dispute.submitted) return { ready: false, reason: 'already_submitted', priority: 0 };
  if (!settings.autoSubmitEnabled) return { ready: false, reason: 'auto_submit_disabled', priority: 20 };
  if (!reasonAllowed) return { ready: false, reason: 'reason_not_allowed', priority: 25 };
  if (dispute.manualReviewRequired) return { ready: false, reason: 'manual_review_required', priority: 95 };
  if (isWithinDelayWindow) return { ready: false, reason: 'submission_delay_window_active', priority: 60 };
  if ((dispute.evidenceScore || 0) < settings.minEvidenceScore) return { ready: false, reason: 'score_below_threshold', priority: 85 };

  const dueBy = dispute.dueBy || 0;
  const secondsToDue = dueBy ? dueBy - nowSec : undefined;
  const dueUrgency = !secondsToDue
    ? 50
    : secondsToDue < 0
      ? 100
      : secondsToDue <= 4 * 60 * 60
        ? 98
        : secondsToDue <= 24 * 60 * 60
          ? 90
          : secondsToDue <= 48 * 60 * 60
            ? 80
            : 65;

  const amountUrgency = Math.min(25, Math.round((dispute.amount || 0) / 5000));
  const priority = Math.min(100, dueUrgency + amountUrgency);

  return { ready: true, reason: 'ready' as const, priority };
}

app.get('/api/disputes/queue', (req, res) => {
  const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
  const disputes = listDisputes(merchantId).filter((d) => d.status !== 'won' && d.status !== 'lost');

  const queue = disputes
    .map((d) => {
      const readiness = getSubmissionReadiness(d.id);
      return {
        id: d.id,
        merchantId: d.merchantId,
        reason: d.reason,
        status: d.status,
        amount: d.amount,
        currency: d.currency,
        dueBy: d.dueBy,
        evidenceScore: d.evidenceScore,
        submitted: d.submitted,
        deflected: d.deflected,
        readiness,
      };
    })
    .sort((a, b) => b.readiness.priority - a.readiness.priority);

  const summary = {
    totalOpen: queue.length,
    ready: queue.filter((d) => d.readiness.ready).length,
    manualReview: queue.filter((d) => d.readiness.reason === 'manual_review_required').length,
    delayWindow: queue.filter((d) => d.readiness.reason === 'submission_delay_window_active').length,
    blockedByScore: queue.filter((d) => d.readiness.reason === 'score_below_threshold').length,
    blockedByReason: queue.filter((d) => d.readiness.reason === 'reason_not_allowed').length,
    overdue: queue.filter((d) => d.dueBy && d.dueBy < Math.floor(Date.now() / 1000)).length,
    dueIn48h: queue.filter((d) => d.dueBy && d.dueBy > Math.floor(Date.now() / 1000) && d.dueBy - Math.floor(Date.now() / 1000) <= 48 * 60 * 60).length,
  };

  return res.json({ summary, queue });
});

app.get('/recommendations', (req, res) => {
  const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
  const metrics = getMetrics(merchantId);
  const disputes = listDisputes(merchantId);
  const merchant = merchantId ? findMerchantById(merchantId) : undefined;
  const settings = merchant?.settings || defaultMerchantSettings();
  const recommendations: string[] = [];

  if (merchantId) {
    if (!settings.statementDescriptor) {
      recommendations.push('Set a clear statement descriptor in merchant settings to reduce "unrecognized charge" disputes.');
    }
    if (!settings.supportEmail && !settings.supportPhone && !settings.supportUrl) {
      recommendations.push('Add visible support contact channels (email/phone/portal) for receipt clarity and faster pre-dispute resolution.');
    }
  }

  if (metrics.avgEvidenceScore < 75) {
    recommendations.push('Increase evidence quality: add stronger onboarding, delivery, and support proofs in Evidence Profile.');
  }
  if (metrics.winRate < 40 && metrics.total >= 5) {
    recommendations.push('Win rate is low: tighten reason-code playbooks and raise minimum evidence score before auto-submit.');
  }

  const weakReasons = Object.entries(metrics.byReason || {})
    .filter(([, v]) => v.total >= 3)
    .filter(([, v]) => (v.won / Math.max(1, v.total)) * 100 < 30)
    .map(([reason]) => reason);
  if (weakReasons.length) {
    recommendations.push(
      `Weak reason-code performance detected: ${weakReasons.join(', ')}. Consider disabling auto-submit for these (use Optimize Reasons).`,
    );
  }
  const reviewQueue = disputes.filter((d) => d.manualReviewRequired && !d.submitted).length;
  if (reviewQueue > 0) {
    recommendations.push(`${reviewQueue} high-value disputes need manual review; process these first to avoid deadline misses.`);
  }
  const lowValueOpen = disputes.filter((d) => !d.submitted && !d.deflected && d.amount <= 5000 && d.status !== 'won' && d.status !== 'lost').length;
  if (lowValueOpen > 0) {
    recommendations.push(`${lowValueOpen} low-value open disputes are candidates for inquiry deflection (proactive refund) to protect ratio and reduce ops load.`);
  }

  if ((settings.submissionDelayMinutes || 0) > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const delayedQueue = disputes.filter(
      (d) =>
        !d.submitted &&
        d.status !== 'won' &&
        d.status !== 'lost' &&
        d.disputeCreatedAt &&
        nowSec - d.disputeCreatedAt < settings.submissionDelayMinutes * 60,
    ).length;
    if (delayedQueue > 0) {
      recommendations.push(
        `${delayedQueue} disputes are currently held by submission delay (${settings.submissionDelayMinutes}m) for internal review before auto-submit.`,
      );
    }
  }
  if (metrics.overdue > 0) {
    recommendations.push(`${metrics.overdue} disputes are already overdue and unsubmitted. Trigger submission sweep + assign manual owner immediately.`);
  }
  if (metrics.dueSoon > 0) {
    recommendations.push(`${metrics.dueSoon} disputes are due in <48h. Prioritize submissions or enable stricter auto-submit for safe reason codes.`);
  }

  if (settings.monthlyTransactionCount > 0) {
    const ratioPct = Number(((metrics.monthlyDisputes / settings.monthlyTransactionCount) * 100).toFixed(2));
    if (ratioPct >= settings.monthlyDisputeAlertThresholdPct) {
      recommendations.push(
        `Chargeback ratio alert: ${ratioPct}% this month (threshold ${settings.monthlyDisputeAlertThresholdPct}%). Tighten fraud filters and issue proactive refunds on risky tickets.`,
      );
    }
  }

  if (!recommendations.length) {
    recommendations.push('System looks healthy. Next step: connect real fulfillment/support data sources to further improve win rates.');
  }

  return res.json({ recommendations });
});

// Manual retry endpoint
app.post('/jobs/run-submissions', async (_req, res) => {
  await runAutoRetrySweep();
  return res.json({ ok: true });
});

app.post('/disputes/:id/retry-submit', async (req, res) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'dispute_not_found' });

  const out = await attemptSubmit(dispute.id);
  if (!out.ok && out.message !== 'already_submitted') {
    return res.status(500).json({ error: 'submit_failed', message: out.message });
  }
  return res.json({ ok: true, message: out.message });
});

app.post('/disputes/:id/deflect', async (req, res) => {
  const dispute = getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'dispute_not_found' });
  if (!dispute.chargeId) return res.status(400).json({ error: 'missing_charge_id' });
  if (dispute.deflected) return res.json({ ok: true, message: 'already_deflected' });

  const merchant = findMerchantById(dispute.merchantId);
  const stripe = merchant
    ? new Stripe(merchant.stripeAccessToken, { apiVersion: '2025-08-27.basil' })
    : platformStripe;

  try {
    const refund = await stripe.refunds.create({
      charge: dispute.chargeId,
      metadata: {
        dispute_id: dispute.id,
        source: 'autopilot_deflection',
      },
      reason: 'requested_by_customer',
    });

    markDeflected(dispute.id, `Proactive refund ${refund.id} issued before representment.`);
    return res.json({ ok: true, refundId: refund.id });
  } catch (err) {
    return res.status(500).json({ error: 'deflection_failed', message: (err as Error).message });
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



async function attemptSubmit(disputeId: string) {
  const dispute = getDispute(disputeId);
  if (!dispute) return { ok: false, message: 'dispute_not_found' };

  const readiness = getSubmissionReadiness(disputeId);
  if (!readiness.ready) return { ok: false, message: readiness.reason };

  const merchant = findMerchantById(dispute.merchantId);
  const stripe = merchant
    ? new Stripe(merchant.stripeAccessToken, { apiVersion: '2025-08-27.basil' })
    : platformStripe;

  try {
    const payload: Stripe.DisputeUpdateParams = {
      evidence: {
        uncategorized_text: `Auto retry submit at ${new Date().toISOString()}`,
      },
      submit: true,
    };
    await stripe.disputes.update(dispute.id, payload);
    markSubmitted(dispute.id);
    addSubmissionAttempt(dispute.id, {
      at: new Date().toISOString(),
      success: true,
      message: 'Auto retry submission successful.',
    });
    return { ok: true, message: 'submitted' };
  } catch (err) {
    const msg = (err as Error).message;
    addSubmissionAttempt(dispute.id, { at: new Date().toISOString(), success: false, message: msg });
    return { ok: false, message: msg };
  }
}

async function runAutoRetrySweep() {
  const all = listDisputes();
  const pending = all.filter((d) => !d.submitted && d.status !== 'won' && d.status !== 'lost');
  for (const d of pending) {
    await attemptSubmit(d.id);
  }
}

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
      let chargeStatementDescriptor = '';
      if (chargeId) {
        const charge = await stripeForMerchant.charges.retrieve(chargeId);
        customerEmail = charge.billing_details?.email || '';
        customerName = charge.billing_details?.name || '';
        chargeStatementDescriptor =
          charge.calculated_statement_descriptor ||
          charge.statement_descriptor ||
          charge.statement_descriptor_suffix ||
          '';
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
        statementDescriptor: chargeStatementDescriptor || merchant?.settings.statementDescriptor,
        supportEmail: merchant?.settings.supportEmail,
        supportPhone: merchant?.settings.supportPhone,
        supportUrl: merchant?.settings.supportUrl,
      });

      const settings = merchant?.settings || defaultMerchantSettings();
      if (settings.statementDescriptor) {
        if (!chargeStatementDescriptor) {
          built.summary.push('No statement descriptor detected on charge. Configure descriptor to reduce unrecognized transaction disputes.');
        } else if (!chargeStatementDescriptor.toLowerCase().includes(settings.statementDescriptor.toLowerCase())) {
          built.summary.push(
            `Descriptor mismatch: expected similar to "${settings.statementDescriptor}", got "${chargeStatementDescriptor}".`,
          );
        }
      }

      const reasonAllowed = settings.autoSubmitReasons.length
        ? settings.autoSubmitReasons.includes(dispute.reason)
        : true;
      const manualReviewRequired = dispute.amount >= settings.manualReviewAmountThreshold;
      const nowSec = Math.floor(Date.now() / 1000);
      const delayWindowSec = (settings.submissionDelayMinutes || 0) * 60;
      const delaySatisfied = delayWindowSec <= 0 || nowSec - dispute.created >= delayWindowSec;
      const shouldAutoSubmit =
        settings.autoSubmitEnabled && reasonAllowed && built.score >= settings.minEvidenceScore && !manualReviewRequired && delaySatisfied;

      built.payload.submit = shouldAutoSubmit;

      await stripeForMerchant.disputes.update(dispute.id, built.payload);

      const existing = getDispute(dispute.id);
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
        disputeCreatedAt: existing?.disputeCreatedAt ?? dispute.created,
        updatedAt: new Date().toISOString(),
        submitted: shouldAutoSubmit,
        deflected: existing?.deflected,
        deflectionReason: existing?.deflectionReason,
        deflectedAt: existing?.deflectedAt,
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
        disputeCreatedAt: existing?.disputeCreatedAt ?? dispute.created,
        updatedAt: new Date().toISOString(),
        submitted: true,
        deflected: existing?.deflected,
        deflectionReason: existing?.deflectionReason,
        deflectedAt: existing?.deflectedAt,
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

if (env.AUTO_RETRY_ENABLED === 'true') {
  const ms = Number(env.AUTO_RETRY_INTERVAL_MS || '60000');
  setInterval(() => {
    runAutoRetrySweep().catch((err) => console.error('auto-retry sweep failed', err));
  }, ms);
}

const port = Number(env.PORT);
app.listen(port, () => {
  console.log(`stripe-dispute-autopilot listening on :${port}`);
});
