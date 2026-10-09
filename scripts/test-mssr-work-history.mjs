import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-work-history-"));
const metricsDir = path.join(sandbox, "metrics");
const logDir = path.join(sandbox, "logs");

process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, "bridge-metrics.sqlite");
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(logDir, "mssr-events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, "mssr-observability-state.json");

const [metrics, observatory] = await Promise.all([
  import("../dist/metrics.js"),
  import("../dist/mssr-observatory.js"),
]);
metrics.getMetricsSummary(1, "all");

try {
  observatory.recordMssrEvent({
    traceId: "trace-weekly-a",
    eventType: "route_planned",
    caller: "chatgpt-web",
    stage: "implement",
    classificationMode: "structured-semantic",
    ok: true,
    details: {
      workflowKey: "weekly-cockpit-work",
      projectRoot: "D:/Dev/bridge-mcp",
      intent: { summary: "Implement weekly cross-project visibility." },
      requiredPhases: ["discovery", "implementation", "verification"],
      completedPhases: ["discovery"],
    },
  });
  observatory.recordMssrProjectContextSelection({
    traceId: "trace-weekly-a",
    caller: "chatgpt-web",
    stage: "implement",
    projectName: "bridge-mcp",
    decisions: [],
  });
  observatory.recordMssrEvent({
    traceId: "trace-weekly-a",
    eventType: "phase_completed",
    caller: "chatgpt-web",
    stage: "implement",
    ok: true,
    details: {
      workflowKey: "weekly-cockpit-work",
      summary: "Weekly projection implementation completed.",
      completedPhases: ["discovery", "implementation"],
      evidenceRef: "logs/weekly-cockpit-check.log",
    },
  });
  observatory.recordMssrEvent({
    traceId: "trace-weekly-a",
    eventType: "closure_reminder",
    caller: "chatgpt-web",
    stage: "implement",
    ok: false,
    details: {
      workflowKey: "weekly-cockpit-work",
      summary: "Substantive work became idle before outcome.",
    },
  });

  observatory.recordMssrEvent({
    traceId: "trace-weekly-b",
    eventType: "route_planned",
    caller: "chatgpt-web",
    stage: "verify",
    classificationMode: "structured-semantic",
    ok: true,
    details: {
      workflowKey: "weekly-cockpit-fixture",
      projectRoot: "D:/Dev/bridge-mcp",
      intent: { summary: "Synthetic routing fixture." },
    },
  });

  observatory.recordMssrEvent({
    traceId: "trace-weekly-support",
    eventType: "route_planned",
    caller: "chatgpt-web",
    stage: "verify",
    classificationMode: "structured-semantic",
    ok: true,
    details: {
      workflowKey: "recent-work-recovery-bridge-mcp",
      projectRoot: "D:/Dev/bridge-mcp",
      intent: { summary: "Read-only forensic recovery helper." },
      requiredPhases: ["discovery", "verification"],
      completedPhases: ["discovery"],
    },
  });
  observatory.recordMssrProjectContextSelection({
    traceId: "trace-weekly-support",
    caller: "chatgpt-web",
    stage: "verify",
    projectName: "bridge-mcp",
    decisions: [],
  });
  observatory.recordMssrEvent({
    traceId: "trace-weekly-support",
    eventType: "verification",
    caller: "chatgpt-web",
    stage: "verify",
    ok: true,
    details: {
      workflowKey: "recent-work-recovery-bridge-mcp",
      summary: "Forensic inventory helper completed its read-only check.",
      verificationPassed: true,
      completedPhases: ["discovery", "verification"],
    },
  });
  observatory.recordMssrEvent({
    traceId: "trace-weekly-support",
    eventType: "closure_reminder",
    caller: "chatgpt-web",
    stage: "close",
    ok: false,
    details: {
      workflowKey: "recent-work-recovery-bridge-mcp",
      summary: "Support trace still lacks outcome.",
    },
  });

  const summary = observatory.queryMssrObservatory({ kind: "summary", scope: "all", days: 7 });
  assert.equal(summary.workHistory.scope, "all");
  assert.equal(summary.workHistory.days, 7);
  assert.equal(summary.workHistory.projectCount, 1);
  assert.equal(summary.workHistory.traceCount, 3);
  assert.equal(summary.workHistory.substantiveTraceCount, 2, "synthetic fixture workflow must not count as substantive work");
  assert.equal(summary.workHistory.openSubstantiveTraceCount, 2);
  assert.equal(summary.workHistory.humanOpenTraceCount, 1);
  assert.equal(summary.workHistory.supportOpenTraceCount, 1);
  assert.equal(summary.workHistory.needsClosureReviewCount, 2);
  assert.equal(summary.workHistory.humanNeedsClosureReviewCount, 1);
  assert.equal(summary.workHistory.humanCurrentTaskCount, 1);
  assert.equal(summary.workHistory.humanClosureDebtTaskCount, 0);
  assert.equal(summary.workHistory.taskStates.length, 2);
  assert.equal(summary.workHistory.taskStates.find((task) => task.supportWorkflow === false)?.currentWork, true);
  assert.equal(summary.workHistory.openTraces.length, 2);
  const humanOpenTrace = summary.workHistory.openTraces.find((item) => item.traceId === "trace-weekly-a");
  const supportOpenTrace = summary.workHistory.openTraces.find((item) => item.traceId === "trace-weekly-support");
  assert.ok(humanOpenTrace);
  assert.ok(supportOpenTrace);
  assert.equal(humanOpenTrace.needsClosureReview, true);
  assert.equal(humanOpenTrace.evidenceRef, "logs/weekly-cockpit-check.log");
  assert.deepEqual(humanOpenTrace.completedPhases, ["discovery", "implementation"]);
  assert.equal(supportOpenTrace.supportWorkflow, true);
  assert.equal(supportOpenTrace.needsClosureReview, true);
  assert.ok(summary.workHistory.daily.length >= 1);
  assert.equal(summary.workHistory.daily[0].needsClosureReviewCount, 2);
  assert.equal(summary.workHistory.daily[0].humanNeedsClosureReviewCount, 1);
  assert.equal(summary.workHistory.daily[0].supportNeedsClosureReviewCount, 1);
  assert.equal(summary.workHistory.daily[0].humanOpenTraceCount, 1);
  assert.equal(summary.workHistory.daily[0].supportOpenTraceCount, 1);

  const project = summary.workHistory.projects.find((item) => item.name === "bridge-mcp");
  assert.ok(project, "bridge-mcp weekly project projection should exist");
  assert.equal(project.traceCount, 3);
  assert.equal(project.substantiveTraceCount, 2);
  assert.deepEqual(project.workflowKeys, ["weekly-cockpit-work", "recent-work-recovery-bridge-mcp"]);
  assert.equal(project.latestSummary, "Weekly projection implementation completed.");
  assert.match(summary.workHistory.note, /observed work/i);

  console.log("mssr work-history projection tests passed");
} finally {
  observatory.closeMssrObservatoryForTests();
  metrics.closeMetricsForTests();
  await fs.promises.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
