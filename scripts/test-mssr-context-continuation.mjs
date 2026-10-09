import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Focal public-contract regression for Bridge context continuation.
 *
 * MSSR 0.2.79 makes continuation proportional: unresolved required obligations
 * may page, while accepted optional roots are allowed to be omitted under
 * pressure. The required routing fixture therefore owns three required modules
 * so the chain still exercises cursor integrity without relabeling optional
 * roots as required.
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
const requiredModuleChars = new Map([
  ["continuation-a", 6_504],
  ["continuation-b", 5_298],
  ["continuation-c", 6_508],
]);
const expectedSkillNames = [...expectedSkillChars.keys()].sort();
const expectedRequiredUnitIds = [
  "mssr-agent-routing:core",
  ...[...requiredModuleChars.keys()].map((id) => `mssr-agent-routing:module:${id}`),
].sort();
const expectedRequiredChars = expectedSkillChars.get("mssr-agent-routing") + [...requiredModuleChars.values()].reduce((sum, chars) => sum + chars, 0);
const expectedOptionalRootChars = [...expectedSkillChars.entries()].filter(([name]) => name !== "mssr-agent-routing").reduce((sum, [, chars]) => sum + chars, 0);
const expectedSelectedChars = expectedRequiredChars + expectedOptionalRootChars;

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

  if (name !== "mssr-agent-routing") return;

  const activeCorePrefix = `# Active skill context: ${name}\n\n`;
  const coreContentChars = chars - activeCorePrefix.length;
  assert.ok(coreContentChars > 0, "routing core fixture must leave room for content");
  fs.writeFileSync(path.join(directory, "core.md"), "r".repeat(coreContentChars), "utf8");

  const modules = [];
  let fillCode = "a".charCodeAt(0);
  for (const [id, targetChars] of requiredModuleChars) {
    const assembledPrefix = `## Selected context module: ${id}\n\n`;
    const contentChars = targetChars - assembledPrefix.length - 2;
    assert.ok(contentChars > 0, `required module fixture ${id} must leave room for content`);
    const filename = `${id}.md`;
    fs.writeFileSync(path.join(directory, filename), String.fromCharCode(fillCode).repeat(contentChars), "utf8");
    fillCode += 1;
    modules.push({
      id,
      description: `Required continuation regression module ${id}.`,
      source: { path: filename },
      required: true,
      priority: 50,
      maxChars: targetChars,
    });
  }
  fs.writeFileSync(path.join(directory, "context-modules.json"), JSON.stringify({
    schemaVersion: 1,
    core: { path: "core.md" },
    modules,
  }, null, 2), "utf8");
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
  context: "Bridge must continue unresolved required context while keeping accepted optional roots observable without forcing them through the chain.",
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
  assert.equal(response.mustContinue, true, `${label} must force continuation while required selected context remains`);
  assert.equal(typeof response.cursor, "string", `${label} must return an opaque continuation cursor`);
  assert.ok(response.cursor.length >= 16, `${label} cursor is unexpectedly short`);
  assert.ok(response.nextAction, `${label} must expose a deterministic next action`);
  assert.equal(response.nextAction.toolName, "skill_context_next", `${label} must continue through skill_context_next`);
  assert.equal(response.nextAction.arguments.traceId, response.traceId, `${label} continuation must preserve its trace`);
  assert.equal(response.nextAction.arguments.cursor, response.cursor, `${label} continuation must pass the exact cursor`);
  assert.ok(response.remaining && typeof response.remaining === "object", `${label} must expose remaining selection metadata`);
  assert.ok(Array.isArray(response.remaining.units), `${label} must expose remaining units without their contents`);
  assert.ok(response.remaining.units.length > 0, `${label} must name at least one remaining unit`);
  assert.ok(Number.isInteger(response.remaining.requiredCount), `${label} must report the required unit count`);
  assert.ok(Number.isInteger(response.remaining.acceptedCount), `${label} must report the accepted unit count`);
  assert.ok(Number.isInteger(response.remaining.chars) && response.remaining.chars > 0, `${label} must report remaining chars`);
}

function assertComplete(response, label) {
  assert.equal(response.status, "complete", `${label} must report completion after all context is delivered`);
  assert.equal(response.mustContinue, false, `${label} must stop continuation after completion`);
  assert.equal(response.cursor, null, `${label} must clear the consumed cursor`);
  assert.equal(response.nextAction, undefined, `${label} must not emit a continuation action after completion`);
  assert.deepEqual(response.remaining, { requiredCount: 0, acceptedCount: 0, units: [], chars: 0 }, `${label} must not retain pending delivery metadata`);
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

const responseHelpers = await import("../dist/skill-context-response.js");
const envelopeBase = { status: "partial", payload: "x".repeat(1_000) };
const fullTiming = { detail: "full", payload: "t".repeat(400) };
const compactTiming = { detail: "compact", payload: "c".repeat(120) };
const baseEnvelopeChars = responseHelpers.withResponseChars(envelopeBase).responseChars;
const fullEnvelopeChars = responseHelpers.withResponseChars({ ...envelopeBase, bridgeTiming: fullTiming }).responseChars;
const compactEnvelopeChars = responseHelpers.withResponseChars({ ...envelopeBase, bridgeTiming: compactTiming }).responseChars;
assert.ok(fullEnvelopeChars > compactEnvelopeChars && compactEnvelopeChars > baseEnvelopeChars, "fixture must distinguish full, compact and omitted diagnostics");
const fullTimingResponse = responseHelpers.withBestEffortOptionalResponseField(envelopeBase, "bridgeTiming", [fullTiming, compactTiming], fullEnvelopeChars);
assert.deepEqual(fullTimingResponse.bridgeTiming, fullTiming, "full diagnostics should win when they fit");
const compactTimingResponse = responseHelpers.withBestEffortOptionalResponseField(envelopeBase, "bridgeTiming", [fullTiming, compactTiming], compactEnvelopeChars);
assert.deepEqual(compactTimingResponse.bridgeTiming, compactTiming, "compact diagnostics should be used when full diagnostics exceed the envelope");
const omittedTimingResponse = responseHelpers.withBestEffortOptionalResponseField(envelopeBase, "bridgeTiming", [fullTiming, compactTiming], baseEnvelopeChars);
assert.equal(Object.prototype.hasOwnProperty.call(omittedTimingResponse, "bridgeTiming"), false, "optional timing must be omitted rather than failing when only the base response fits");
assert.equal(omittedTimingResponse.responseChars, baseEnvelopeChars, "omitted timing fallback must preserve the exact bounded base response size");

const [{ skillCatalogToolModule, closeCodexSkillDiscoveryForTests }, { closeMssrObservatoryForTests }, { closeMetricsForTests }] = await Promise.all([
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
  assert.equal(first.contextAssembly.selectedChars, expectedSelectedChars, "fixture must retain the complete required + accepted selection accounting under pressure");
  assert.equal(first.contextAssembly.requiredCoreReservedChars, expectedSkillChars.get("mssr-agent-routing"), "accepted roots must not be relabeled as required obligations");
  assert.equal(first.contextAssembly.requiredModuleReservedChars, [...requiredModuleChars.values()].reduce((sum, chars) => sum + chars, 0), "required module pressure must remain explicit");
  assert.equal(first.contextAssembly.acceptedOverflowChars, expectedOptionalRootChars, "accepted optional roots must remain observable while required continuation is pending");
  assertPartial(first, "first response");
  assertBounded(first, "first response");

  const tamperedCursor = `${first.cursor.slice(0, -1)}${first.cursor.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(
    () => next({ traceId: first.traceId, cursor: tamperedCursor }),
    /(?:cursor.*(?:invalid|tampered|fingerprint|mismatch)|(?:invalid|tampered|fingerprint|mismatch).*cursor)/i,
    "tampered continuation cursors must fail clearly",
  );

  const deliveredRequiredUnitIds = first.contextAssembly.units
    .map((unit) => unit.id)
    .filter((id) => expectedRequiredUnitIds.includes(id));
  let page = first;
  while (page.mustContinue) {
    const consumedCursor = page.cursor;
    page = await next({ traceId: page.traceId, cursor: consumedCursor });
    assertBounded(page, "continuation response");
    deliveredRequiredUnitIds.push(...page.contextAssembly.units
      .map((unit) => unit.id)
      .filter((id) => expectedRequiredUnitIds.includes(id)));

    await assert.rejects(
      () => next({ traceId: page.traceId, cursor: consumedCursor }),
      /(?:cursor.*(?:stale|consumed|expired|invalid)|(?:stale|consumed|expired|invalid).*cursor)/i,
      "a consumed continuation cursor must fail clearly",
    );
  }
  assertComplete(page, "final response");
  assert.deepEqual(deliveredRequiredUnitIds.sort(), expectedRequiredUnitIds, "the continuation chain must deliver every required unit exactly once");
  const finalAccepted = page.contextAssembly.skills.filter((item) => item.obligation === "accepted");
  assert.ok(finalAccepted.every((item) => item.required === false), "accepted optional roots must remain non-required through the continuation chain");

  const completeInOne = await bootstrap({ ...bootstrapInput, skillDecisions, maxContextChars: 50_000, maxEnvelopeChars: 60_000 });
  assertComplete(completeInOne, "fit-in-one response");
  assert.deepEqual(loadedNames(completeInOne).sort(), expectedSkillNames, "a fitting selection must deliver each selected skill without a cursor");
  assert.equal(completeInOne.contextAssembly.selectedChars, expectedSelectedChars, "fit-in-one accounting must include required and accepted context bytes");

  const retainedContextObligations = completeInOne.contextAssembly.units.map(({ id, fingerprint }) => ({ id, fingerprint }));
  assert.equal(retainedContextObligations.length, expectedRequiredUnitIds.length + expectedSkillNames.length - 1, "fit-in-one response must expose one stable receipt per selected unit");
  assert.ok(retainedContextObligations.every((item) => typeof item.id === "string" && /^[A-Za-z0-9_-]{43}$/.test(item.fingerprint)), "every retention receipt must expose a stable id and exact content fingerprint");

  const retained = await bootstrap({ ...bootstrapInput, traceId: completeInOne.traceId, skillDecisions, maxContextChars: 50_000, maxEnvelopeChars: 60_000, retainedContextObligations });
  assertComplete(retained, "fully retained response");
  assert.equal(retained.contextAssembly.deliveredChars, 0, "exact retained obligations must suppress duplicate procedural bytes");
  assert.equal(retained.contextAssembly.retainedContextCharsSaved, expectedSelectedChars, "retained savings must equal the exact selected context bytes");
  assert.equal(retained.contextAssembly.selectedChars, expectedSelectedChars, "retained units remain part of the selected context contract");
  assert.deepEqual(retained.contextAssembly.retained.map((unit) => unit.id).sort(), retainedContextObligations.map((unit) => unit.id).sort(), "Bridge must expose exactly the obligations MSSR accepted as retained");
  assert.deepEqual(loadedNames(retained).sort(), expectedSkillNames, "retained guidance must keep selected skills lifecycle-satisfied without reserializing content");
  assert.ok(retained.loaded.every((item) => item.content === "" && item.contextAssembly.contextSatisfied === true), "fully retained skills must be satisfied with empty re-delivered content");

  const historicalOnly = await bootstrap({ ...bootstrapInput, traceId: retained.traceId, skillDecisions, maxContextChars: 50_000, maxEnvelopeChars: 60_000 });
  assertComplete(historicalOnly, "historical trace without receipts");
  assert.equal(historicalOnly.contextAssembly.deliveredChars, expectedSelectedChars, "historical skill_load state alone must never prove current-context retention");
  assert.equal(historicalOnly.contextAssembly.retainedContextCharsSaved, 0, "omitting receipts after compaction/restart/handoff must fail open to re-delivery");

  const mismatchedReceipts = retainedContextObligations.map((receipt, index) => index === 0
    ? { ...receipt, fingerprint: `${receipt.fingerprint.slice(0, -1)}${receipt.fingerprint.endsWith("A") ? "B" : "A"}` }
    : receipt);
  const mismatch = await bootstrap({ ...bootstrapInput, skillDecisions, maxContextChars: 50_000, maxEnvelopeChars: 60_000, retainedContextObligations: mismatchedReceipts });
  assertComplete(mismatch, "fingerprint mismatch response");
  assert.ok(mismatch.contextAssembly.deliveredChars > 0 && mismatch.contextAssembly.deliveredChars < expectedSelectedChars, "a changed fingerprint must re-deliver only the unmet unit while preserving exact matches");
  assert.equal(mismatch.contextAssembly.retainedContextCharsSaved + mismatch.contextAssembly.deliveredChars, expectedSelectedChars, "mismatch accounting must partition retained and re-delivered selected bytes exactly");

  const partialRetainedReceipts = retainedContextObligations.slice(0, 2);
  const retainedPartial = await bootstrap({ ...bootstrapInput, skillDecisions, maxContextChars: 7_000, maxEnvelopeChars: 30_000, retainedContextObligations: partialRetainedReceipts });
  assertPartial(retainedPartial, "retained partial response");
  assert.equal(retainedPartial.contextAssembly.retained.length, partialRetainedReceipts.length, "partial chains must bind caller receipts into the first page");
  const retainedContinuation = await next({ traceId: retainedPartial.traceId, cursor: retainedPartial.cursor });
  assertComplete(retainedContinuation, "retained continuation response");
  assert.deepEqual(retainedContinuation.contextAssembly.retained.map((unit) => unit.id).sort(), partialRetainedReceipts.map((unit) => unit.id).sort(), "skill_context_next must preserve the original receipt set internally without caller resubmission");

  console.log(JSON.stringify({
    ok: true,
    expectedRequiredChars,
    expectedSelectedChars,
    budget,
    requiredUnits: deliveredRequiredUnitIds.length,
    firstDeliveredChars: first.contextAssembly.deliveredChars,
  }, null, 2));
} finally {
  closeMssrObservatoryForTests();
  closeMetricsForTests();
  closeCodexSkillDiscoveryForTests();
  await fs.promises.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
