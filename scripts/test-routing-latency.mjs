import assert from "node:assert/strict";

process.env.BRIDGE_MCP_SKILL_CATALOG_TTL_MS = "1000";
const { createDefaultToolRegistry } = await import("../dist/tool-registry.js");
const registry = createDefaultToolRegistry();

const intent = {
  summary: "Inspect Bridge routing latency without changing routing semantics.",
  domains: ["coding", "agent-orchestration", "skill-system"],
  actions: ["analyze", "verify"],
  artifacts: ["mcp", "code"],
  needs: ["performance", "integrity-verification"],
  signals: ["repeated-friction"],
  risk: "read-only",
  ambiguity: "low",
};

const bootstrapArgs = {
  task: "Analyze Bridge routing latency and optimize skill selection",
  context: "",
  intent,
  caller: "chatgpt-web",
  model: "fixture-model",
  reasoningEffort: "unknown",
  stage: "verify",
  workflowKey: "routing-latency-regression",
  maxSkills: 6,
};

function assertTimingEnvelope(value, scope, requiredPhases) {
  assert.equal(value?.schemaVersion, 1, `${scope}: timing schema missing`);
  assert.equal(value?.scope, scope, `${scope}: wrong timing scope`);
  assert.equal(value?.clock, "monotonic-process", `${scope}: wrong timing clock`);
  assert.equal(typeof value?.runtimeBootId, "string", `${scope}: runtime boot id missing`);
  assert.equal(value.runtimeBootId.length > 0, true, `${scope}: runtime boot id empty`);
  assert.equal(Number.isFinite(value?.totalMs), true, `${scope}: totalMs missing`);
  assert.equal(Number.isFinite(value?.instrumentedMs), true, `${scope}: instrumentedMs missing`);
  assert.equal(Number.isFinite(value?.uninstrumentedMs), true, `${scope}: uninstrumentedMs missing`);
  assert.equal(value.instrumentedMs >= 0 && value.instrumentedMs <= value.totalMs, true, `${scope}: invalid instrumented coverage`);
  assert.equal(value.uninstrumentedMs >= 0 && value.uninstrumentedMs <= value.totalMs, true, `${scope}: invalid uninstrumented coverage`);
  const names = new Set((value.phases ?? []).map((phase) => phase.name));
  for (const phase of requiredPhases) assert.equal(names.has(phase), true, `${scope}: missing phase ${phase}`);
}

const cold = await registry.call("skill_bootstrap", bootstrapArgs);
const warm = await registry.call("skill_bootstrap", bootstrapArgs);
assertTimingEnvelope(cold.bridgeTiming, "skill_bootstrap", ["skill.discovery", "routing.plan", "observability.route", "workflow.guide", "skill.context.plan", "observability.skill-loads"]);
assertTimingEnvelope(warm.bridgeTiming, "skill_bootstrap", ["skill.discovery", "routing.plan", "observability.route", "workflow.guide", "skill.context.plan", "observability.skill-loads"]);
assert.deepEqual(
  warm.activeSkills.map((skill) => skill.name),
  cold.activeSkills.map((skill) => skill.name),
  "warm catalog reuse must not change the selected skill set",
);
assert.deepEqual(
  warm.workflowGuideRecommendation?.recommendation,
  cold.workflowGuideRecommendation?.recommendation,
  "warm catalog reuse must not change guide-vs-skill ownership",
);

const coldDiscovery = cold.bridgeTiming.phases.find((phase) => phase.name === "skill.discovery").durationMs;
const warmDiscovery = warm.bridgeTiming.phases.find((phase) => phase.name === "skill.discovery").durationMs;
assert.equal(warmDiscovery <= coldDiscovery, true, `warm discovery should not exceed cold discovery in the same process (${warmDiscovery} > ${coldDiscovery})`);

const catalogBeforeTtl = await registry.call("skill_catalog", { sources: ["codex-local", "codex-system", "codex-plugin"], maxResults: 600 });
const cacheBeforeTtl = catalogBeforeTtl.sourceHealth.codex.discoveryCache;
assert.equal(["watcher", "ttl-fallback"].includes(cacheBeforeTtl.mode), true, "Codex discovery cache mode must be observable");
await new Promise((resolve) => setTimeout(resolve, 1150));
const catalogAfterTtl = await registry.call("skill_catalog", { sources: ["codex-local", "codex-system", "codex-plugin"], maxResults: 600 });
const cacheAfterTtl = catalogAfterTtl.sourceHealth.codex.discoveryCache;
if (cacheBeforeTtl.mode === "watcher" && cacheAfterTtl.invalidationCount === cacheBeforeTtl.invalidationCount) {
  assert.equal(cacheAfterTtl.scanCount, cacheBeforeTtl.scanCount, "healthy watchers must keep the catalog warm after TTL expiry");
  assert.equal(cacheAfterTtl.cacheHitCount > cacheBeforeTtl.cacheHitCount, true, "post-TTL reuse should register a cache hit when no watcher invalidation occurred");
} else {
  assert.equal(cacheAfterTtl.scanCount >= cacheBeforeTtl.scanCount, true, "TTL fallback or watcher invalidation must never decrease scan accounting");
}

const plan = await registry.call("skill_route_plan", {
  ...bootstrapArgs,
  workflowKey: "routing-latency-plan-regression",
  responseMode: "compact",
});
assertTimingEnvelope(plan.bridgeTiming, "skill_route_plan", ["skill.discovery", "routing.plan", "observability.route", "workflow.guide"]);

const projectContext = await registry.call("project_context_load", {
  projectRoot: process.cwd(),
  workflowKey: "routing-latency-project-context-regression",
  includeAgents: true,
  includeProjectContext: true,
  includeGuides: false,
});
assertTimingEnvelope(projectContext.bridgeTiming, "project_context_load", ["project.load", "project.health", "project.context.assemble"]);
assert.equal(projectContext.recommendation, null, "includeGuides=false must skip workflow guide recommendation entirely");
assert.deepEqual(projectContext.guides, [], "includeGuides=false must not expose discovered guides");
assert.equal(projectContext.bridgeTiming.phases.some((phase) => phase.name === "workflow.guide.recommend"), false, "includeGuides=false must not pay recommendation latency");

console.log("Bridge routing latency instrumentation PASS", {
  coldMs: cold.bridgeTiming.totalMs,
  warmMs: warm.bridgeTiming.totalMs,
  coldDiscoveryMs: coldDiscovery,
  warmDiscoveryMs: warmDiscovery,
  warmUninstrumentedMs: warm.bridgeTiming.uninstrumentedMs,
});
