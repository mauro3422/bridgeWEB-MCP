import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("../dist/dashboard-mssr-worker.js", import.meta.url));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-dashboard-worker-reuse-"));
const inventoryStatePath = path.join(sandbox, "context-inventory-state.json");
const now = new Date();
const today = now.toISOString().slice(0, 10);
const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
fs.writeFileSync(inventoryStatePath, JSON.stringify({
  schemaVersion: 1,
  savedAt: now.toISOString(),
  refreshedAt: now.toISOString(),
  refreshReason: "test-fixture",
  sourceLatestAt: "9999-12-31T23:59:59.999Z",
  weeklySummary: {
    scope: "all",
    days: 7,
    since,
    workHistory: {
      scope: "all",
      days: 7,
      since,
      traceCount: 0,
      substantiveTraceCount: 0,
      projectCount: 0,
      projects: [],
    },
  },
  weeklyGitStates: [],
  dailySnapshots: [{
    date: today,
    capturedAt: now.toISOString(),
    latestAt: null,
    traceCount: 0,
    projectCount: 0,
    projects: [],
    workflowKeys: [],
    openTraceCount: 0,
    humanOpenTraceCount: 0,
    supportOpenTraceCount: 0,
    needsClosureReviewCount: 0,
    humanNeedsClosureReviewCount: 0,
    supportNeedsClosureReviewCount: 0,
    latestSummaries: [],
  }],
}, null, 2));
const child = fork(workerPath, [], {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
  execArgv: [],
  env: {
    ...process.env,
    BRIDGE_MCP_METRICS_READONLY: "1",
    BRIDGE_MCP_CONTEXT_INVENTORY_STATE: path.join(sandbox, "context-inventory-state.json"),
  },
});
const childPid = child.pid;
let sequence = 0;

function requestSnapshot() {
  return new Promise((resolve, reject) => {
    const requestId = `dashboard-worker-reuse-${++sequence}`;
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error(`dashboard worker request ${requestId} timed out`));
    }, 120_000);
    const onMessage = (message) => {
      if (message?.requestId !== requestId) return;
      clearTimeout(timeout);
      child.off("message", onMessage);
      resolve({ message, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
    };
    child.on("message", onMessage);
    child.send({ type: "snapshot", requestId }, (error) => {
      if (!error) return;
      clearTimeout(timeout);
      child.off("message", onMessage);
      reject(error);
    });
  });
}

try {
  const first = await requestSnapshot();
  assert.equal(first.message.ok, true);
  assert.equal(typeof first.message.value, "object");
  assert.equal(child.pid, childPid, "first request must use the original worker process");

  const second = await requestSnapshot();
  assert.equal(second.message.ok, true);
  assert.equal(typeof second.message.value, "object");
  assert.equal(child.pid, childPid, "second request must reuse the same worker process");
  assert.equal(child.exitCode, null, "dashboard worker must stay alive between refreshes");

  console.log("dashboard persistent worker reuse PASS", {
    pid: childPid,
    firstMs: first.durationMs,
    secondMs: second.durationMs,
  });
} finally {
  if (child.connected) child.disconnect();
  if (!child.killed) child.kill();
  await fs.promises.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
