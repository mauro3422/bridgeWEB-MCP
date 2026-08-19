import assert from "node:assert/strict";

import {
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
  subject: "project:gate-e3-fixture",
  source: "mssr-gate-e3-fixture",
  code: "mssr-gate-e3-review",
  resolutionCode: "mssr-gate-e3-resolved",
  previousLevel: "ok",
  currentLevel: "review",
  previousFingerprint: "old",
  currentFingerprint: "new",
  message: "Gate E3 fixture requires review.",
  recommendation: "Inspect bounded evidence before acting.",
});

assert.ok(decision.notice, "fixture must produce a genuine MssrNotice");
const originalNotice = decision.notice;
const semanticJson = serializeMssrNoticeV1(originalNotice);

const relayInput = adaptMssrOperationalDecision(
  decision,
  {
    hostObservedAt: "2026-08-18T02:00:00.000Z",
    hostProjection: "bridge-fixture",
    event: "host-must-not-override-semantic-event",
  },
  [{ label: "Inspect fixture", instruction: "Host action stays outside MssrNotice." }],
);

assert.ok(relayInput, "genuine MSSR decision must produce one Bridge delivery input");
assert.ok(relayInput.mssrNotice, "Bridge relay must carry the portable payload explicitly");
assert.equal(hasSameMssrNoticeV1Semantics(originalNotice, relayInput.mssrNotice), true);
assert.equal(serializeMssrNoticeV1(relayInput.mssrNotice), semanticJson);
assert.equal(relayInput.mssrNotice.noticeId, originalNotice.noticeId);
assert.equal(relayInput.mssrNotice.dedupeKey, originalNotice.dedupeKey);
assert.equal(relayInput.dedupeKey, originalNotice.dedupeKey, "Bridge delivery dedupe may reuse MSSR event identity without rewriting it");
assert.equal(relayInput.details?.hostProjection, "bridge-fixture");
assert.equal(relayInput.details?.event, originalNotice.details.event, "host details cannot override the semantic event mirror");
assert.equal("hostProjection" in relayInput.mssrNotice, false);
assert.equal("hostObservedAt" in relayInput.mssrNotice.details, false);
assert.equal(mssrNoticeV1Schema.safeParse(relayInput).success, false, "Bridge delivery wrapper must not itself parse as MssrNotice");

const delivered = emitBridgeNotice(relayInput);
assert.ok(delivered.mssrNotice);
assert.equal(hasSameMssrNoticeV1Semantics(originalNotice, delivered.mssrNotice), true);
assert.equal(delivered.mssrNotice.noticeId, originalNotice.noticeId);
assert.notEqual(delivered.id, originalNotice.noticeId, "Bridge queue id is host delivery metadata, not MSSR semantic identity");
assert.ok(delivered.createdAt);
assert.ok(delivered.expiresAt);
assert.equal(delivered.occurrences, 1);

// Returned objects must not let callers mutate the semantic payload retained by the queue.
delivered.mssrNotice.message = "mutated returned clone";
const queuedAgain = peekBridgeNotices(10).find((item) => item.dedupeKey === originalNotice.dedupeKey);
assert.ok(queuedAgain?.mssrNotice);
assert.equal(serializeMssrNoticeV1(queuedAgain.mssrNotice), semanticJson);

// A foreign/native Bridge notice stays foreign and is never normalized or relabeled as MSSR.
const foreign = emitBridgeNotice({
  severity: "warning",
  code: "foreign-plugin-warning",
  source: "foreign-mcp:fixture",
  message: "Foreign MCP fixture warning.",
  details: { foreignProtocol: "fixture-v1" },
  dedupeKey: "foreign-mcp:fixture:warning",
});
assert.equal(foreign.source, "foreign-mcp:fixture");
assert.equal(foreign.code, "foreign-plugin-warning");
assert.equal(foreign.mssrNotice, undefined);
assert.equal(mssrNoticeV1Schema.safeParse(foreign).success, false);

const status = getBridgeNoticeStatus();
assert.equal(status.pendingCount, 2, "MSSR and foreign notices must share the existing Bridge delivery queue");
const drained = drainBridgeNotices(10);
assert.equal(drained.length, 2);
const drainedMssr = drained.find((item) => item.mssrNotice);
assert.ok(drainedMssr?.mssrNotice);
assert.equal(serializeMssrNoticeV1(drainedMssr.mssrNotice), semanticJson);
assert.equal(getBridgeNoticeStatus().pendingCount, 0);

console.log("Bridge Gate E3 MssrNotice relay boundary PASS");
