import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-intent-"));
const metricsDir = path.join(sandbox, "metrics");
const logDir = path.join(sandbox, "logs");
process.env.CODEX_HOME = path.join(sandbox, "codex");
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, "mssr-observability-state.json");

const [{ normalizeMssrIntent }, { skillCatalogToolModule }, observatory] = await Promise.all([
  import("@mauroprime/mssr"),
  import("../dist/tools/skill-catalog-tools.js"),
  import("../dist/mssr-observatory.js"),
]);

const canonical = normalizeMssrIntent({
  domains: ["skill-system"],
  actions: ["review"],
  signals: ["nominal"],
  risk: "read-only",
});
assert.equal(canonical.status, "canonical");
assert.deepEqual(canonical.intent?.domains, ["skill-system"]);

const defaultedSignals = normalizeMssrIntent({
  domains: ["skill-system"],
  actions: ["review"],
});
assert.equal(defaultedSignals.status, "normalized");
assert.deepEqual(defaultedSignals.intent?.signals, ["nominal"]);
assert.equal(defaultedSignals.changes[0]?.id, "signals:missing->nominal");

const normalized = normalizeMssrIntent({
  domains: ["local_app_development"],
  actions: ["inspect"],
  signals: ["nominal"],
  risk: "bounded-write",
});
assert.equal(normalized.status, "normalized");
assert.deepEqual(normalized.intent?.domains, ["coding"]);
assert.deepEqual(normalized.intent?.actions, ["review"]);
assert.equal(normalized.intent?.risk, "write");
assert.deepEqual(
  normalized.changes.map((change) => change.id),
  [
    "risk:bounded-write->write",
    "domains:local-app-development->coding",
    "actions:inspect->review",
  ],
);

const relocated = normalizeMssrIntent({
  domains: ["coding", "ui"],
  actions: ["review"],
  artifacts: [],
  signals: ["nominal"],
});
assert.equal(relocated.status, "normalized");
assert.deepEqual(relocated.intent?.domains, ["coding"]);
assert.deepEqual(relocated.intent?.artifacts, ["ui"]);

const ambiguous = normalizeMssrIntent({
  domains: ["bridge-mcp"],
  actions: ["animate"],
  signals: ["verification-needed"],
  risk: "read-only",
});
assert.equal(ambiguous.status, "correction-required");
assert.equal(ambiguous.intent, undefined);
assert.deepEqual(
  ambiguous.issues.map((issue) => issue.field),
  ["domains", "actions", "signals"],
);

const emptyAfterMove = normalizeMssrIntent({
  domains: ["ui"],
  actions: ["review"],
  signals: ["nominal"],
});
assert.equal(emptyAfterMove.status, "correction-required");
assert.equal(emptyAfterMove.issues.some((issue) => issue.field === "domains" && issue.code === "missing-required"), true);

const bootstrap = skillCatalogToolModule.handlers.skill_bootstrap;
assert.ok(bootstrap);
const sentinel = "private-sentinel-must-not-persist";
const recovery = await bootstrap({
  task: "bounded normalization regression",
  intent: {
    domains: ["coding"],
    actions: [sentinel],
    signals: ["nominal"],
  },
  caller: "chatgpt-web",
  stage: "implement",
  workflowKey: "intent-normalization-regression",
});
assert.equal(recovery.routed, false);
assert.equal(recovery.intentResolution.status, "correction-required");
assert.equal(recovery.recoveryAction.toolName, "skill_bootstrap");
assert.equal(recovery.recoveryAction.arguments.traceId, recovery.traceId);
assert.equal(recovery.recoveryAction.arguments.intent.actions.length, 0);

const recent = observatory.queryMssrObservatory({ kind: "recent", scope: "active", days: 1, limit: 20 });
const correction = recent.recent.find((event) => event.eventType === "intent_correction_required");
assert.ok(correction);
assert.deepEqual(correction.details.unresolvedFields, ["actions"]);
assert.equal(JSON.stringify(correction).includes(sentinel), false);

observatory.closeMssrObservatoryForTests();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log("MSSR intent normalization regression passed.");
