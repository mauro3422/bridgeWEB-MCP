import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Focal public-contract regression for Bridge context continuation.
 *
 * This deliberately uses normal discovered Codex skills instead of a test-only
 * input.  Their SKILL.md files have no manifest, so their whole contents are
 * the selected core.  The four exact core sizes reproduce the observed
 * 23,310-char selection against the 18,000-char request budget.
 */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-context-continuation-"));
const codexHome = path.join(sandbox, "codex");
const skillsRoot = path.join(codexHome, "skills");
const budget = 18_000;
const expectedSkillChars = new Map([
  ["mssr-agent-routing", 5_000],
  ["systematic-debugging", 6_504],
  ["complex-system-design", 5_298],
  ["capability-gap-recovery", 6_508],
]);
const expectedSkillNames = [...expectedSkillChars.keys()].sort();
const expectedCoreChars = [...expectedSkillChars.values()].reduce((sum, chars) => sum + chars, 0);

process.env.CODEX_HOME = codexHome;
// The test must use only its deterministic local fixtures.  An absent bundled
// root is an expected degraded catalog source, not a fallback to live skills.
process.env.MSSR_FIRST_PARTY_SKILLS_ROOT = path.join(sandbox, "empty-first-party");
process.env.BRIDGE_MCP_METRICS_DIR = path.join(sandbox, "metrics");
process.env.BRIDGE_MCP_LOG_DIR = path.join(sandbox, "logs");
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "mssr-events.jsonl");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(process.env.BRIDGE_MCP_METRICS_DIR, "bridge-metrics.sqlite");
process.env.BRIDGE_MCP_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "bridge-events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(process.env.BRIDGE_MCP_METRICS_DIR, "mssr-state.json");
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

function writeExactSkill(name, chars) {
  const directory = path.join(skillsRoot, name);
  fs.mkdirSync(directory, { recursive: true });
  const prefix = `---\nname: ${name}\ndescription: Continuation regression fixture for ${name}.\n---\n\n# ${name}\n\n`;
  assert.ok(prefix.length < chars, `fixture prefix unexpectedly exceeds ${name} budget`);
  fs.writeFileSync(path.join(directory, "SKILL.md"), prefix.padEnd(chars, "x"), "utf8");
}

for (const [name, chars] of expectedSkillChars) writeExactSkill(name, chars);

const intent = {
  domains: ["skill-system", "agent-orchestration", "coding"],
  actions: ["design", "debug", "analyze", "review"],
  artifacts: ["skill", "mcp", "code"],
  needs: ["integrity-verification", "unit-tests"],
  signals: ["repeated-friction", "replan-needed"],
  risk: "write",
  ambiguity: "low",
};

const bootstrapInput = {
  task: "Repair repeated context budget failures using mssr-agent-routing, systematic-debugging, complex-system-design, and capability-gap-recovery.",
  context: "Bridge must page accepted skills rather than silently dropping their context.",
  intent,
  caller: "chatgpt-web",
  stage: "implement",
  sources: ["codex-local"],
  selectionMode: "host-gated",
  maxSkills: expectedSkillNames.length,
};

function loadedNames(response) {
  assert.ok(Array.isArray(response.loaded), "continuation responses must retain the public loaded array");
  return response.loaded.map((item) => {
    assert.equal(typeof item?.skill?.name, "string", "each delivered item must retain its skill identity");
    return item.skill.name;
  });
}

function assertBounded(response, label) {
  assert.equal(response.contextAssembly.maxContextChars, budget, `${label} must retain the request context budget`);
  assert.equal(typeof response.contextAssembly.deliveredChars, "number", `${label} must report delivered chars`);
  assert.ok(response.contextAssembly.deliveredChars <= budget, `${label} delivered context exceeds the requested budget`);
  assert.equal(typeof response.responseChars, "number", `${label} must report its complete response size`);
  assert.ok(response.responseChars <= budget, `${label} response exceeds the requested budget`);
}

function assertPartial(response, label) {
  assert.equal(response.status, "partial", `${label} must explicitly report partial delivery`);
  assert.equal(response.mustContinue, true, `${label} must force continuation while selected context remains`);
  assert.equal(typeof response.cursor, "string", `${label} must return an opaque continuation cursor`);
  assert.ok(response.cursor.length >= 16, `${label} cursor is unexpectedly short`);
  assert.ok(response.nextAction, `${label} must expose a deterministic next action`);
  assert.equal(response.nextAction.toolName, "skill_context_next", `${label} must continue through skill_context_next`);
  assert.equal(response.nextAction.arguments.traceId, response.traceId, `${label} continuation must preserve its trace`);
  assert.equal(response.nextAction.arguments.cursor, response.cursor, `${label} continuation must pass the exact cursor`);
  assert.ok(response.remaining && typeof response.remaining === "object", `${label} must expose remaining selection metadata`);
  assert.ok(Array.isArray(response.remaining.units), `${label} must expose remaining units without their contents`);
  assert.ok(response.remaining.units.length > 0, `${label} must name at least one remaining unit`);
  assert.ok(Number.isInteger(response.remaining.chars) && response.remaining.chars > 0, `${label} must report remaining chars`);
}

function assertComplete(response, label) {
  assert.equal(response.status, "complete", `${label} must report completion after all context is delivered`);
  assert.equal(response.mustContinue, false, `${label} must stop continuation after completion`);
  assert.equal(response.cursor, null, `${label} must clear the consumed cursor`);
  assert.equal(response.nextAction, undefined, `${label} must not emit a continuation action after completion`);
  assert.deepEqual(response.remaining, { required: [], accepted: [], units: [], chars: 0 }, `${label} must not retain pending delivery metadata`);
  assert.equal(response.lifecycleGate?.contextChain, "complete", `${label} must expose the post-context lifecycle gate`);
  assert.equal(response.lifecycleGate?.traceId, response.traceId, `${label} lifecycle gate must preserve trace identity`);
  assert.equal(response.lifecycleGate?.automaticCheckpoint, false, `${label} must not claim that delivered context was used`);
  assert.equal(response.lifecycleGate?.automaticOutcome, false, `${label} must never infer task success from context completion`);
  assert.equal(response.lifecycleGate?.phaseCheckpointTemplate?.toolName, "mssr_trace_record", `${label} must name the explicit checkpoint boundary`);
}

function acceptedOptionalDecisions(route) {
  const roots = route.activeSkills.filter((skill) => skill.selectedAsRoot);
  assert.deepEqual(roots.map((skill) => skill.name).sort(), expectedSkillNames, "fixture route must expose exactly the four selected continuation skills");
  assert.deepEqual(
    roots.filter((skill) => skill.required).map((skill) => skill.name),
    ["mssr-agent-routing"],
    "skill-system maintenance must retain its required routing core",
  );
  return roots.filter((skill) => !skill.required).map((skill) => ({
    skillName: skill.name,
    decision: "accepted",
    reasonCode: "useful",
    reasonSummary: "Required by the focused continuation regression.",
  }));
}

const [{ skillCatalogToolModule }, { closeMssrObservatoryForTests }, { closeMetricsForTests }] = await Promise.all([
  import("../dist/tools/skill-catalog-tools.js"),
  import("../dist/mssr-observatory.js"),
  import("../dist/metrics.js"),
]);

const routePlan = skillCatalogToolModule.handlers.skill_route_plan;
const bootstrap = skillCatalogToolModule.handlers.skill_bootstrap;
const next = skillCatalogToolModule.handlers.skill_context_next;
assert.equal(typeof routePlan, "function");
assert.equal(typeof bootstrap, "function");
assert.equal(typeof next, "function", "Bridge must expose the public read-only skill_context_next handler");

try {
  const route = await routePlan({ ...bootstrapInput, responseMode: "debug" });
  const skillDecisions = acceptedOptionalDecisions(route);

  const first = await bootstrap({ ...bootstrapInput, traceId: route.traceId, skillDecisions, maxContextChars: budget, maxEnvelopeChars: budget });
  assert.equal(first.contextAssembly.selectedChars, expectedCoreChars, "fixture must reproduce the 18,000 vs 23,310 selected-context pressure");
  assert.equal(first.contextAssembly.requiredCoreReservedChars, expectedSkillChars.get("mssr-agent-routing"), "accepted roots must not be relabeled as required obligations");
  assertPartial(first, "first response");
  assertBounded(first, "first response");

  const tamperedCursor = `${first.cursor.slice(0, -1)}${first.cursor.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(
    () => next({ traceId: first.traceId, cursor: tamperedCursor }),
    /(?:cursor.*(?:invalid|tampered|fingerprint|mismatch)|(?:invalid|tampered|fingerprint|mismatch).*cursor)/i,
    "tampered continuation cursors must fail clearly",
  );

  const delivered = [...loadedNames(first)];
  let page = first;
  while (page.mustContinue) {
    const consumedCursor = page.cursor;
    page = await next({ traceId: page.traceId, cursor: consumedCursor });
    assertBounded(page, "continuation response");
    delivered.push(...loadedNames(page));

    await assert.rejects(
      () => next({ traceId: page.traceId, cursor: consumedCursor }),
      /(?:cursor.*(?:stale|consumed|expired|invalid)|(?:stale|consumed|expired|invalid).*cursor)/i,
      "a consumed continuation cursor must fail clearly",
    );
  }
  assertComplete(page, "final response");
  assert.deepEqual(delivered.sort(), expectedSkillNames, "the complete continuation chain must deliver every selected unit exactly once");

  const completeInOne = await bootstrap({ ...bootstrapInput, skillDecisions, maxContextChars: 30_000, maxEnvelopeChars: 40_000 });
  assertComplete(completeInOne, "fit-in-one response");
  assert.deepEqual(loadedNames(completeInOne).sort(), expectedSkillNames, "a fitting selection must deliver each unit once without a cursor");

  console.log(JSON.stringify({
    ok: true,
    expectedCoreChars,
    budget,
    pages: delivered.length,
    firstDeliveredChars: first.contextAssembly.deliveredChars,
  }, null, 2));
} finally {
  closeMssrObservatoryForTests();
  closeMetricsForTests();
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
