import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-observability-liveness-"));
const metricsDir = path.join(temp, "data");
const logDir = path.join(temp, "logs");
const sqlitePath = path.join(metricsDir, "metrics.sqlite");
const tokenPath = path.join(temp, "mssr-ingest.token");
const snapshotPath = path.join(metricsDir, "dashboard-snapshot-cache.json");
await fs.mkdir(metricsDir, { recursive: true });
await fs.writeFile(snapshotPath, JSON.stringify({
  schemaVersion: 1,
  savedAt: new Date().toISOString(),
  buildMs: 1,
  value: { restoredFixture: true, mssr: { restoredFixture: true } },
}));

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const serverSpawnedAt = performance.now();
const child = spawn(process.execPath, [path.join(root, "dist", "http.js")], {
  cwd: root,
  stdio: ["ignore", "ignore", "pipe"],
  env: {
    ...process.env,
    BRIDGE_MCP_HTTP_PORT: String(port),
    BRIDGE_MCP_HTTP_HOST: "127.0.0.1",
    BRIDGE_MCP_METRICS_DIR: metricsDir,
    BRIDGE_MCP_LOG_DIR: logDir,
    BRIDGE_MCP_METRICS_SQLITE: sqlitePath,
    BRIDGE_MCP_DASHBOARD_SNAPSHOT_STATE: snapshotPath,
    BRIDGE_MCP_MSSR_EVENTS_JSONL: path.join(logDir, "mssr-events.jsonl"),
    BRIDGE_MCP_MSSR_INGEST_TOKEN_FILE: tokenPath,
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(metricsDir, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(metricsDir, "project-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_ROOT: root,
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(metricsDir, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(metricsDir, "project-situation.json"),
    BRIDGE_MCP_PROJECT_SITUATION_ROOT: root,
    BRIDGE_MCP_METRICS_WAL_CHECKPOINT_DELAY_MS: "200",
    BRIDGE_MCP_METRICS_WAL_CHECKPOINT_BUSY_MS: "25",
    BRIDGE_MCP_TEST_OBSERVABILITY_STORAGE_INIT_DELAY_MS: "10000",
  },
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady() {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(500) });
      if (response.ok && await response.text() === "ready") return;
    } catch {}
    if (child.exitCode !== null) break;
    await sleep(50);
  }
  const childState = child.exitCode === null
    ? `still running (pid ${child.pid})`
    : `exited with code ${child.exitCode} and signal ${child.signalCode ?? "none"}`;
  assert.fail(`isolated Bridge did not become ready; child ${childState}: ${stderr}`);
}

async function json(pathname, timeoutMs = 1_000) {
  const response = await fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  assert.equal(response.ok, true, `${pathname} returned ${response.status}: ${body.slice(0, 1_000)}`);
  return JSON.parse(body);
}

const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "bridge-liveness-synthetic-agent", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function modernToolCall(id, name, arguments_) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: arguments_, _meta: modernMeta },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${name} returned ${response.status}: ${text.slice(0, 800)}`);
  const payload = JSON.parse(text);
  assert.equal(payload.error, undefined, `${name} returned JSON-RPC error: ${text.slice(0, 800)}`);
  assert.notEqual(payload.result?.isError, true, `${name} returned MCP tool error: ${text.slice(0, 800)}`);
  return payload.result;
}

async function probeReady(durationMs) {
  const samples = [];
  const failures = [];
  const deadline = performance.now() + durationMs;
  while (performance.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(750) });
      const body = await response.text();
      const elapsedMs = performance.now() - started;
      samples.push(elapsedMs);
      if (!response.ok || body !== "ready") failures.push({ status: response.status, body, elapsedMs });
    } catch (error) {
      failures.push({ error: error instanceof Error ? error.message : String(error), elapsedMs: performance.now() - started });
    }
    await sleep(10);
  }
  return { samples, failures };
}

function routeEnvelope(traceId, index) {
  return {
    protocolVersion: "mssr-telemetry-v1",
    eventId: `mssr-liveness-${Date.now()}-${index}`,
    emittedAt: new Date().toISOString(),
    source: "opencode-cli",
    traceId,
    caller: "opencode-local",
    event: {
      kind: "route",
      action: "plan",
      taskHash: "a".repeat(64),
      route: {
        caller: "opencode-local",
        stage: "verify",
        classificationMode: "structured-semantic",
        workflowKey: "observability-http-liveness",
        agentProfile: { model: "fixture-model", reasoningEffort: "high" },
        contextUsed: false,
        contextCharacters: 0,
        workflows: [],
        activeSkills: [],
        deferredSkills: [],
        loadOrder: [],
        deferredLoadOrder: [],
        intent: {
          domains: ["coding", "agent-orchestration"],
          actions: ["verify", "test"],
          artifacts: ["mcp", "code"],
          needs: ["performance", "integrity-verification"],
          signals: ["repeated-friction"],
          risk: "read-only",
          ambiguity: "low",
        },
        signals: ["repeated-friction"],
        ambiguity: "low",
        requiredPhases: [],
        completedPhases: [],
        missingRequiredPhases: [],
      },
    },
  };
}

let lockDb;
try {
  await waitReady();
  const readyStartupMs = performance.now() - serverSpawnedAt;
  assert.ok(readyStartupMs < 5_000, `HTTP readiness waited for delayed observability initialization: ${readyStartupMs.toFixed(2)} ms`);
  const token = (await fs.readFile(tokenPath, "utf8")).trim();
  assert.ok(token.length > 0, "MSSR ingest token missing");

  // Health, readiness, status, and the dashboard shell stay responsive while
  // schema initialization is deliberately delayed. Every main-process SQLite
  // reader/writer must wait for the same bootstrap promise; exercise them
  // concurrently before the cold dashboard can finish initialization.
  const livenessProbePromise = probeReady(2_000);
  const livenessStartedAt = performance.now();
  const immediateResponses = await Promise.all([
    fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1_000) }),
    fetch(`${base}/status`, { signal: AbortSignal.timeout(1_000) }),
    fetch(`${base}/dashboard`, { signal: AbortSignal.timeout(1_000) }),
  ]);
  const immediateLivenessMs = performance.now() - livenessStartedAt;
  for (const response of immediateResponses) {
    assert.equal(response.status, 200, `unblocked liveness route returned ${response.status}`);
    await response.arrayBuffer();
  }
  assert.ok(immediateLivenessMs < 1_000, `health/status/dashboard shell waited for storage bootstrap: ${immediateLivenessMs.toFixed(2)} ms`);

  const bootstrapTraceId = `mssr-bootstrap-gate-${Date.now()}`;
  const coldStorageRequests = [
    { name: "metrics status", run: () => json("/api/metrics/status", 15_000) },
    { name: "metrics overview", run: () => json("/api/metrics/overview", 15_000) },
    { name: "metrics summary", run: () => json("/api/metrics/summary", 15_000) },
    { name: "metrics recent", run: () => json("/api/metrics/recent", 15_000) },
    { name: "metrics errors", run: () => json("/api/metrics/errors", 15_000) },
    { name: "metrics timeline", run: () => json("/api/metrics/timeline", 15_000) },
    { name: "MSSR summary", run: () => json("/api/mssr/summary?scope=all", 15_000) },
    { name: "tool audit", run: () => json("/api/tools/audit", 15_000) },
    {
      name: "authenticated telemetry ingest",
      run: async () => {
        const response = await fetch(`${base}/api/mssr/events`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(routeEnvelope(bootstrapTraceId, 0)),
          signal: AbortSignal.timeout(15_000),
        });
        const body = await response.text();
        assert.equal(response.status, 202, `bootstrap telemetry ingest returned ${response.status}: ${body.slice(0, 800)}`);
        return JSON.parse(body);
      },
    },
    { name: "MCP metrics tool", run: () => modernToolCall(1, "bridge_metrics_status", {}) },
    { name: "cold dashboard snapshot", run: () => json("/api/dashboard/snapshot", 15_000) },
  ].map(async ({ name, run }) => {
    const startedAt = performance.now();
    const value = await run();
    return { name, elapsedMs: performance.now() - startedAt, value };
  });
  const coldStorageResults = await Promise.all(coldStorageRequests);
  const livenessProbe = await livenessProbePromise;
  assert.deepEqual(livenessProbe.failures, [], `readyz failed while storage requests waited: ${JSON.stringify(livenessProbe.failures)}`);
  assert.ok(livenessProbe.samples.length >= 20, `expected repeated bootstrap readyz samples, got ${livenessProbe.samples.length}`);
  for (const result of coldStorageResults) {
    if (result.name === "cold dashboard snapshot") continue;
    assert.ok(result.elapsedMs >= 1_000, `${result.name} bypassed the delayed SQLite bootstrap (${result.elapsedMs.toFixed(2)} ms)`);
  }
  const coldDashboard = coldStorageResults.find(({ name }) => name === "cold dashboard snapshot").value;
  const coldDashboardMs = coldStorageResults.find(({ name }) => name === "cold dashboard snapshot").elapsedMs;
  assert.ok(coldDashboard.mssr && typeof coldDashboard.mssr === "object", "cold dashboard snapshot omitted MSSR summary");
  assert.equal(coldDashboard.cache?.stale, true, "restored dashboard cache should be served stale during storage bootstrap");
  assert.equal(coldDashboard.cache?.refreshing, true, "restored dashboard cache should refresh in the background");
  assert.ok(coldDashboardMs < 1_000, `restored dashboard cache waited for storage bootstrap: ${coldDashboardMs.toFixed(2)} ms`);
  const baseline = await json("/status");
  assert.equal(typeof baseline.runtimeBootId, "string");
  assert.equal(baseline.observabilityStorage?.state, "ready", "observability storage was not ready after bootstrap-gated requests completed");
  assert.equal(baseline.dashboardWorkers?.read?.ready, true, "read worker should acknowledge readiness after first dashboard read");
  assert.equal(baseline.dashboardWorkers?.read?.pendingCount, 0, "read worker should not retain completed bootstrap requests");
  assert.equal(baseline.dashboardWorkers?.snapshot?.ready, true, "snapshot worker should acknowledge readiness after cold snapshot");
  let snapshotWorker = baseline.dashboardWorkers.snapshot;
  const snapshotIdleDeadline = performance.now() + 30_000;
  while (snapshotWorker.pendingCount > 0 && performance.now() < snapshotIdleDeadline) {
    assert.ok(snapshotWorker.pendingCount <= 1, "only the expected background snapshot refresh may remain pending");
    assert.ok(snapshotWorker.pending.every((request) => request.requestType === "snapshot"), "only snapshot refresh work may remain pending");
    await sleep(100);
    snapshotWorker = (await json("/status")).dashboardWorkers.snapshot;
  }
  assert.equal(snapshotWorker.pendingCount, 0, `background snapshot refresh should drain within 30 seconds; pending=${JSON.stringify(snapshotWorker.pending)}`);

  // MSSR summary can decode and fold a large retained window. It must run in
  // the isolated dashboard process so this work cannot stall HTTP readiness.
  const seedDb = new DatabaseSync(sqlitePath);
  const seedEvent = seedDb.prepare(`
    INSERT INTO mssr_events (
      id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
      skill_name, required, ok, task_hash, details_json, server_name,
      server_version, pid, hostname, platform
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seedAt = new Date().toISOString();
  seedDb.exec("BEGIN IMMEDIATE;");
  for (let index = 0; index < 30_000; index += 1) {
    seedEvent.run(
      `liveness-seed-${index}`, seedAt, `liveness-seed-trace-${index}`,
      "synthetic_liveness_seed", "other", null, null, null, null, null, null,
      "{}", "bridge-test", "0.0.0-test", 1, "localhost", process.platform,
    );
  }
  seedDb.exec("COMMIT;");

  const summaryProbePromise = probeReady(2_000);
  const summaryStartedAt = performance.now();
  const largeMssrSummary = await json("/api/mssr/summary?scope=all&days=30", 15_000);
  const summaryElapsedMs = performance.now() - summaryStartedAt;
  const summaryProbe = await summaryProbePromise;
  assert.equal(largeMssrSummary.scope, "all", "isolated MSSR summary lost the requested scope");
  assert.equal(largeMssrSummary.days, 30, "isolated MSSR summary lost the requested window");
  assert.deepEqual(summaryProbe.failures, [], `readyz stalled while MSSR summary processed a large window: ${JSON.stringify(summaryProbe.failures)}`);
  assert.ok(summaryProbe.samples.length >= 20, `expected repeated readyz samples during MSSR summary, got ${summaryProbe.samples.length}`);
  assert.ok(Math.max(...summaryProbe.samples) < 750, `readyz latency exceeded the MSSR summary isolation budget: ${Math.max(...summaryProbe.samples).toFixed(2)} ms`);
  console.log("MSSR summary isolated from HTTP event loop PASS", {
    seedEvents: 30_000,
    summaryElapsedMs: Math.round(summaryElapsedMs * 100) / 100,
    readySamples: summaryProbe.samples.length,
    maxReadyMs: Math.round(Math.max(...summaryProbe.samples) * 100) / 100,
  });

  const seedToolCall = seedDb.prepare(`
    INSERT INTO tool_calls (
      id, started_at, ended_at, duration_ms, tool, ok, output_chars,
      server_name, server_version, pid, hostname, platform, cwd,
      session_key, project, result_ok
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  seedDb.exec("BEGIN IMMEDIATE;");
  for (let index = 0; index < 30_000; index += 1) {
    seedToolCall.run(
      `liveness-audit-seed-${index}`, seedAt, seedAt, 1, "liveness_seed_tool", 1, 0,
      "bridge-test", "0.0.0-test", 1, "localhost", process.platform, root,
      `liveness-session-${index % 8}`, `liveness-project-${index % 3}`, 1,
    );
  }
  seedDb.exec("COMMIT;");
  seedDb.close();

  const auditProbePromise = probeReady(2_000);
  const auditStartedAt = performance.now();
  const largeToolAudit = await json("/api/tools/audit?view=all&scope=all&days=30&limit=200", 15_000);
  const auditElapsedMs = performance.now() - auditStartedAt;
  const auditProbe = await auditProbePromise;
  assert.equal(largeToolAudit.scope, "all", "isolated tool audit lost the requested scope");
  assert.equal(largeToolAudit.summary?.registeredTools, 188, "isolated tool audit lost the registered catalog");
  assert.deepEqual(auditProbe.failures, [], `readyz stalled while tool audit aggregated a large window: ${JSON.stringify(auditProbe.failures)}`);
  assert.ok(auditProbe.samples.length >= 20, `expected repeated readyz samples during tool audit, got ${auditProbe.samples.length}`);
  assert.ok(Math.max(...auditProbe.samples) < 750, `readyz latency exceeded the tool-audit isolation budget: ${Math.max(...auditProbe.samples).toFixed(2)} ms`);
  console.log("tool audit isolated from HTTP event loop PASS", {
    seedCalls: 30_000,
    auditElapsedMs: Math.round(auditElapsedMs * 100) / 100,
    readySamples: auditProbe.samples.length,
    maxReadyMs: Math.round(Math.max(...auditProbe.samples) * 100) / 100,
  });

  // Metrics aggregates also read and group the retained tool-call history.
  // Keep them off the HTTP event loop while exercising the full retained set.
  const metricsProbePromise = probeReady(3_000);
  const metricsStartedAt = performance.now();
  const metricsReads = await Promise.all([
    json("/api/dashboard/snapshot", 15_000),
    json("/api/mssr/summary?scope=all&days=30", 15_000),
    json("/api/metrics/overview?scope=all", 15_000),
    json("/api/metrics/summary?scope=all&limit=200", 15_000),
    json("/api/metrics/recent?scope=all&limit=200", 15_000),
    json("/api/metrics/errors?scope=all&limit=200", 15_000),
    json("/api/metrics/timeline?scope=all&limit=2000", 15_000),
  ]);
  const metricsElapsedMs = performance.now() - metricsStartedAt;
  const metricsProbe = await metricsProbePromise;
  const [concurrentDashboardSnapshot, concurrentMssrSummary, largeOverview, largeMetricsSummary, largeRecent, largeErrors, largeTimeline] = metricsReads;
  assert.ok(concurrentDashboardSnapshot.mssr && typeof concurrentDashboardSnapshot.mssr === "object", "concurrent dashboard snapshot omitted MSSR summary");
  assert.equal(concurrentMssrSummary.scope, "all", "concurrent MSSR summary lost the requested scope");
  assert.equal(largeOverview.scope, "all", "metrics overview lost the requested scope");
  assert.ok(largeOverview.totals?.calls >= 30_000, "metrics overview omitted the retained tool-call workload");
  assert.equal(largeMetricsSummary.scope, "all", "metrics summary lost the requested scope");
  assert.equal(largeRecent.scope, "all", "recent metrics lost the requested scope");
  assert.equal(largeErrors.scope, "all", "metrics errors lost the requested scope");
  assert.equal(largeTimeline.scope, "all", "metrics timeline lost the requested scope");
  for (const result of metricsReads.slice(2)) {
    assert.equal(result.runtime?.pid, baseline.pid, "worker metrics response must preserve the HTTP runtime identity");
  }
  assert.deepEqual(metricsProbe.failures, [], `readyz stalled while metrics reads aggregated retained calls: ${JSON.stringify(metricsProbe.failures)}`);
  assert.ok(metricsProbe.samples.length >= 20, `expected repeated readyz samples during metrics reads, got ${metricsProbe.samples.length}`);
  assert.ok(Math.max(...metricsProbe.samples) < 750, `readyz latency exceeded metrics aggregation isolation budget: ${Math.max(...metricsProbe.samples).toFixed(2)} ms`);
  console.log("dashboard snapshot isolated from concurrent read APIs PASS", {
    seedCalls: 30_000,
    elapsedMs: Math.round(metricsElapsedMs * 100) / 100,
    readySamples: metricsProbe.samples.length,
    maxReadyMs: Math.round(Math.max(...metricsProbe.samples) * 100) / 100,
  });

  lockDb = new DatabaseSync(sqlitePath);
  lockDb.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000;");
  lockDb.exec("BEGIN IMMEDIATE;");

  const traceId = `mssr-liveness-${Date.now()}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const probePromise = probeReady(2_000);
  const writes = Array.from({ length: 64 }, (_, index) => fetch(`${base}/api/mssr/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(routeEnvelope(traceId, index)),
    signal: AbortSignal.timeout(2_000),
  }));

  // Hold a real SQLite writer lock long enough to force the persistence worker
  // through busy/retry handling, but below its bounded retry window.
  await sleep(175);
  lockDb.exec("COMMIT;");
  lockDb.close();
  lockDb = undefined;

  const responses = await Promise.all(writes);
  for (const response of responses) assert.equal(response.status, 202, `ingest returned ${response.status}: ${await response.text()}`);
  const probes = await probePromise;
  assert.deepEqual(probes.failures, [], `readyz failures under SQLite pressure: ${JSON.stringify(probes.failures)}`);
  assert.ok(probes.samples.length >= 20, `expected repeated readyz samples, got ${probes.samples.length}`);
  const maxReadyMs = Math.max(...probes.samples);
  const sorted = [...probes.samples].sort((a, b) => a - b);
  const p95ReadyMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  assert.ok(maxReadyMs < 750, `readyz latency exceeded liveness budget: ${maxReadyMs.toFixed(2)} ms`);

  let persistenceStatus;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    persistenceStatus = await json("/api/metrics/status");
    if ((persistenceStatus.persistence?.pending ?? 0) === 0 && (persistenceStatus.walMaintenance?.checkpointCount ?? 0) >= 1) break;
    await sleep(50);
  }
  assert.equal(persistenceStatus.persistence?.pending, 0, "observability writer did not drain");
  assert.equal(persistenceStatus.persistence?.failed, 0, persistenceStatus.persistence?.lastError ?? "observability writer failed");
  assert.equal(persistenceStatus.persistence?.dropped, 0, "observability queue dropped writes");
  assert.ok((persistenceStatus.walMaintenance?.checkpointCount ?? 0) >= 1, "passive WAL checkpoint did not run");
  assert.equal(persistenceStatus.walMaintenance?.failureCount, 0, persistenceStatus.walMaintenance?.lastError ?? "WAL checkpoint failed");

  // Model several independent MCP callers without involving real LLMs. Mix
  // project-context discovery with skill bootstrap while probing /readyz from a
  // separate request stream. Slow tool completion is acceptable; starving the
  // shared HTTP event loop is not.
  const beforeConcurrentAgents = await json("/status");
  const concurrentProbePromise = probeReady(5_000);
  const concurrentIntent = {
    summary: "Synthetic concurrent Bridge liveness verification.",
    domains: ["coding", "agent-orchestration"],
    actions: ["verify", "test", "analyze"],
    artifacts: ["mcp", "project"],
    needs: ["performance", "integrity-verification", "cross-agent"],
    signals: ["repeated-friction"],
    risk: "read-only",
    ambiguity: "low",
  };
  const syntheticAgentCalls = Array.from({ length: 6 }, (_, index) => {
    if (index % 2 === 0) {
      return modernToolCall(1_000 + index, "project_context_load", {
        projectRoot: root,
        task: `Synthetic concurrent liveness context load ${index}`,
        workflowKey: "observability-http-liveness",
        includeAgents: true,
        includeProjectContext: true,
        includeGuides: true,
      });
    }
    return modernToolCall(1_000 + index, "skill_bootstrap", {
      task: `Synthetic concurrent liveness bootstrap ${index}`,
      projectRoot: root,
      context: "Isolated regression fixture verifying that concurrent read-only MSSR routing work does not starve Bridge readiness.",
      intent: concurrentIntent,
      caller: "chatgpt-web",
      model: "fixture-model",
      reasoningEffort: "high",
      stage: "verify",
      completedPhases: ["discovery", "safety"],
      sources: ["codex-local"],
      maxSkills: 4,
      contentMode: "selective",
      includeReferences: "auto",
      maxContextChars: 8_000,
      workflowKey: "observability-http-liveness",
    });
  });
  const syntheticAgentResults = await Promise.all(syntheticAgentCalls);
  assert.equal(syntheticAgentResults.length, 6);
  const concurrentProbes = await concurrentProbePromise;
  assert.deepEqual(concurrentProbes.failures, [], `readyz failures under concurrent MCP callers: ${JSON.stringify(concurrentProbes.failures)}`);
  assert.ok(concurrentProbes.samples.length >= 20, `expected repeated readyz samples under concurrent MCP callers, got ${concurrentProbes.samples.length}`);
  const maxConcurrentReadyMs = Math.max(...concurrentProbes.samples);
  const sortedConcurrent = [...concurrentProbes.samples].sort((a, b) => a - b);
  const p95ConcurrentReadyMs = sortedConcurrent[Math.min(sortedConcurrent.length - 1, Math.floor(sortedConcurrent.length * 0.95))];
  assert.ok(maxConcurrentReadyMs < 750, `readyz latency exceeded liveness budget under concurrent MCP callers: ${maxConcurrentReadyMs.toFixed(2)} ms`);

  const afterConcurrentAgents = await json("/status");
  assert.equal(afterConcurrentAgents.runtimeBootId, beforeConcurrentAgents.runtimeBootId, "runtime boot changed during concurrent MCP callers");
  assert.equal(afterConcurrentAgents.pid, beforeConcurrentAgents.pid, "HTTP process changed during concurrent MCP callers");
  assert.equal(
    afterConcurrentAgents.runtimeDiagnostics?.eventLoop?.stallCount,
    beforeConcurrentAgents.runtimeDiagnostics?.eventLoop?.stallCount,
    `event loop stalled during concurrent MCP callers: ${JSON.stringify(afterConcurrentAgents.runtimeDiagnostics?.eventLoop)}`,
  );

  const after = afterConcurrentAgents;
  assert.equal(after.runtimeBootId, baseline.runtimeBootId, "runtime boot changed during liveness regression");
  assert.equal(after.pid, baseline.pid, "HTTP process changed during liveness regression");
  assert.equal(child.exitCode, null, `isolated Bridge exited unexpectedly: ${stderr}`);

  console.log("Bridge observability HTTP liveness PASS", {
    writes: responses.length,
    readySamples: probes.samples.length,
    maxReadyMs: Math.round(maxReadyMs * 100) / 100,
    p95ReadyMs: Math.round(p95ReadyMs * 100) / 100,
    syntheticAgents: syntheticAgentResults.length,
    concurrentReadySamples: concurrentProbes.samples.length,
    maxConcurrentReadyMs: Math.round(maxConcurrentReadyMs * 100) / 100,
    p95ConcurrentReadyMs: Math.round(p95ConcurrentReadyMs * 100) / 100,
    eventLoopStalls: after.runtimeDiagnostics?.eventLoop?.stallCount,
    runtimeBootId: after.runtimeBootId,
    persistenceCompleted: persistenceStatus.persistence.completed,
    walCheckpoints: persistenceStatus.walMaintenance.checkpointCount,
    readyStartupMs: Math.round(readyStartupMs * 100) / 100,
    immediateLivenessMs: Math.round(immediateLivenessMs * 100) / 100,
    bootstrapGateWaitMs: Math.round(Math.max(...coldStorageResults.map(({ elapsedMs }) => elapsedMs)) * 100) / 100,
    coldDashboardMs: Math.round(coldDashboardMs * 100) / 100,
  });
} finally {
  if (lockDb) {
    try { lockDb.exec("ROLLBACK;"); } catch {}
    try { lockDb.close(); } catch {}
  }
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
