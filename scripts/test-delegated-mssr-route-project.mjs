import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  ["mauroprime-bridge-tool-authoring", "Author and verify Bridge MCP tools."],
]) {
  const directory = path.join(skillRoot, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nFixture guidance.\n`,
    "utf8",
  );
}
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
const requestMeta = { "openai/session": "delegated-route-project-session" };
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
  const route = await planDelegatedRoute("Verify delegated MSSR route project scope is preserved.");

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

  const expectedSessionKey = `session-${createHash("sha256").update("delegated-route-project-session").digest("hex").slice(0, 16)}`;
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
  for (const skill of required) {
    const loaded = await call("skill_load", {
      name: skill.name,
      source: "codex",
      traceId: route.traceId,
      required: true,
      stage: "close",
    });
    assert.equal(loaded.traceId, route.traceId);
  }

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
