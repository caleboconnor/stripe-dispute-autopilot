import Stripe from 'stripe';

function trim(v?: string | null): string {
  return (v || '').trim();
}

export type EvidenceInput = {
  dispute: Stripe.Dispute;
  customerEmail?: string;
  customerName?: string;
  productDescription?: string;
  termsUrl?: string;
  refundPolicyUrl?: string;
  cancellationPolicyUrl?: string;
  accessLog?: string;
  supportInteraction?: string;
  shippingCarrier?: string;
  shippingTrackingNumber?: string;
  shippingDate?: string;
};

export type BuiltEvidence = {
  payload: Stripe.DisputeUpdateParams;
  score: number;
  summary: string[];
};

export type EvidenceDraft = {
  headline: string;
  narrative: string;
  checklist: string[];
  suggestedAttachments: string[];
};

function scoreEvidence(i: EvidenceInput, summary: string[]): number {
  let score = 0;
  if (i.customerName) score += 10;
  if (i.customerEmail) score += 10;
  if (i.productDescription) score += 15;
  if (i.supportInteraction) score += 15;
  if (i.termsUrl) score += 10;
  if (i.refundPolicyUrl) score += 10;
  if (i.cancellationPolicyUrl) score += 10;
  if (i.accessLog) score += 10;
  if (i.shippingTrackingNumber) score += 10;

  summary.push(`Evidence score: ${Math.min(100, score)}/100`);
  return Math.min(100, score);
}

function reasonSpecificSummary(reason: string): string[] {
  switch (reason) {
    case 'fraudulent':
      return ['Applied fraud playbook: customer identity + transaction legitimacy evidence.'];
    case 'product_not_received':
      return ['Applied delivery playbook: shipment + delivery proof focus.'];
    case 'product_unacceptable':
      return ['Applied product-quality playbook: product description + support history focus.'];
    case 'subscription_canceled':
      return ['Applied subscription playbook: cancellation/refund policy + service timeline focus.'];
    case 'duplicate':
      return ['Applied duplicate-charge playbook: single-charge validation and transaction mapping.'];
    default:
      return ['Applied general playbook: complete transaction and policy evidence pack.'];
  }
}

export function buildEvidencePackage(input: EvidenceInput): BuiltEvidence {
  const reason = input.dispute.reason;
  const summary: string[] = [...reasonSpecificSummary(reason)];

  const base: Stripe.DisputeUpdateParams = {
    evidence: {
      customer_name: trim(input.customerName),
      customer_email_address: trim(input.customerEmail),
      product_description: trim(input.productDescription),
      service_date: trim(input.shippingDate),
      access_activity_log: trim(input.accessLog),
      customer_communication: trim(input.supportInteraction),
      uncategorized_text: `Automated evidence packet generated for reason=${reason}`,
    },
    submit: false,
  };

  if (input.termsUrl) {
    base.evidence = {
      ...base.evidence,
      uncategorized_text: `${base.evidence?.uncategorized_text}\nTerms: ${input.termsUrl}`,
    };
  }

  if (input.refundPolicyUrl) {
    base.evidence = {
      ...base.evidence,
      uncategorized_text: `${base.evidence?.uncategorized_text}\nRefund policy: ${input.refundPolicyUrl}`,
    };
  }

  if (input.cancellationPolicyUrl) {
    base.evidence = {
      ...base.evidence,
      uncategorized_text: `${base.evidence?.uncategorized_text}\nCancellation policy: ${input.cancellationPolicyUrl}`,
    };
  }

  if (input.shippingCarrier && input.shippingTrackingNumber) {
    base.evidence = {
      ...base.evidence,
      shipping_carrier: input.shippingCarrier,
      shipping_tracking_number: input.shippingTrackingNumber,
    };
  }

  const score = scoreEvidence(input, summary);
  return { payload: base, score, summary };
}

export function generateEvidenceDraft(input: {
  disputeId: string;
  reason: string;
  amount: number;
  currency?: string;
  dueBy?: number;
  evidenceSummary?: string[];
  productDescription?: string;
  termsUrl?: string;
  refundPolicyUrl?: string;
  cancellationPolicyUrl?: string;
  onboardingProof?: string;
  deliveryProof?: string;
  supportPolicy?: string;
}): EvidenceDraft {
  const reasonTemplates: Record<string, string> = {
    fraudulent:
      'This transaction was made by the legitimate cardholder. We verified identity signals, delivered the purchased offering, and found no evidence of account takeover.',
    product_not_received:
      'The customer received full access to the purchased product/service. Delivery events and access activity confirm fulfillment before the dispute date.',
    product_unacceptable:
      'The product matched what was advertised at purchase. The customer received onboarding/support and did not provide evidence of a materially different outcome.',
    subscription_canceled:
      'The customer accepted subscription terms at checkout, had access to cancellation options, and billing occurred according to disclosed policy.',
    duplicate:
      'The disputed transaction is a valid single charge for the purchase and is not a duplicate billing event.',
  };

  const headline = `Evidence draft for ${input.disputeId} (${input.reason})`;
  const amountText = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (input.currency || 'usd').toUpperCase(),
  }).format((input.amount || 0) / 100);
  const dueText = input.dueBy ? new Date(input.dueBy * 1000).toISOString() : 'unknown deadline';

  const narrative = [
    `Dispute amount: ${amountText}. Evidence due by: ${dueText}.`,
    reasonTemplates[input.reason] || 'This charge is valid and supported by customer communications, policy disclosures, and service fulfillment records.',
    input.productDescription ? `Product context: ${input.productDescription}` : '',
    input.evidenceSummary?.length ? `Current evidence notes: ${input.evidenceSummary.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const checklist = [
    'Include concise timeline: purchase → delivery/access → support interactions.',
    'Reference exact policy URLs shown at checkout.',
    'Attach direct proof artifacts (logs, receipts, communication screenshots).',
    'Keep language factual and avoid emotional phrasing.',
  ];

  const suggestedAttachments = [
    input.onboardingProof || 'Onboarding completion log with timestamps',
    input.deliveryProof || 'Delivery/access logs proving fulfillment',
    input.supportPolicy || 'Support transcript summary and SLA evidence',
    input.termsUrl ? `Terms of service: ${input.termsUrl}` : 'Terms of service URL captured at checkout',
    input.refundPolicyUrl ? `Refund policy: ${input.refundPolicyUrl}` : 'Refund policy URL captured at checkout',
    input.cancellationPolicyUrl
      ? `Cancellation policy: ${input.cancellationPolicyUrl}`
      : 'Cancellation policy URL (if subscription related)',
  ];

  return {
    headline,
    narrative,
    checklist,
    suggestedAttachments,
  };
}
