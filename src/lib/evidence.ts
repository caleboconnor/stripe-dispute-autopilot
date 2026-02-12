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
