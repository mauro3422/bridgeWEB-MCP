import { isDeepStrictEqual } from "node:util";
import {
  loadMssrContextInboxStateFromFile,
  resolveMssrContextInboxPath,
  type MssrContextDeliveryReceipt,
} from "@mauroprime/mssr";

const EVIDENCE_IDENTITY_KEYS = ["kind", "ref", "summary", "canonicalOwner", "provenance", "freshness", "observedAt", "revision"] as const;

/**
 * Normalizes an evidence reference to only the identity-relevant fields so two
 * structurally identical references with different serialization order still
 * compare equal.
 */
function evidenceIdentity(evidence: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return evidence.map((item) => {
    const identity: Record<string, unknown> = {};
    for (const key of EVIDENCE_IDENTITY_KEYS) {
      if (typeof item[key] === "string") identity[key] = item[key];
    }
    return identity;
  });
}

async function acknowledgedReceipts(projectRoot: string): Promise<MssrContextDeliveryReceipt[]> {
  const filePath = resolveMssrContextInboxPath(projectRoot);
  try {
    const state = await loadMssrContextInboxStateFromFile(filePath);
    return state.deliveries.filter((receipt) => receipt.acknowledgedAt !== undefined);
  } catch {
    return [];
  }
}

/**
 * Host-adapter delivery-surface suppression for the durable project context
 * plane. Bridge owns inbox/piggyback delivery and local retention, so it drops
 * inline context messages whose id, kind, and evidence identity (revision
 * included) match an already acknowledged delivery receipt. Identical
 * acknowledged evidence never redelivers; a message whose revision or content
 * changed passes through and becomes deliverable again. Selection never
 * confirms delivery and no persistence proposal is ever executed here.
 * Malformed inbox state is left to the authoritative core loader, which fails
 * closed.
 */
export async function filterAcknowledgedContextMessages(
  projectRoot: string,
  contextMessages: unknown,
): Promise<unknown | undefined> {
  if (contextMessages === undefined) return undefined;
  const messages = Array.isArray(contextMessages) ? contextMessages : [];
  if (messages.length === 0) return messages;
  const receipts = await acknowledgedReceipts(projectRoot);
  if (receipts.length === 0) return messages;
  const receiptById = new Map(receipts.map((receipt) => [receipt.messageId, receipt]));
  return messages.filter((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return true;
    const candidate = message as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : undefined;
    const kind = typeof candidate.kind === "string" ? candidate.kind : undefined;
    const receipt = id !== undefined ? receiptById.get(id) : undefined;
    if (!receipt || kind !== receipt.messageKind) return true;
    const offered = Array.isArray(candidate.evidence)
      ? candidate.evidence.map((item) => ({ ...(item as Record<string, unknown>) }))
      : [];
    const claimed = (receipt.sources ?? []).map((item) => ({ ...(item as Record<string, unknown>) }));
    return !isDeepStrictEqual(evidenceIdentity(offered.slice(0, 8)), evidenceIdentity(claimed.slice(0, 8)));
  });
}