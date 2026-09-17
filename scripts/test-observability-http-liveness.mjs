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

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
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
  },
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(500) });
      if (response.ok && await response.text() === "ready") return;
    } catch {}
    if (child.exitCode !== null) break;
    await sleep(50);
  }
  assert.fail(`isolated Bridge did not become ready: ${stderr}`);
}

async function json(pathname) {
  const response = await fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(1_000) });
  assert.equal(response.ok, true, `${pathname} returned ${response.status}`);
  return response.json();
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
  const baseline = await json("/status");
  assert.equal(typeof baseline.runtimeBootId, "string");
  await json("/api/metrics/status");
  await json("/api/mssr/summary?scope=all");
  const token = (await fs.readFile(tokenPath, "utf8")).trim();
  assert.ok(token.length > 0, "MSSR ingest token missing");

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
  await fs.rm(temp, { recursive: true, force: true });
}
