import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-delegated-mssr-route-"));
const codexHome = path.join(sandbox, "codex");
const skillRoot = path.join(codexHome, "skills");
const metricsDir = path.join(sandbox, "metrics");
const logDir = path.join(sandbox, "logs");
const projectRoot = path.join(sandbox, "delegated-route-project");

process.env.CODEX_HOME = codexHome;
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, "mssr-observability-state.json");
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

for (const [name, description] of [
  ["mssr-agent-routing", "Route substantial work through MSSR and preserve trace continuity."],
  ["shared-skill-governance", "Govern reusable skill changes and verification."],
  ["skill-routing-maintainer", "Maintain MSSR routing metadata and fixtures."],
  ["skill-maintenance-loop", "Close routed work after the latest persistence and convert reusable friction into durable maintenance."],
  ["git-change-publication", "Verify and publish repository changes with explicit persistence evidence."],
  ["mauroprime-bridge-tool-authoring", "Author and verify Bridge MCP tools."],
  ["systematic-debugging", "Diagnose repeated failures and verify the smallest reversible fix."],
]) {
  const directory = path.join(skillRoot, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nFixture guidance.\n`,
    "utf8",
  );
}
fs.appendFileSync(
  path.join(skillRoot, "systematic-debugging", "SKILL.md"),
  `\n## Large optional fixture\n\n${"Optional diagnostic context. ".repeat(320)}\n`,
  "utf8",
);
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, "fixture.txt"), "delegated-route-fixture\n", "utf8");

const [{ Client }, { InMemoryTransport }, { createBridgeServer }, metrics, observatory, traceContext] = await Promise.all([
  import("@modelcontextprotocol/sdk/client/index.js"),
  import("@modelcontextprotocol/sdk/inMemory.js"),
  import("../dist/bridge-server.js"),
  import("../dist/metrics.js"),
  import("../dist/mssr-observatory.js"),
  import("../dist/mssr-trace-context.js"),
]);

function payload(result) {
  const text = result.content?.find((part) => part.type === "text")?.text;
  assert.equal(typeof text, "string", "Expected a text MCP result.");
  const parsed = JSON.parse(text);
  if (parsed?.error) throw new Error(parsed.error);
  return parsed;
}

traceContext.resetSharedMssrTraceRegistryForTests();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createBridgeServer();
const client = new Client({ name: "openai-mcp", version: "1.0.0" }, { capabilities: {} });
const sessionMode = process.env.BRIDGE_TEST_SESSION_MODE === "unknown" ? "unknown" : "named";
const requestMeta = sessionMode === "named"
  ? { "openai/session": "delegated-route-project-session" }
  : {};
const call = async (name, args = {}) => payload(await client.callTool({ name, arguments: args, _meta: requestMeta }));

const intent = {
  summary: "Verify delegated MSSR route scope propagation.",
  domains: ["skill-system", "filesystem"],
  actions: ["debug", "verify", "test", "document"],
  artifacts: ["project", "repository", "code", "mcp", "skill"],
  needs: ["unit-tests", "integrity-verification"],
  signals: ["error-observed", "repeated-friction", "reusable-pattern"],
  risk: "read-only",
  ambiguity: "low",
};

try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const planDelegatedRoute = async (task) => {
    const envelope = await call("bridge_tool_query", {
      toolName: "skill_route_plan",
      arguments: {
        task,
        context: "The route is intentionally invoked through bridge_tool_query because its dedicated schema is absent.",
        intent,
        caller: "chatgpt-web",
        stage: "start",
        sources: ["codex-local"],
        maxSkills: 12,
      },
    });
    assert.match(envelope.result.traceId, /^mssr-/);
    return envelope.result;
  };

  await call("project_context_load", {
    projectRoot,
    task: "Load the project that must own delegated MSSR routes.",
  });


  const staleTraceIds = [];
  for (let index = 0; index < 3; index += 1) {
    const stale = await planDelegatedRoute(`Historical interrupted delegated route ${index + 1}.`);
    staleTraceIds.push(stale.traceId);
  }

  metrics.closeMetricsForTests();
  observatory.closeMssrObservatoryForTests();
  const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const database = new DatabaseSync(path.join(metricsDir, "bridge-metrics.sqlite"));
  const ageTrace = database.prepare("UPDATE mssr_events SET occurred_at = ? WHERE trace_id = ?");
  for (const traceId of staleTraceIds) ageTrace.run(staleAt, traceId);
  database.close();
  traceContext.resetSharedMssrTraceRegistryForTests();

  await call("project_context_load", {
    projectRoot,
    task: "Load the project again before the fresh delegated MSSR route.",
  });
  const freshTask = "Verify delegated MSSR route project scope is preserved.";
  const route = await planDelegatedRoute(freshTask);

  traceContext.resetSharedMssrTraceRegistryForTests();

  const search = await call("search_files", {
    path: projectRoot,
    pattern: "delegated-route-fixture",
    maxResults: 5,
  });
  assert.equal(
    search.bridgeNotices?.items?.some((notice) => notice.code === "mssr-unrouted-tool-call") ?? false,
    false,
    "A project tool after a delegated route must not be reported as unrouted.",
  );

  const expectedSessionKey = sessionMode === "named"
    ? `session-${createHash("sha256").update("delegated-route-project-session").digest("hex").slice(0, 16)}`
    : "unknown";
  const recent = metrics.getRecentMetrics(50, "active").recent;
  const routeMetric = recent.find((row) => row.tool === "bridge_tool_query");
  const searchMetric = recent.find((row) => row.tool === "search_files");
  assert.equal(routeMetric?.trace_id, route.traceId, "Delegated route metric must receive the emitted trace id.");
  assert.equal(routeMetric?.project, "delegated-route-project");
  assert.equal(routeMetric?.session_key, expectedSessionKey);
  assert.equal(searchMetric?.trace_id, route.traceId, "The next project tool must inherit the delegated route trace.");
  assert.equal(searchMetric?.project, "delegated-route-project");
  assert.equal(searchMetric?.routing_status, "traced");

  const required = route.activeSkills.filter((skill) => skill.required);
  const bootstrapEnvelope = await call("bridge_tool_query", {
    toolName: "skill_bootstrap",
    arguments: {
      task: freshTask,
      context: "Apply the delegated route and load every active-phase skill on the same trace.",
      intent,
      caller: "chatgpt-web",
      stage: "start",
      sources: ["codex-local"],
      maxSkills: 12,
      maxContextChars: 6_000,
      traceId: route.traceId,
    },
  });
  const bootstrap = bootstrapEnvelope.result;
  assert.equal(bootstrap.traceId, route.traceId, "Delegated bootstrap must preserve the delegated route trace.");
  assert.equal(bootstrap.contextAssembly?.mode, "selective", "Delegated bootstrap must use selective context by default.");
  assert.equal(bootstrap.contextAssembly?.planningMode, "global-required-core-first");
  assert.equal(typeof bootstrap.contextAssembly?.totalContextCharsLoaded, "number");
  assert.equal(typeof bootstrap.contextAssembly?.estimatedCharsSaved, "number");
  assert.equal(typeof bootstrap.contextAssembly?.requiredCoreReservedChars, "number");
  assert.equal(Array.isArray(bootstrap.contextAssembly?.globallySelectedModules), true);
  assert.equal(Array.isArray(bootstrap.contextAssembly?.skills), true);
  const requiredAssembly = bootstrap.contextAssembly.skills.filter((item) => item.required === true);
  assert.equal(requiredAssembly.every((item) => item.skipped !== true && item.coreCharsLoaded > 0), true, "Every required skill core must be reserved before optional context.");
  assert.equal(
    bootstrap.contextAssembly.requiredCoreReservedChars,
    requiredAssembly.reduce((sum, item) => sum + item.coreCharsLoaded, 0),
  );
  assert.equal(
    bootstrap.contextAssembly.totalContextCharsLoaded,
    bootstrap.contextAssembly.skills.reduce((sum, item) => sum + item.totalCharsLoaded, 0),
  );
  const skippedForBudget = bootstrap.contextAssembly.skills.filter((item) => item.skippedReason === "optional-context-exceeds-budget");
  assert.equal(skippedForBudget.length > 0, true, "A constrained bootstrap must exercise the optional context skip path.");
  assert.equal(skippedForBudget.every((item) => item.required === false && item.totalCharsLoaded === 0), true);
  const loadedNames = new Set(
    bootstrap.loaded
      .filter((item) => item.loaded === true)
      .map((item) => item.skill?.name)
      .filter(Boolean),
  );
  for (const skill of required) {
    assert.equal(loadedNames.has(skill.name), true, `Delegated bootstrap must report required skill ${skill.name} as loaded.`);
  }

  const observatorySummary = await call("mssr_observatory_query", { kind: "summary", days: 1, scope: "active" });
  assert.equal(observatorySummary.contextAssembly?.loadEvents > 0, true, "Context assembly summary must include bootstrap load telemetry.");
  assert.equal(Array.isArray(observatorySummary.contextAssembly?.skillPressure), true);
  assert.equal(
    observatorySummary.contextAssembly.planningModes.some((item) => item.name === "global-required-core-first"),
    true,
    "Context assembly summary must expose the global planner mode.",
  );
  assert.equal(Array.isArray(observatorySummary.contextAssembly?.recentTraces), true);

  const verifyIntent = {
    ...intent,
    domains: [...intent.domains, "git"],
    actions: [...intent.actions, "publish"],
    needs: [...intent.needs, "version-control"],
  };
  const verifyEnvelope = await call("bridge_tool_query", {
    toolName: "skill_bootstrap",
    arguments: {
      task: freshTask,
      context: "Advance the same delegated trace to verification and load every newly required skill before evaluating the boundary.",
      intent: verifyIntent,
      caller: "chatgpt-web",
      stage: "verify",
      completedPhases: ["discovery", "safety", "implementation"],
      sources: ["codex-local"],
      maxSkills: 12,
      traceId: route.traceId,
    },
  });
  assert.equal(verifyEnvelope.result.traceId, route.traceId);
  assert.equal(
    verifyEnvelope.bridgeNotices?.items?.some((notice) => notice.code === "mssr-required-skill-not-loaded") ?? false,
    false,
    "A verification-stage bootstrap must attribute its own loads before evaluating the required-skill boundary.",
  );

  await call("mssr_trace_record", {
    traceId: route.traceId,
    eventType: "verification",
    caller: "chatgpt-web",
    stage: "verify",
    status: "success",
    verificationPassed: true,
    evidenceKind: "tests",
    summary: "Delegated verification checkpoint completed.",
  });
  await call("mssr_trace_record", {
    traceId: route.traceId,
    eventType: "persistence",
    caller: "chatgpt-web",
    stage: "persist",
    status: "success",
    persisted: true,
    evidenceKind: "tests",
    summary: "Delegated fixture persistence checkpoint completed.",
  });
  const closeEnvelope = await call("bridge_tool_query", {
    toolName: "skill_bootstrap",
    arguments: {
      task: freshTask,
      context: "Verification and persistence completed; close the same delegated trace and run required maintenance on the latest state.",
      intent: { ...verifyIntent, actions: [...verifyIntent.actions, "maintain"] },
      caller: "chatgpt-web",
      stage: "close",
      completedPhases: ["discovery", "safety", "implementation", "verification", "persistence"],
      sources: ["codex-local"],
      maxSkills: 12,
      traceId: route.traceId,
    },
  });
  assert.equal(closeEnvelope.result.traceId, route.traceId);
  await call("mssr_trace_record", {
    traceId: route.traceId,
    eventType: "phase_completed",
    caller: "chatgpt-web",
    stage: "close",
    status: "success",
    completedPhases: ["discovery", "safety", "implementation", "verification", "persistence", "maintenance"],
    primarySkill: closeEnvelope.result.activeSkills.find((skill) => skill.required)?.name ?? route.activeSkills[0]?.name,
    verificationPassed: true,
    persisted: true,
    evidenceKind: "tests",
    summary: "Delegated close-stage maintenance completed after the latest persistence.",
  });

  const outcome = await call("mssr_trace_record", {
    traceId: route.traceId,
    eventType: "outcome",
    caller: "chatgpt-web",
    stage: "close",
    primarySkill: route.activeSkills[0]?.name,
    supportingSkills: route.activeSkills.slice(1).map((skill) => skill.name),
    metricName: "delegated-route-project-scope",
    status: "success",
    accepted: true,
    score: 1,
    evidenceKind: "tests",
    verificationPassed: true,
    persisted: true,
    summary: "Delegated route preserved project, session and trace through the next project tool.",
  });
  assert.equal(outcome.traceId, route.traceId);
  const concurrentTraceA = await planDelegatedRoute("Concurrent stateless dispatch trace A.");
  const concurrentTraceB = await planDelegatedRoute("Concurrent stateless dispatch trace B.");
  assert.notEqual(concurrentTraceA.traceId, concurrentTraceB.traceId);
  traceContext.resetSharedMssrTraceRegistryForTests();
  const explicitlyScopedDispatch = await call("bridge_tool_query", {
    toolName: "search_files",
    traceId: concurrentTraceA.traceId,
    arguments: {
      path: projectRoot,
      pattern: "delegated-route-fixture",
      maxResults: 5,
    },
  });
  assert.equal(
    explicitlyScopedDispatch.bridgeNotices?.items?.some((notice) => notice.code === "mssr-unrouted-tool-call" || notice.code === "mssr-trace-ambiguous") ?? false,
    false,
    "An explicit wrapper traceId must disambiguate a generic delegated target without forwarding traceId into its schema.",
  );
  const explicitDispatchMetric = metrics.getRecentMetrics(20, "active").recent.find((row) =>
    row.tool === "bridge_tool_query" && row.operation_subject === "search_files");
  assert.equal(explicitDispatchMetric?.trace_id, concurrentTraceA.traceId);

  traceContext.resetSharedMssrTraceRegistryForTests();
  const legacyScopedDispatch = await call("bridge_tool_query", {
    toolName: "search_files",
    arguments: {
      path: projectRoot,
      pattern: "delegated-route-fixture",
      maxResults: 5,
      traceId: concurrentTraceB.traceId,
    },
  });
  assert.equal(
    legacyScopedDispatch.bridgeNotices?.items?.some((notice) => notice.code === "mssr-unrouted-tool-call" || notice.code === "mssr-trace-ambiguous") ?? false,
    false,
    "A legacy nested traceId must disambiguate a delegated target and must be removed before validating a trace-unaware target schema.",
  );
  const legacyDispatchMetric = metrics.getRecentMetrics(20, "active").recent.find((row) =>
    row.tool === "bridge_tool_query" && row.operation_subject === "search_files" && row.trace_id === concurrentTraceB.traceId);
  assert.equal(legacyDispatchMetric?.trace_id, concurrentTraceB.traceId);


  const carryoverWorkflowKey = "project-root-carryover-regression";
  await call("project_context_load", {
    projectRoot,
    task: "Reload the project before verifying direct bootstrap project-root carryover.",
    workflowKey: carryoverWorkflowKey,
  });
  const carryoverArgs = {
    task: "Verify direct bootstrap inherits the uniquely loaded project root.",
    intent,
    caller: "chatgpt-web",
    stage: "start",
    sources: ["codex-local"],
    maxSkills: 12,
    maxContextChars: 6_000,
    workflowKey: carryoverWorkflowKey,
  };
  let inheritedBootstrap;
  if (sessionMode === "named") {
    const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();
    const secondServer = createBridgeServer();
    const secondClient = new Client({ name: "openai-mcp", version: "1.0.0" }, { capabilities: {} });
    try {
      await Promise.all([secondServer.connect(secondServerTransport), secondClient.connect(secondClientTransport)]);
      const secondCall = async (name, args = {}) => payload(await secondClient.callTool({ name, arguments: args, _meta: requestMeta }));
      inheritedBootstrap = await secondCall("skill_bootstrap", carryoverArgs);
    } finally {
      await secondClient.close().catch(() => {});
      await secondServer.close().catch(() => {});
    }
  } else {
    inheritedBootstrap = await call("skill_bootstrap", carryoverArgs);
  }
  assert.equal(
    inheritedBootstrap.projectRoot,
    path.resolve(projectRoot),
    "A direct bootstrap without projectRoot must inherit the root loaded by project_context_load even when the next call reaches another server instance in the same named host session.",
  );

  console.log(JSON.stringify({
    ok: true,
    traceId: route.traceId,
    project: searchMetric?.project,
    sessionKey: searchMetric?.session_key,
    routingStatus: searchMetric?.routing_status,
  }, null, 2));
} finally {
  await client.close().catch(() => {});
  await server.close().catch(() => {});
  traceContext.resetSharedMssrTraceRegistryForTests();
  metrics.closeMetricsForTests();
  observatory.closeMssrObservatoryForTests();
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

if (sessionMode === "named") {
  const anonymous = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(),
    env: { ...process.env, BRIDGE_TEST_SESSION_MODE: "unknown" },
    encoding: "utf8",
  });
  assert.equal(
    anonymous.status,
    0,
    `Anonymous-session delegated route regression failed.\n${anonymous.stderr || anonymous.stdout}`,
  );
  process.stdout.write(anonymous.stdout);
}
