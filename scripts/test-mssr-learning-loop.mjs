import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-learning-loop-"));
const metricsDir = path.join(sandbox, "metrics");
const logDir = path.join(sandbox, "logs");
const codexHome = path.join(sandbox, "codex");
const skillsRoot = path.join(codexHome, "skills");
fs.mkdirSync(skillsRoot, { recursive: true });

process.env.CODEX_HOME = codexHome;
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(process.env.BRIDGE_MCP_METRICS_DIR, "bridge-metrics.sqlite");
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "mssr-events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, "mssr-observability-state.json");

const skillNames = [
  "mssr-agent-routing",
  "shared-skill-governance",
  "skill-routing-maintainer",
  "skill-maintenance-loop",
  "systematic-debugging",
  "capability-gap-recovery",
  "mssr-observability-maintenance",
  "mauroprime-bridge-collaboration",
  "mauroprime-bridge-tool-authoring",
  "conversation-history-review",
];

for (const name of skillNames) {
  const dir = path.join(skillsRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture ${name} for MSSR learning-loop regression.\n---\n# ${name}\n\nFixture procedural guidance.\n`, "utf8");
}

const [{ skillCatalogToolModule }, { mssrObservatoryToolModule }, observatory] = await Promise.all([
  import("../dist/tools/skill-catalog-tools.js"),
  import("../dist/tools/mssr-observatory-tools.js"),
  import("../dist/mssr-observatory.js"),
]);

const bootstrap = skillCatalogToolModule.handlers.skill_bootstrap;
const evidence = mssrObservatoryToolModule.handlers.mssr_trace_evidence;
const workingUpdate = mssrObservatoryToolModule.handlers.mssr_trace_working_update;
const record = mssrObservatoryToolModule.handlers.mssr_trace_record;
const summary = mssrObservatoryToolModule.handlers.mssr_observatory_query;
assert.ok(bootstrap && evidence && workingUpdate && record && summary);

const task = "Maintain the MSSR skill system and verify reusable routing behavior.";
const intent = {
  summary: task,
  domains: ["skill-system", "agent-orchestration", "coding"],
  actions: ["edit", "debug", "test", "verify", "maintain"],
  artifacts: ["skill", "mcp", "code", "project"],
  needs: ["unit-tests", "integrity-verification", "cross-agent"],
  signals: ["repeated-friction", "reusable-pattern"],
  risk: "write",
  ambiguity: "low",
};

const first = await bootstrap({
  task,
  intent,
  caller: "chatgpt-web",
  model: "fixture-model",
  reasoningEffort: "high",
  stage: "implement",
  workflowKey: "mssr-learning-loop-regression",
  includeReferences: "none",
  maxContextChars: 50_000,
});
assert.equal(first.selection.mode, "host-gated");
const required = first.activeSkills.filter((skill) => skill.required);
const optionalRoots = first.activeSkills.filter((skill) => skill.selectedAsRoot && !skill.required);
const dependencyOnlyOptional = first.activeSkills.filter((skill) => !skill.selectedAsRoot && !skill.required);
assert.ok(required.length > 0, "fixture must route required skills");
assert.ok(optionalRoots.length > 0, "fixture must route optional root candidates");
const firstLoaded = new Set(first.loaded.filter((item) => item.loaded).map((item) => item.skill.name));
for (const skill of required) assert.equal(firstLoaded.has(skill.name), true, `required ${skill.name} must load`);
for (const skill of optionalRoots) {
  assert.equal(firstLoaded.has(skill.name), false, `undecided optional root ${skill.name} must remain out of context`);
  assert.equal(first.selection.decisions.some((item) => item.skillName === skill.name), false,
    `undecided optional root ${skill.name} must not fabricate a skipped decision`);
  assert.ok(first.selection.pendingCandidates.some((item) => item.skill === skill.name && item.decisionState === "absent"),
    `undecided optional root ${skill.name} must remain visibly pending`);
}
for (const skill of dependencyOnlyOptional) {
  assert.equal(firstLoaded.has(skill.name), false, `dependency-only optional ${skill.name} must remain out of context until its root is accepted`);
  assert.equal(first.selection.decisions.some((item) => item.skillName === skill.name), false, `dependency-only ${skill.name} must inherit its root decision instead of receiving an independent host decision`);
}

const acceptedName = optionalRoots[0].name;
const explicitlySkippedName = optionalRoots[1]?.name;
const decisions = [
  { skillName: acceptedName, decision: "accepted", reasonCode: "useful", reasonSummary: "Needed for this phase." },
];
if (explicitlySkippedName) {
  decisions.push({ skillName: explicitlySkippedName, decision: "skipped", reasonCode: "irrelevant-domain", reasonSummary: "Not needed in this semantic task." });
}

const second = await bootstrap({
  task,
  context: "Continue the same routed task after reviewing optional candidates.",
  intent,
  caller: "chatgpt-web",
  model: "fixture-model",
  reasoningEffort: "high",
  stage: "implement",
  workflowKey: "mssr-learning-loop-regression",
  traceId: first.traceId,
  selectionMode: "host-gated",
  skillDecisions: decisions,
  includeReferences: "none",
  maxContextChars: 50_000,
});
const secondLoaded = new Set(second.loaded.filter((item) => item.loaded).map((item) => item.skill.name));
assert.equal(secondLoaded.has(acceptedName), true, "accepted optional must load");
if (explicitlySkippedName) assert.equal(secondLoaded.has(explicitlySkippedName), false, "explicitly skipped optional must not load");

const working = await workingUpdate({
  traceId: first.traceId,
  workingMemory: {
    workingSummary: "Host-gated selection is under verification.",
    hypotheses: [{ summary: "Skipped optional skills stay outside procedural context.", status: "supported", evidenceRef: "bootstrap selection" }],
    decisions: [{ subject: acceptedName, decision: "accepted", reason: "Useful for this phase." }],
    nextGate: "outcome purge regression",
  },
});
assert.equal(working.updated, true);
assert.equal(working.durableTelemetryWritten, false);

let trace = evidence({ traceId: first.traceId, limit: 200 });
assert.equal(trace.workingMemory?.workingSummary, "Host-gated selection is under verification.");

const selectionSummary = summary({ kind: "benchmark", scope: "all", days: 1, limit: 100 });
const feedback = selectionSummary.intentAnalysis.selectionFeedback.find((item) => item.skillName === acceptedName);
assert.ok(feedback, "accepted/skipped feedback must reach observatory analysis");
assert.ok(feedback.accepted >= 1);
assert.equal(feedback.skipped, 0, "an absent host decision must not be recorded as skipped/not-evaluated feedback");
assert.ok(feedback.signatures.some((item) => item.signature.includes("d=agent-orchestration,coding,skill-system")));
if (explicitlySkippedName) {
  const skippedFeedback = selectionSummary.intentAnalysis.selectionFeedback.find((item) => item.skillName === explicitlySkippedName);
  assert.ok(skippedFeedback?.reasonCounts?.["irrelevant-domain"] >= 1);
}

const outcomeRecord = record({
  traceId: first.traceId,
  eventType: "outcome",
  caller: "chatgpt-web",
  model: "fixture-model",
  reasoningEffort: "high",
  stage: "implement",
  primarySkill: required[0].name,
  status: "partial",
  summary: "Close trace to verify ephemeral memory purge and durable digest distillation.",
});
assert.equal(outcomeRecord.learningDigest?.recorded, true, "outcome must persist one strict learning digest before purge");
assert.equal(outcomeRecord.learningDigest?.workingMemoryPurged, true);
trace = evidence({ traceId: first.traceId, limit: 200 });
assert.equal(trace.workingMemory, null, "working memory must be purged after outcome");
assert.equal(trace.lifecycle.status, "closed-partial");
assert.ok(trace.learningDigest, "trace evidence must expose the durable learning digest");
const serializedDigest = JSON.stringify(trace.learningDigest);
assert.equal(serializedDigest.includes("Host-gated selection is under verification."), false, "workingSummary must never be copied into durable learning");
assert.equal(serializedDigest.includes("Skipped optional skills stay outside procedural context."), true, "evidence-backed supported findings may survive distillation");
assert.equal(trace.learningDigest.findings[0]?.evidenceRef, "bootstrap selection");
assert.equal(trace.learningDigest.semanticSignature.startsWith("stage=implement|"), true, "durable priors must anchor to the first structured task signature, not a later close-stage route");
const learningSummary = summary({ kind: "benchmark", scope: "all", days: 1, limit: 100 });
assert.equal(learningSummary.intentAnalysis.learning.mode, "observe-only");
assert.equal(learningSummary.intentAnalysis.learning.routingInfluence, false);
assert.ok(learningSummary.intentAnalysis.learning.digestCount >= 1);
assert.ok(learningSummary.intentAnalysis.learning.skillPriors.some((item) => item.semanticSignature.includes("d=agent-orchestration,coding,skill-system")));
const closeTrace = await bootstrap({
  task: "Close a repeated-friction MSSR maintenance task.",
  intent: {
    ...intent,
    actions: ["review", "verify", "maintain"],
    signals: ["repeated-friction", "reusable-pattern"],
  },
  caller: "chatgpt-web",
  model: "fixture-model",
  reasoningEffort: "high",
  stage: "close",
  workflowKey: "mssr-learning-loop-close-regression",
  includeReferences: "none",
  maxContextChars: 50_000,
});
const closeEvidence = evidence({ traceId: closeTrace.traceId, limit: 200 });
assert.equal(closeEvidence.lifecycle.closure.closureDue, true);
assert.equal(closeEvidence.lifecycle.closure.canCloseSuccess, false);
assert.notEqual(closeEvidence.lifecycle.closure.nextRequiredAction, "record-outcome");

observatory.closeMssrObservatoryForTests();
try {
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
} catch (error) {
  if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
}
console.log("MSSR learning-loop Bridge regression passed.");
