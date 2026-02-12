export type DisputeRecord = {
  id: string;
  chargeId?: string;
  reason: string;
  amount: number;
  currency: string;
  status: string;
  dueBy?: number;
  updatedAt: string;
  submitted: boolean;
};

const disputes = new Map<string, DisputeRecord>();

export function upsertDispute(record: DisputeRecord) {
  disputes.set(record.id, record);
}

export function listDisputes() {
  return [...disputes.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function markSubmitted(id: string) {
  const record = disputes.get(id);
  if (!record) return;
  record.submitted = true;
  record.updatedAt = new Date().toISOString();
  disputes.set(id, record);
}
