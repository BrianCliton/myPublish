import type { AdminStore } from "../db/admin-store.ts";

export interface ApprovalResult {
  readonly success: boolean;
  readonly error?: string;
  readonly autoApproved?: boolean;
}

function getMinApprovals(): number {
  const envVal = process.env.MIN_APPROVALS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 2;
}

export function submitForReview(store: AdminStore, version: number, userId: string): ApprovalResult {
  const config = store.getConfigDetail(version);
  if (!config) {
    return { success: false, error: "Config version not found" };
  }

  if (config.status !== "draft") {
    return { success: false, error: `Cannot submit config with status '${config.status}', must be 'draft'` };
  }

  if (config.author_id !== userId) {
    return { success: false, error: "Only the author can submit for review" };
  }

  const now = Math.floor(Date.now() / 1000);
  store.updateConfigStatus(version, "pending_review", { submitted_at: now });
  return { success: true };
}

export function approve(store: AdminStore, version: number, reviewerId: string): ApprovalResult {
  const config = store.getConfigDetail(version);
  if (!config) {
    return { success: false, error: "Config version not found" };
  }

  if (config.status !== "pending_review") {
    return { success: false, error: `Cannot approve config with status '${config.status}', must be 'pending_review'` };
  }

  if (config.author_id === reviewerId) {
    return { success: false, error: "Cannot approve your own config" };
  }

  const existing = store.getApprovalByReviewer(version, reviewerId);
  if (existing) {
    return { success: false, error: "Already reviewed this config version" };
  }

  const approvalId = crypto.randomUUID();
  store.createApproval(approvalId, version, reviewerId, "approved", null);

  const approvalCount = store.countApprovals(version);
  const minApprovals = getMinApprovals();

  if (approvalCount >= minApprovals) {
    const now = Math.floor(Date.now() / 1000);
    store.updateConfigStatus(version, "approved", { approved_at: now });
    return { success: true, autoApproved: true };
  }

  return { success: true, autoApproved: false };
}

export function reject(store: AdminStore, version: number, reviewerId: string, comment: string): ApprovalResult {
  const config = store.getConfigDetail(version);
  if (!config) {
    return { success: false, error: "Config version not found" };
  }

  if (config.status !== "pending_review") {
    return { success: false, error: `Cannot reject config with status '${config.status}', must be 'pending_review'` };
  }

  if (config.author_id === reviewerId) {
    return { success: false, error: "Cannot reject your own config" };
  }

  const existing = store.getApprovalByReviewer(version, reviewerId);
  if (existing) {
    return { success: false, error: "Already reviewed this config version" };
  }

  const approvalId = crypto.randomUUID();
  store.createApproval(approvalId, version, reviewerId, "rejected", comment);
  store.updateConfigStatus(version, "rejected");
  return { success: true };
}
