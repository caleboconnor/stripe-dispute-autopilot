import fs from 'fs';
import path from 'path';

export type MerchantSettings = {
  autoSubmitEnabled: boolean;
  autoSubmitReasons: string[];
  minEvidenceScore: number;
  manualReviewAmountThreshold: number;
  monthlyDisputeAlertThresholdPct: number;
  monthlyTransactionCount: number;
  submissionDelayMinutes: number;
  statementDescriptor: string;
  supportEmail: string;
  supportPhone: string;
  supportUrl: string;
  recoveryFeePct: number;
  alertDeflectionFeeCents: number;
  roiGuaranteeMultiplier: number;
  alertsAutoRefundEnabled: boolean;
  inquiryAutomationEnabled: boolean;
};

export type EvidenceProfile = {
  businessType: 'info_coaching' | 'generic';
  productDescriptionTemplate: string;
  termsUrl?: string;
  refundPolicyUrl?: string;
  cancellationPolicyUrl?: string;
  onboardingProofTemplate?: string;
  deliveryProofTemplate?: string;
  supportPolicyTemplate?: string;
};

export type MerchantRecord = {
  id: string;
  name: string;
  stripeAccountId: string;
  stripeAccessToken: string;
  createdAt: string;
  settings: MerchantSettings;
  evidenceProfile: EvidenceProfile;
};

export type SubmissionAttempt = {
  at: string;
  success: boolean;
  message: string;
};

export type DisputeRecord = {
  id: string;
  merchantId?: string;
  stripeAccountId?: string;
  chargeId?: string;
  reason: string;
  amount: number;
  currency: string;
  status: string;
  dueBy?: number;
  disputeCreatedAt?: number;
  updatedAt: string;
  submitted: boolean;
  deflected?: boolean;
  deflectionReason?: string;
  deflectedAt?: string;
  evidenceScore: number;
  manualReviewRequired: boolean;
  evidenceSummary: string[];
  submissionAttempts: SubmissionAttempt[];
  latestError?: string;
  owner?: string;
  workflowStatus?: 'new' | 'in_progress' | 'waiting_on_customer' | 'ready_to_submit' | 'submitted' | 'closed';
  nextActionAt?: string;
  internalNotes?: string;
};

export type AlertRecord = {
  id: string;
  merchantId?: string;
  disputeId?: string;
  chargeId?: string;
  source: 'verifi' | 'ethoca' | 'network' | 'manual';
  externalAlertId?: string;
  amount?: number;
  currency?: string;
  refunded?: boolean;
  refundId?: string;
  duplicateOf?: string;
  createdAt: string;
};

export type InquiryRecord = {
  id: string;
  merchantId?: string;
  disputeId?: string;
  platform: 'paypal' | 'klarna' | 'afterpay' | 'ebay' | 'other';
  status: 'new' | 'responded' | 'escalated' | 'resolved';
  customerMessage?: string;
  responseDraft?: string;
  createdAt: string;
  updatedAt: string;
};

type DbShape = {
  merchants: MerchantRecord[];
  disputes: DisputeRecord[];
  alerts: AlertRecord[];
  inquiries: InquiryRecord[];
};

const dbPath = path.join(process.cwd(), 'data', 'db.json');

function ensureDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ merchants: [], disputes: [], alerts: [], inquiries: [] } as DbShape, null, 2));
  }
}

function readDb(): DbShape {
  ensureDb();
  const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as Partial<DbShape>;
  return {
    merchants: parsed.merchants || [],
    disputes: parsed.disputes || [],
    alerts: parsed.alerts || [],
    inquiries: parsed.inquiries || [],
  };
}

function writeDb(db: DbShape) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function defaultMerchantSettings(): MerchantSettings {
  return {
    autoSubmitEnabled: false,
    autoSubmitReasons: [],
    minEvidenceScore: 70,
    manualReviewAmountThreshold: 200000,
    monthlyDisputeAlertThresholdPct: 0.9,
    monthlyTransactionCount: 1000,
    submissionDelayMinutes: 0,
    statementDescriptor: '',
    supportEmail: '',
    supportPhone: '',
    supportUrl: '',
    recoveryFeePct: 25,
    alertDeflectionFeeCents: 2900,
    roiGuaranteeMultiplier: 4,
    alertsAutoRefundEnabled: true,
    inquiryAutomationEnabled: true,
  };
}

export function defaultEvidenceProfile(): EvidenceProfile {
  return {
    businessType: 'info_coaching',
    productDescriptionTemplate:
      'Customer purchased access to a structured coaching/info program including onboarding assets, training modules, and support.',
    termsUrl: '',
    refundPolicyUrl: '',
    cancellationPolicyUrl: '',
    onboardingProofTemplate:
      'Customer onboarding completed with timestamped confirmation and onboarding communications.',
    deliveryProofTemplate:
      'Customer received program access credentials and digital delivery confirmation.',
    supportPolicyTemplate:
      'Customer support channels and response logs are maintained and available as evidence.',
  };
}

export function upsertMerchant(record: MerchantRecord) {
  const db = readDb();
  const idx = db.merchants.findIndex((m) => m.id === record.id || m.stripeAccountId === record.stripeAccountId);
  if (idx >= 0) db.merchants[idx] = { ...db.merchants[idx], ...record };
  else db.merchants.push(record);
  writeDb(db);
}

export function updateMerchantSettings(merchantId: string, patch: Partial<MerchantSettings>) {
  const db = readDb();
  const idx = db.merchants.findIndex((m) => m.id === merchantId);
  if (idx < 0) return undefined;
  db.merchants[idx].settings = { ...db.merchants[idx].settings, ...patch };
  writeDb(db);
  return db.merchants[idx];
}

export function updateMerchantEvidenceProfile(merchantId: string, patch: Partial<EvidenceProfile>) {
  const db = readDb();
  const idx = db.merchants.findIndex((m) => m.id === merchantId);
  if (idx < 0) return undefined;
  db.merchants[idx].evidenceProfile = { ...db.merchants[idx].evidenceProfile, ...patch };
  writeDb(db);
  return db.merchants[idx];
}

export function findMerchantByStripeAccountId(stripeAccountId?: string): MerchantRecord | undefined {
  if (!stripeAccountId) return undefined;
  const db = readDb();
  return db.merchants.find((m) => m.stripeAccountId === stripeAccountId);
}

export function findMerchantById(merchantId?: string): MerchantRecord | undefined {
  if (!merchantId) return undefined;
  const db = readDb();
  return db.merchants.find((m) => m.id === merchantId);
}

export function listMerchants(): MerchantRecord[] {
  const db = readDb();
  return db.merchants;
}

export function upsertDispute(record: DisputeRecord) {
  const db = readDb();
  const idx = db.disputes.findIndex((d) => d.id === record.id);
  if (idx >= 0) db.disputes[idx] = { ...db.disputes[idx], ...record };
  else db.disputes.push(record);
  writeDb(db);
}

export function getDispute(id: string) {
  const db = readDb();
  return db.disputes.find((d) => d.id === id);
}

export function listDisputes(merchantId?: string) {
  const db = readDb();
  const items = merchantId ? db.disputes.filter((d) => d.merchantId === merchantId) : db.disputes;
  return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function markSubmitted(id: string) {
  const db = readDb();
  const record = db.disputes.find((d) => d.id === id);
  if (!record) return;
  record.submitted = true;
  record.updatedAt = new Date().toISOString();
  writeDb(db);
}

export function markDeflected(id: string, reason: string) {
  const db = readDb();
  const record = db.disputes.find((d) => d.id === id);
  if (!record) return;
  record.deflected = true;
  record.deflectionReason = reason;
  record.deflectedAt = new Date().toISOString();
  record.updatedAt = new Date().toISOString();
  writeDb(db);
}

export function addSubmissionAttempt(id: string, attempt: SubmissionAttempt) {
  const db = readDb();
  const record = db.disputes.find((d) => d.id === id);
  if (!record) return;
  record.submissionAttempts = [...(record.submissionAttempts || []), attempt].slice(-20);
  record.updatedAt = new Date().toISOString();
  if (!attempt.success) record.latestError = attempt.message;
  writeDb(db);
}

export function updateDisputeWorkflow(
  id: string,
  patch: Partial<Pick<DisputeRecord, 'owner' | 'workflowStatus' | 'nextActionAt' | 'internalNotes'>>,
) {
  const db = readDb();
  const record = db.disputes.find((d) => d.id === id);
  if (!record) return undefined;
  Object.assign(record, patch);
  record.updatedAt = new Date().toISOString();
  writeDb(db);
  return record;
}

export function getMetrics(merchantId?: string) {
  const disputes = listDisputes(merchantId);
  const total = disputes.length;
  const won = disputes.filter((d) => d.status === 'won').length;
  const lost = disputes.filter((d) => d.status === 'lost').length;
  const submitted = disputes.filter((d) => d.submitted).length;
  const deflected = disputes.filter((d) => d.deflected).length;
  const recoveredAmount = disputes.filter((d) => d.status === 'won').reduce((sum, d) => sum + (d.amount || 0), 0);
  const avgEvidenceScore = total ? Math.round(disputes.reduce((sum, d) => sum + (d.evidenceScore || 0), 0) / total) : 0;

  const nowSec = Math.floor(Date.now() / 1000);
  const dueSoon = disputes.filter((d) => d.dueBy && d.dueBy > nowSec && d.dueBy - nowSec <= 48 * 60 * 60 && d.status !== 'won' && d.status !== 'lost').length;
  const overdue = disputes.filter((d) => d.dueBy && d.dueBy < nowSec && !d.submitted && d.status !== 'won' && d.status !== 'lost').length;

  const monthStartIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const monthlyDisputes = disputes.filter((d) => d.updatedAt >= monthStartIso).length;

  const byReason: Record<string, { total: number; won: number; lost: number }> = {};
  for (const d of disputes) {
    if (!byReason[d.reason]) byReason[d.reason] = { total: 0, won: 0, lost: 0 };
    byReason[d.reason].total += 1;
    if (d.status === 'won') byReason[d.reason].won += 1;
    if (d.status === 'lost') byReason[d.reason].lost += 1;
  }

  return {
    total,
    won,
    lost,
    submitted,
    deflected,
    winRate: total ? Number(((won / total) * 100).toFixed(1)) : 0,
    recoveredAmount,
    avgEvidenceScore,
    dueSoon,
    overdue,
    monthlyDisputes,
    byReason,
  };
}

export function listAlerts(merchantId?: string) {
  const db = readDb();
  const items = merchantId ? db.alerts.filter((a) => a.merchantId === merchantId) : db.alerts;
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function upsertAlert(record: AlertRecord) {
  const db = readDb();
  const idx = db.alerts.findIndex((a) => a.id === record.id);
  if (idx >= 0) db.alerts[idx] = { ...db.alerts[idx], ...record };
  else db.alerts.push(record);
  writeDb(db);
  return record;
}

export function findAlertByExternal(source: AlertRecord['source'], externalAlertId?: string, chargeId?: string) {
  const db = readDb();
  return db.alerts.find(
    (a) =>
      (externalAlertId && a.externalAlertId && a.externalAlertId === externalAlertId && a.source === source) ||
      (chargeId && a.chargeId && a.chargeId === chargeId && a.source === source),
  );
}

export function listInquiries(merchantId?: string) {
  const db = readDb();
  const items = merchantId ? db.inquiries.filter((i) => i.merchantId === merchantId) : db.inquiries;
  return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function upsertInquiry(record: InquiryRecord) {
  const db = readDb();
  const idx = db.inquiries.findIndex((i) => i.id === record.id);
  if (idx >= 0) db.inquiries[idx] = { ...db.inquiries[idx], ...record, updatedAt: new Date().toISOString() };
  else db.inquiries.push(record);
  writeDb(db);
  return idx >= 0 ? db.inquiries[idx] : record;
}
