import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-routing-coverage-"));
const metricsDir = path.join(sandbox, "metrics");
const logDir = path.join(sandbox, "logs");
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "mssr-events.jsonl");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, "bridge-metrics.sqlite");
process.env.BRIDGE_MCP_EVENTS_JSONL = path.join(logDir, "bridge-events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(sandbox, "metrics", "mssr-observability-state.json");

const metrics = await import("../dist/metrics.js");

function record(tool, profile) {
  const metric = metrics.beginToolMetric(tool, {}, profile);
  metrics.finishToolMetric(metric, true, 0);
  return metric;
}

try {
  const status = metrics.getMetricsStatus();
  assert.equal(status.sqlitePath, process.env.BRIDGE_MCP_METRICS_SQLITE, "fixture must not inherit a prior SQLite store");
  assert.equal(status.jsonlPath, process.env.BRIDGE_MCP_EVENTS_JSONL, "fixture must not inherit a prior JSONL store");
  const common = { caller: "chatgpt-web", sessionKey: "session-fixture", project: "fixture-project" };
  const routeTrace = "mssr-coverage-routed";

  const diagnostic = record("bridge_metrics_summary", { ...common, taskKey: "task-routed" });
  assert.equal(diagnostic.routingStatus, "exempt");
  assert.equal(diagnostic.mssrEligible, false);
  assert.equal(metrics.classifyMssrRoutingStatus("mssr_observatory_query"), "exempt");
  assert.equal(metrics.classifyMssrRoutingStatus("mssr_mssr_route_plan"), "bootstrap");

  const route = record("skill_bootstrap", { ...common, taskKey: "task-routed", traceId: routeTrace });
  const hook = record("mssr_trace_record", { ...common, taskKey: "task-routed", traceId: routeTrace });
  const routed = record("search_files", { ...common, taskKey: "task-routed", traceId: routeTrace });
  const unrouted = record("search_files", { ...common, taskKey: "task-unrouted" });

  assert.equal(route.routingStatus, "bootstrap");
  assert.equal(route.mssrEligible, false, "bootstrap is outside the substantive denominator");
  assert.equal(hook.routingStatus, "bootstrap");
  assert.equal(hook.mssrEligible, false, "trace hooks are not substantive work");
  assert.equal(routed.routingStatus, "traced");
  assert.equal(routed.mssrEligible, true);
  assert.equal(unrouted.routingStatus, "unrouted");
  assert.equal(unrouted.mssrEligible, true);

  const summary = metrics.getMetricsSummary(20, "active");
  const surface = summary.surfaces.find((row) => row.caller === "chatgpt-web");
  assert.equal(surface?.eligible_calls, 2, "only substantive calls form the coverage denominator");
  assert.equal(surface?.traced_calls, 1);
  assert.equal(surface?.untraced_calls, 1);
  assert.equal(surface?.exempt_calls, 1, "diagnostics stay observable but outside coverage");
  assert.equal(surface?.bootstrap_calls, 2, "route and lifecycle hook remain separately observable");
  assert.equal(surface?.substantive_chains, 2);
  assert.equal(surface?.routed_chains, 1);
  assert.equal(surface?.unrouted_chains, 1);
  assert.equal(surface?.chains_without_route_hook, 1, "a substantive chain without route/bootstrap/hook is explicit");
  assert.equal(surface?.mssr_routed_chain_coverage, 50);

  console.log("MSSR substantive routing coverage classification: PASS");
} finally {
  // node:sqlite keeps the module-scoped connection open until process exit on
  // Windows. The OS removes this isolated fixture directory after the process;
  // cleanup is best-effort so it cannot mask the coverage assertions.
  await fs.promises.rm(sandbox, { recursive: true, force: true }).catch(() => {});
}
