import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-metrics-wal-"));
process.env.BRIDGE_MCP_METRICS_DIR = root;
process.env.BRIDGE_MCP_LOG_DIR = root;
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(root, "bridge-metrics.sqlite");
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(root, "mssr-events.jsonl");
process.env.BRIDGE_MCP_METRICS_WAL_CHECKPOINT_DELAY_MS = "250";
process.env.BRIDGE_MCP_METRICS_WAL_CHECKPOINT_BUSY_MS = "100";

const { createDefaultToolRegistry } = await import("../dist/tool-registry.js");
const { closeMetricsForTests, getMetricsStatus } = await import("../dist/metrics.js");
const { closeMssrObservatoryForTests } = await import("../dist/mssr-observatory.js");

const registry = createDefaultToolRegistry();
const bootstrapArgs = {
  task: "Verify routing latency while WAL checkpoints run off the request path.",
  context: "",
  intent: {
    summary: "Verify metrics WAL maintenance outside the routing request path.",
    domains: ["coding", "agent-orchestration"],
    actions: ["verify"],
    artifacts: ["mcp", "code"],
    needs: ["performance", "integrity-verification"],
    signals: ["nominal"],
    risk: "read-only",
    ambiguity: "low",
  },
  caller: "chatgpt-web",
  model: "fixture-model",
  reasoningEffort: "unknown",
  stage: "verify",
  workflowKey: "metrics-wal-maintenance-regression",
  maxSkills: 6,
};
const bootstrap = await registry.call("skill_bootstrap", bootstrapArgs);

const phaseNames = new Set(bootstrap.bridgeTiming?.phases?.map((phase) => phase.name) ?? []);
assert.equal(phaseNames.has("observability.route"), true, "route persistence timing must stay visible");
assert.equal(phaseNames.has("observability.skill-loads"), true, "skill-load persistence timing must stay visible");

const secondBootstrap = await registry.call("skill_bootstrap", bootstrapArgs);
const beforeIdleCheckpoint = getMetricsStatus();
assert.equal(beforeIdleCheckpoint.walMaintenance?.checkpointCount, 0, "checkpoint must stay deferred while routing writes are still arriving");
assert.equal(beforeIdleCheckpoint.walMaintenance?.scheduled, true, "quiet-period checkpoint must remain scheduled after the latest write");
assert.equal(secondBootstrap.bridgeTiming?.totalMs >= 0, true);

await new Promise((resolve) => setTimeout(resolve, 650));
const status = getMetricsStatus();
assert.equal(status.walMaintenance?.mode, "passive-worker");
assert.equal(status.walMaintenance?.autoCheckpointDisabledOnWriters, true);
assert.equal(status.walMaintenance?.checkpointCount >= 1, true, "checkpoint worker did not run");
assert.equal(status.walMaintenance?.failureCount, 0, status.walMaintenance?.lastError ?? "checkpoint worker failed");
assert.equal(status.walMaintenance?.inFlight, false);
assert.equal(status.walMaintenance?.dirty, false);
assert.equal(Number.isFinite(status.walMaintenance?.lastDurationMs), true);
assert.equal(Number(status.walMaintenance?.lastResult?.busy ?? 0), 0, "passive checkpoint stayed busy in isolated fixture");

closeMssrObservatoryForTests();
closeMetricsForTests();
await fs.rm(root, { recursive: true, force: true });

console.log("Bridge metrics WAL maintenance PASS", {
  checkpointCount: status.walMaintenance.checkpointCount,
  lastDurationMs: status.walMaintenance.lastDurationMs,
  lastResult: status.walMaintenance.lastResult,
  bootstrapMs: bootstrap.bridgeTiming.totalMs,
});
