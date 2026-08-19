import assert from "node:assert/strict";

import {
  deliverMssrNoticeV1,
  evaluateMssrOperationalNoticeTransition,
  hasSameMssrNoticeV1Semantics,
  mssrNoticeV1Schema,
  serializeMssrNoticeV1,
} from "@mauroprime/mssr";
import { adaptMssrOperationalDecision } from "../dist/operational-notices.js";
import {
  clearBridgeNotices,
  drainBridgeNotices,
  emitBridgeNotice,
  getBridgeNoticeStatus,
  peekBridgeNotices,
} from "../dist/notices.js";

clearBridgeNotices();

const decision = evaluateMssrOperationalNoticeTransition({
  subject: "project:gate-e5-fixture",
  source: "mssr-gate-e5-fixture",
  code: "mssr-gate-e5-review",
  resolutionCode: "mssr-gate-e5-resolved",
  previousLevel: "ok",
  currentLevel: "review",
  previousFingerprint: "old-e5",
  currentFingerprint: "new-e5",
  message: "Gate E5 integration fixture requires review.",
  recommendation: "Inspect evidence; do not execute from the notice itself.",
});

assert.ok(decision.notice, "fixture must produce a genuine MssrNotice");
const semantic = decision.notice;
const semanticJson = serializeMssrNoticeV1(semantic);

// E4 remains an independent host-owned boundary after Bridge adopts MSSR 0.2.32.
const direct = await deliverMssrNoticeV1(semantic, (notice) => ({
  host: "direct-host-fixture",
  transport: "stderr-like",
  semantic: serializeMssrNoticeV1(notice),
}));
assert.equal(direct.receipt.host, "direct-host-fixture");
assert.equal(serializeMssrNoticeV1(direct.notice), semanticJson);
assert.equal(hasSameMssrNoticeV1Semantics(semantic, direct.notice), true);

const bridgeInput = adaptMssrOperationalDecision(
  decision,
  { hostProjection: "bridge-e5", transportObservedAt: "2026-08-18T03:40:00.000Z" },
  [{
    label: "Inspect only",
    toolName: "must-not-auto-execute",
    arguments: { fixture: true },
    instruction: "This action is host metadata and must never execute merely because the notice was queued.",
  }],
);
assert.ok(bridgeInput?.mssrNotice);
assert.equal(serializeMssrNoticeV1(bridgeInput.mssrNotice), semanticJson);
assert.equal(bridgeInput.dedupeKey, semantic.dedupeKey);

// Same semantic event coalesces in the host queue without changing portable identity.
const first = emitBridgeNotice(bridgeInput);
const second = emitBridgeNotice({
  ...bridgeInput,
  details: { ...bridgeInput.details, hostProjection: "bridge-e5-repeat" },
});
assert.equal(first.mssrNotice?.noticeId, semantic.noticeId);
assert.equal(second.mssrNotice?.noticeId, semantic.noticeId);
assert.equal(second.dedupeKey, semantic.dedupeKey);
assert.equal(second.occurrences, 2);
assert.equal(serializeMssrNoticeV1(second.mssrNotice), semanticJson);
let queued = peekBridgeNotices(10);
assert.equal(queued.filter((item) => item.dedupeKey === semantic.dedupeKey).length, 1);

// Bridge-native notices remain Bridge-native during migration.
const native = emitBridgeNotice({
  severity: "warning",
  code: "slow-tool-call",
  source: "native-bridge-fixture",
  message: "Native Bridge metric fixture.",
  details: { durationMs: 1500, thresholdMs: 1000 },
  actions: [{ label: "Inspect metric", toolName: "bridge_metrics_query" }],
  dedupeKey: "native-bridge-fixture:slow-tool-call",
});
assert.equal(native.source, "native-bridge-fixture");
assert.equal(native.code, "slow-tool-call");
assert.equal(native.mssrNotice, undefined);

// Plain BridgeNotice is also the generic external-MCP relay surface: preserve source identity, never synthesize MSSR.
const foreign = emitBridgeNotice({
  severity: "error",
  code: "provider-call-failed",
  source: "external-mcp:fixture-provider",
  message: "External MCP fixture failed.",
  details: { provider: "fixture-provider", foreignSchema: "provider-notice-v2" },
  actions: [{ label: "Inspect provider", instruction: "Host review only." }],
  dedupeKey: "external-mcp:fixture-provider:provider-call-failed",
});
assert.equal(foreign.source, "external-mcp:fixture-provider");
assert.equal(foreign.code, "provider-call-failed");
assert.equal(foreign.details?.foreignSchema, "provider-notice-v2");
assert.equal(foreign.mssrNotice, undefined);
assert.equal(mssrNoticeV1Schema.safeParse(foreign).success, false);

queued = peekBridgeNotices(10);
assert.equal(queued.length, 3, "MSSR, Bridge-native and external-MCP notices share one existing Bridge queue");
assert.equal(getBridgeNoticeStatus().pendingCount, 3);

// Portable semantics contain no transport/execution authority. Strict schema rejects attempted host delivery fields.
assert.equal(semantic.advisoryOnly, true);
assert.equal(semantic.details.advisoryOnly, true);
for (const forbidden of ["queueId", "ttlMs", "attempts", "deliveredAt", "actions", "toolName", "execute"]) {
  assert.equal(forbidden in semantic, false, `${forbidden} must not exist in MssrNotice semantics`);
}
assert.equal(
  mssrNoticeV1Schema.safeParse({ ...semantic, ttlMs: 60_000 }).success,
  false,
  "TTL is host delivery metadata and must be rejected by the semantic contract",
);
assert.equal(
  mssrNoticeV1Schema.safeParse({ ...semantic, actions: [{ toolName: "dangerous" }] }).success,
  false,
  "executable suggestions are host metadata and must be rejected by the semantic contract",
);

// Host actions remain inert data in BridgeNotice. Queue/drain never invokes a tool or converts them into semantic authority.
assert.equal(first.actions?.[0]?.toolName, "must-not-auto-execute");
assert.equal(first.mssrNotice && "actions" in first.mssrNotice, false);
assert.equal(native.actions?.[0]?.toolName, "bridge_metrics_query");
assert.equal(native.mssrNotice, undefined);

const drained = drainBridgeNotices(10);
assert.equal(drained.length, 3);
const drainedSemantic = drained.find((item) => item.mssrNotice)?.mssrNotice;
assert.ok(drainedSemantic);
assert.equal(serializeMssrNoticeV1(drainedSemantic), semanticJson);
assert.equal(getBridgeNoticeStatus().pendingCount, 0);

console.log("Bridge Operational Notice Gate E5 migration/invariant matrix: PASS");
