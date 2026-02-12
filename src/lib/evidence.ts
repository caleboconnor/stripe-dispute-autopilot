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

export function buildEvidencePayload(input: EvidenceInput): Stripe.DisputeUpdateParams {
  const reason = input.dispute.reason;

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

  return base;
}
