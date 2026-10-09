import assert from "node:assert/strict";
import {
  createEmptyMssrContextInboxState,
  enqueueMssrContextMessages,
  mssrContextInboxStateSchema,
  mssrContextMessageSchema,
  selectMssrContextInboxMessages,
  structuredSkillIntentSchema,
} from "@mauroprime/mssr";

const now = "2026-09-25T05:50:00.000Z";
const message = mssrContextMessageSchema.parse({
  id: "bridge-receipt-boundary",
  kind: "related-incident",
  severity: "info",
  title: "Bridge receipt boundary",
  summary: "Regression evidence for long-lived Context Message delivery receipts.",
  evidence: [{
    kind: "incident",
    ref: "docs/INCIDENTS.md",
    summary: "Receipt boundary regression.",
    canonicalOwner: "D:/Dev/bridge-mcp",
    provenance: "project",
    freshness: "fresh",
    revision: "receipt-boundary-v1",
  }],
  advisoryActions: ["record-incident"],
  domains: ["skill-system"],
  actions: ["verify"],
  dedupeKey: "bridge-receipt-boundary",
});
const intent = structuredSkillIntentSchema.parse({
  domains: ["skill-system"],
  actions: ["verify"],
  artifacts: ["mcp"],
  needs: ["integrity-verification"],
  signals: ["error-observed"],
  risk: "read-only",
  ambiguity: "low",
});

const enqueued = enqueueMssrContextMessages(createEmptyMssrContextInboxState(), [message], now);
const first = selectMssrContextInboxMessages(enqueued.state, { now, intent, stage: "verify" });
assert.equal(first.state.deliveries[0]?.selectedCount, 1);

const at255 = mssrContextInboxStateSchema.parse({
  ...first.state,
  deliveries: first.state.deliveries.map((receipt) => ({ ...receipt, selectedCount: 255 })),
});
const at256 = selectMssrContextInboxMessages(at255, {
  now: "2026-09-25T05:50:01.000Z",
  intent,
  stage: "verify",
});
assert.equal(at256.state.deliveries[0]?.selectedCount, 256);
assert.equal(mssrContextInboxStateSchema.safeParse(at256.state).success, true);

const saturated = mssrContextInboxStateSchema.parse({
  ...first.state,
  deliveries: first.state.deliveries.map((receipt) => ({
    ...receipt,
    selectedCount: Number.MAX_SAFE_INTEGER,
  })),
});
const afterSaturation = selectMssrContextInboxMessages(saturated, {
  now: "2026-09-25T05:50:02.000Z",
  intent,
  stage: "verify",
});
assert.equal(afterSaturation.state.deliveries[0]?.selectedCount, Number.MAX_SAFE_INTEGER);
assert.equal(mssrContextInboxStateSchema.safeParse(afterSaturation.state).success, true);

console.log("Bridge installed MSSR receipt-count boundary test passed (255 -> 256 + safe saturation).");
