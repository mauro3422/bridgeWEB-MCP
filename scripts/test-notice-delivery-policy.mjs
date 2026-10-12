import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateMssrOperationalNoticeTransition } from "@mauroprime/mssr";
import { adaptMssrOperationalDecision } from "../dist/operational-notices.js";
import {
  clearBridgeNotices,
  drainBridgeNoticesWithinBudget,
  emitBridgeNotice,
  getBridgeNoticePendingSummary,
  getBridgeNoticeStatus,
  peekBridgeNotices,
  queryBridgeNoticeHistory,
} from "../dist/notices.js";

const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function relayTransition({ previousLevel, currentLevel, previousFingerprint, currentFingerprint }) {
  const decision = evaluateMssrOperationalNoticeTransition({
    subject: `project:notice-policy-${token}`,
    source: "mssr-notice-policy-fixture",
    code: "mssr-notice-policy-review",
    resolutionCode: "mssr-notice-policy-resolved",
    previousLevel,
    currentLevel,
    previousFingerprint,
    currentFingerprint,
    message: "Notice delivery policy fixture requires review.",
    resolutionMessage: "Notice delivery policy fixture resolved.",
    recommendation: "Inspect bounded evidence before acting.",
  });
  const input = adaptMssrOperationalDecision(decision, { project: "alpha", traceId: `trace-${token}` });
  assert.ok(input, "transition must produce a relay input");
  return input;
}

// Context messages are evidence/history, not active host attention when informational.
clearBridgeNotices();
emitBridgeNotice({
  severity: "info",
  code: "mssr-context-project-context",
  source: "mssr-context-message-v1",
  message: "Informational context fixture.",
  details: { project: "alpha" },
  dedupeKey: `notice-policy:${token}:context-info`,
});
assert.equal(getBridgeNoticeStatus().pendingCount, 0);
assert.equal(queryBridgeNoticeHistory({ code: "mssr-context-project-context", limit: 200 }).some((item) => item.dedupeKey === `notice-policy:${token}:context-info`), true);

// MSSR semantic lifecycle identity supersedes older queue state; resolved is history-only.
clearBridgeNotices();
const opened = relayTransition({ previousLevel: "ok", currentLevel: "review", previousFingerprint: "base", currentFingerprint: "a" });
const changed = relayTransition({ previousLevel: "review", currentLevel: "review", previousFingerprint: "a", currentFingerprint: "b" });
const resolved = relayTransition({ previousLevel: "review", currentLevel: "ok", previousFingerprint: "b", currentFingerprint: "c" });
emitBridgeNotice(opened);
assert.equal(getBridgeNoticeStatus().pendingCount, 1);
emitBridgeNotice(changed);
assert.equal(getBridgeNoticeStatus().pendingCount, 1, "changed state must replace current attention, not append another pending item");
assert.equal(peekBridgeNotices(10)[0]?.mssrNotice?.details.event, "changed");
emitBridgeNotice(resolved);
assert.equal(getBridgeNoticeStatus().pendingCount, 0, "resolved state must clear current attention while remaining in history");
const lifecycleHistory = queryBridgeNoticeHistory({ source: "mssr-notice-policy-fixture", limit: 200 })
  .filter((item) => item.mssrNotice?.subject === opened.mssrNotice?.subject);
assert.ok(lifecycleHistory.length >= 3, "global history must retain lifecycle transitions");
assert.ok(lifecycleHistory.some((item) => item.mssrNotice?.details.event === "resolved"));

// Once the exact MSSR transition was delivered, unchanged repeats remain quiet until semantics change.
clearBridgeNotices();
emitBridgeNotice(opened);
const firstDelivery = drainBridgeNoticesWithinBudget(1, 4000, { project: "alpha" });
assert.equal(firstDelivery.items.length, 1);
assert.equal(getBridgeNoticeStatus().pendingCount, 0);
emitBridgeNotice(opened);
assert.equal(getBridgeNoticeStatus().pendingCount, 0, "already delivered identical semantic transition must not re-alert");

// Contextual delivery prefers current trace/project plus global errors; another project is count-only.
clearBridgeNotices();
emitBridgeNotice({
  severity: "warning",
  code: "alpha-warning",
  source: "fixture",
  message: "Alpha warning.",
  details: { project: "alpha", traceId: `trace-${token}` },
  dedupeKey: `notice-policy:${token}:alpha`,
});
emitBridgeNotice({
  severity: "warning",
  code: "beta-warning",
  source: "fixture",
  message: "Beta warning.",
  details: { project: "beta", traceId: `other-${token}` },
  dedupeKey: `notice-policy:${token}:beta`,
});
emitBridgeNotice({
  severity: "error",
  code: "global-error",
  source: "fixture",
  message: "Global infrastructure error.",
  dedupeKey: `notice-policy:${token}:global`,
});
const contextual = drainBridgeNoticesWithinBudget(2, 4000, {
  project: "alpha",
  traceId: `trace-${token}`,
});
assert.deepEqual(new Set(contextual.items.map((item) => item.code)), new Set(["alpha-warning", "global-error"]));
assert.equal(contextual.otherPending, 1, "other-project attention must remain available without injecting its body");
assert.equal(contextual.remaining, 1);
assert.equal(peekBridgeNotices(10)[0]?.code, "beta-warning");

// Trace-scoped notices must not fall back to global delivery when no comparable scope exists.
clearBridgeNotices();
emitBridgeNotice({
  severity: "warning",
  code: "trace-only-warning",
  source: "mssr-trace-context",
  message: "Trace-scoped warning body.",
  details: { traceId: `other-trace-${token}` },
  dedupeKey: `notice-policy:${token}:trace-only`,
});
const untracedTraceOnly = drainBridgeNoticesWithinBudget(1, 4000, {});
assert.equal(untracedTraceOnly.items.length, 0, "a trace-only notice must stay pending when delivery has no active trace");
assert.equal(untracedTraceOnly.otherPending, 1, "unmatched trace-only attention remains count-only");

clearBridgeNotices();
emitBridgeNotice({
  severity: "warning",
  code: "trace-only-with-project-context",
  source: "mssr-trace-context",
  message: "Private trace warning body.",
  details: { traceId: `other-trace-${token}` },
  dedupeKey: `notice-policy:${token}:trace-only-with-project-context`,
});
const traceOnlyWithProjectContext = drainBridgeNoticesWithinBudget(1, 4000, { project: "alpha" });
assert.equal(traceOnlyWithProjectContext.items.length, 0, "an unrelated project context must not make a trace-only notice global");
assert.equal(traceOnlyWithProjectContext.otherPending, 1);

clearBridgeNotices();
emitBridgeNotice({
  severity: "warning",
  code: "same-trace-warning",
  source: "mssr-trace-context",
  message: "Current trace warning body.",
  details: { project: "alpha", traceId: `active-trace-${token}` },
  dedupeKey: `notice-policy:${token}:same-trace`,
});
const exactTraceDelivery = drainBridgeNoticesWithinBudget(1, 4000, {
  project: "alpha",
  traceId: `active-trace-${token}`,
});
assert.deepEqual(exactTraceDelivery.items.map((item) => item.code), ["same-trace-warning"]);

clearBridgeNotices();
emitBridgeNotice({
  severity: "warning",
  code: "unscoped-global-warning",
  source: "fixture",
  message: "Truly global warning.",
  dedupeKey: `notice-policy:${token}:unscoped-global`,
});
const globalDelivery = drainBridgeNoticesWithinBudget(1, 4000, {});
assert.deepEqual(globalDelivery.items.map((item) => item.code), ["unscoped-global-warning"]);

// An oversized first notice must never block the queue. It is compacted for delivery if necessary.
clearBridgeNotices();
emitBridgeNotice({
  severity: "warning",
  code: "oversized-warning",
  source: "fixture",
  message: "Oversized warning that still needs bounded delivery.",
  details: { project: "alpha", payload: "x".repeat(8000) },
  actions: [{ label: "Inspect oversized fixture", instruction: "y".repeat(600) }],
  dedupeKey: `notice-policy:${token}:oversized`,
});
emitBridgeNotice({
  severity: "warning",
  code: "following-warning",
  source: "fixture",
  message: "Warning behind the oversized item.",
  details: { project: "alpha" },
  dedupeKey: `notice-policy:${token}:following`,
});
const minimumBudgetDelivery = drainBridgeNoticesWithinBudget(1, 512, { project: "alpha" });
assert.equal(minimumBudgetDelivery.items.length, 1, "an oversized head item must never block later deliverable notices");
assert.equal(minimumBudgetDelivery.items[0].code, "following-warning", "the next bounded notice must bypass an oversized head item");
const oversizedDelivery = drainBridgeNoticesWithinBudget(1, 1500, { project: "alpha" });
assert.equal(oversizedDelivery.items[0]?.code, "oversized-warning", "the oversized notice must remain available for a later bounded delivery");
assert.equal(oversizedDelivery.items[0]?.summaryOnly, true, "oversized delivery must use a compact host summary without mutating stored history");

// Terminal lifecycle info is historical; active warnings are cleared by a successful resume/completion signal.
clearBridgeNotices();
const sessionId = `term-${token}`;
emitBridgeNotice({
  severity: "info",
  code: "terminal-session-started",
  source: "terminal-session",
  message: "Session started.",
  details: { sessionId, cwd: "D:/Dev/alpha", traceId: `trace-${token}` },
  dedupeKey: `terminal-session:${sessionId}:started`,
});
assert.equal(getBridgeNoticeStatus().pendingCount, 0);
emitBridgeNotice({
  severity: "warning",
  code: "terminal-session-stalled",
  source: "terminal-session",
  message: "Session stalled.",
  details: { sessionId, cwd: "D:/Dev/alpha", traceId: `trace-${token}` },
  dedupeKey: `terminal-session:${sessionId}:stalled`,
});
assert.equal(getBridgeNoticeStatus().pendingCount, 1);
emitBridgeNotice({
  severity: "info",
  code: "terminal-session-progress-resumed",
  source: "terminal-session",
  message: "Session resumed.",
  details: { sessionId, cwd: "D:/Dev/alpha", traceId: `trace-${token}` },
  dedupeKey: `terminal-session:${sessionId}:progress-resumed`,
});
assert.equal(getBridgeNoticeStatus().pendingCount, 0);

const finalSummary = getBridgeNoticePendingSummary({ project: "alpha", traceId: `trace-${token}` });
assert.deepEqual(finalSummary, { pendingCount: 0, relevantPending: 0, otherPending: 0, globalPending: 0 });

// Restart reconciliation must collapse an old persisted lifecycle queue before exposing it again.
const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-notice-policy-"));
const restartState = path.join(restartDir, "bridge-notices.json");
const now = Date.now();
const persistedNotice = (code, severity, dedupeKey, details, offsetMs) => ({
  id: `persisted-${code}`,
  severity,
  code,
  source: "terminal-session",
  message: code,
  details,
  createdAt: new Date(now + offsetMs).toISOString(),
  updatedAt: new Date(now + offsetMs).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  occurrences: 1,
  dedupeKey,
  deliveryCount: 0,
});
const persistedSession = `persisted-${token}`;
const staleQueue = [
  persistedNotice("terminal-session-started", "info", `terminal-session:${persistedSession}:started`, { sessionId: persistedSession }, 0),
  persistedNotice("terminal-session-stalled", "warning", `terminal-session:${persistedSession}:stalled`, { sessionId: persistedSession }, 1),
  persistedNotice("terminal-session-progress-resumed", "info", `terminal-session:${persistedSession}:progress-resumed`, { sessionId: persistedSession }, 2),
];
fs.writeFileSync(restartState, `${JSON.stringify({ schemaVersion: 1, savedAt: new Date(now).toISOString(), queue: staleQueue, history: staleQueue })}\n`);
const restartedStatus = JSON.parse(execFileSync(process.execPath, [
  "--input-type=module",
  "-e",
  "const m=await import('./dist/notices.js');console.log(JSON.stringify(m.getBridgeNoticeStatus()));",
], {
  cwd: process.cwd(),
  env: { ...process.env, BRIDGE_MCP_NOTICE_STATE_PATH: restartState, BRIDGE_MCP_NOTICE_PERSISTENCE_ENABLED: "1" },
  encoding: "utf8",
}).trim());
assert.equal(restartedStatus.pendingCount, 0, "restart must reconcile stale lifecycle entries instead of re-alerting resolved attention");
fs.rmSync(restartDir, { recursive: true, force: true });

console.log("Bridge contextual notice delivery policy PASS");
