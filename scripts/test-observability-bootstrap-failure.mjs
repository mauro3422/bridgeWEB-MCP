import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-observability-bootstrap-failure-"));
const metricsDir = path.join(temp, "data");
const logDir = path.join(temp, "logs");
const sqlitePath = path.join(metricsDir, "metrics.sqlite");
const cachePath = path.join(metricsDir, "dashboard-snapshot-cache.json");
const seededAt = "2026-10-05T00:00:00.000Z";
const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(2_000) });

await fs.mkdir(path.join(metricsDir, "metrics.sqlite"), { recursive: true });
await fs.mkdir(logDir, { recursive: true });
await fs.writeFile(cachePath, JSON.stringify({
  schemaVersion: 1,
  savedAt: seededAt,
  buildMs: 123,
  value: {
    generatedAt: seededAt,
    status: { pid: -1 },
    overview: {}, summary: {}, recent: {}, errors: {}, timeline: {},
    mssr: {}, skillHealth: {}, projectHealth: {}, runtimeHealth: {}, toolAudit: {}, toolNotices: {}, cockpit: {},
  },
}), "utf8");

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
    BRIDGE_MCP_EVENTS_JSONL: path.join(logDir, "bridge-events.jsonl"),
    BRIDGE_MCP_MSSR_EVENTS_JSONL: path.join(logDir, "mssr-events.jsonl"),
    BRIDGE_MCP_MSSR_INGEST_TOKEN_FILE: path.join(temp, "mssr-ingest.token"),
    BRIDGE_MCP_DASHBOARD_SNAPSHOT_STATE: cachePath,
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(metricsDir, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(metricsDir, "project-health.json"),
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(metricsDir, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(metricsDir, "project-situation.json"),
  },
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let status;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(500) });
      if (response.ok || response.status === 503) status = await response.json();
      if (status?.observabilityStorage?.state === "failed") break;
    } catch {}
    if (child.exitCode !== null) break;
    await sleep(25);
  }
  assert.equal(status?.observabilityStorage?.state, "failed", `bootstrap failure was not reported: ${stderr}`);

  const [health, ready, failedStatus] = await Promise.all([
    timedFetch(`${base}/healthz`),
    timedFetch(`${base}/readyz`),
    timedFetch(`${base}/status`),
  ]);
  assert.equal(health.status, 200, "HTTP liveness must remain observable after a storage failure");
  assert.equal(ready.status, 503, "a persistent observability storage failure must revoke readiness");
  assert.equal(failedStatus.status, 503);
  const failedPayload = await failedStatus.json();
  assert.equal(failedPayload.ready, false);
  assert.equal(failedPayload.observabilityStorage?.state, "failed");

  const metrics = await timedFetch(`${base}/api/metrics/status`);
  assert.equal(metrics.status, 503, "metrics route must fail before querying an unavailable schema");

  const mcp = await timedFetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(mcp.status, 503, "MCP must not dispatch an operation whose completion metric would initialize a broken schema");
  const afterMcp = await (await timedFetch(`${base}/status`)).json();
  assert.equal(afterMcp.protocols.legacy.requests, 0);
  assert.equal(afterMcp.protocols.modern.requests, 0);

  const snapshot = await timedFetch(`${base}/api/dashboard/snapshot`);
  assert.equal(snapshot.status, 200, "last-good dashboard evidence must remain available during storage failure");
  const snapshotPayload = await snapshot.json();
  assert.equal(snapshotPayload.generatedAt, seededAt);
  assert.equal(snapshotPayload.cache?.hit, true);
  assert.equal(snapshotPayload.cache?.stale, true);
  assert.equal(snapshotPayload.status?.observabilityStorage?.state, "failed");

  console.log("observability bootstrap failure isolation PASS", {
    health: health.status,
    readiness: ready.status,
    metrics: metrics.status,
    mcp: mcp.status,
    dashboardSeed: snapshotPayload.generatedAt,
    pid: child.pid,
  });
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 2_000))) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  }
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

async function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null || process.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      process.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    process.once("exit", onExit);
  });
}
