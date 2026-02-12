import fs from 'fs';
import path from 'path';

export type MerchantRecord = {
  id: string;
  name: string;
  stripeAccountId: string;
  stripeAccessToken: string;
  createdAt: string;
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
  updatedAt: string;
  submitted: boolean;
};

type DbShape = {
  merchants: MerchantRecord[];
  disputes: DisputeRecord[];
};

const dbPath = path.join(process.cwd(), 'data', 'db.json');

function ensureDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ merchants: [], disputes: [] } as DbShape, null, 2));
  }
}

function readDb(): DbShape {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, 'utf8')) as DbShape;
}

function writeDb(db: DbShape) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function upsertMerchant(record: MerchantRecord) {
  const db = readDb();
  const idx = db.merchants.findIndex((m) => m.id === record.id || m.stripeAccountId === record.stripeAccountId);
  if (idx >= 0) db.merchants[idx] = record;
  else db.merchants.push(record);
  writeDb(db);
}

export function findMerchantByStripeAccountId(stripeAccountId?: string): MerchantRecord | undefined {
  if (!stripeAccountId) return undefined;
  const db = readDb();
  return db.merchants.find((m) => m.stripeAccountId === stripeAccountId);
}

export function listMerchants(): MerchantRecord[] {
  const db = readDb();
  return db.merchants;
}

export function upsertDispute(record: DisputeRecord) {
  const db = readDb();
  const idx = db.disputes.findIndex((d) => d.id === record.id);
  if (idx >= 0) db.disputes[idx] = record;
  else db.disputes.push(record);
  writeDb(db);
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
