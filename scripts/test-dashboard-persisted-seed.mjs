import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-dashboard-seed-"));
const metricsDir = path.join(temp, "data");
const logDir = path.join(temp, "logs");
const cachePath = path.join(metricsDir, "dashboard-snapshot-cache.json");
await fs.mkdir(metricsDir, { recursive: true });
await fs.mkdir(logDir, { recursive: true });
const seededAt = "2026-09-25T00:00:00.000Z";
await fs.writeFile(cachePath, JSON.stringify({
  schemaVersion: 1,
  savedAt: seededAt,
  buildMs: 4321,
  value: {
    generatedAt: seededAt,
    status: { pid: -1, ready: false },
    overview: { enabled: true, sqliteAvailable: true },
    summary: { summary: [], agentProfiles: [] },
    recent: { recent: [] },
    errors: { errors: [] },
    timeline: { timeline: [] },
    mssr: { enabled: true, sqliteAvailable: true, benchmark: {} },
    skillHealth: {}, projectHealth: {}, runtimeHealth: {}, toolAudit: {}, toolNotices: {}, cockpit: {},
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
    BRIDGE_MCP_METRICS_SQLITE: path.join(metricsDir, "metrics.sqlite"),
    BRIDGE_MCP_MSSR_EVENTS_JSONL: path.join(logDir, "mssr-events.jsonl"),
    BRIDGE_MCP_MSSR_INGEST_TOKEN_FILE: path.join(temp, "mssr-ingest.token"),
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(metricsDir, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(metricsDir, "project-health.json"),
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(metricsDir, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(metricsDir, "project-situation.json"),
    BRIDGE_MCP_DASHBOARD_SNAPSHOT_STATE: cachePath,
    BRIDGE_MCP_DASHBOARD_WORKER_TIMEOUT_MS: "1",
    BRIDGE_MCP_TEST_OBSERVABILITY_STORAGE_INIT_DELAY_MS: "5000",
  },
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let ready = false;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      const response = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(500) });
      if (response.ok && await response.text() === "ready") { ready = true; break; }
    } catch {}
    if (child.exitCode !== null) break;
    await sleep(50);
  }
  assert.equal(ready, true, `isolated Bridge did not become ready: ${stderr}`);

  const started = performance.now();
  const response = await fetch(`${base}/api/dashboard/snapshot`, { signal: AbortSignal.timeout(1_000) });
  const elapsedMs = performance.now() - started;
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.generatedAt, seededAt, "persisted snapshot should seed the first response while rebuild runs/fails");
  assert.equal(payload.cache?.hit, true);
  assert.equal(payload.cache?.stale, true);
  assert.equal(payload.status?.pid, child.pid, "cached payload must refresh runtime status instead of exposing the previous PID");
  assert.ok(elapsedMs < 1_000, `persisted dashboard seed response took ${elapsedMs.toFixed(2)} ms`);
  console.log("dashboard persisted seed PASS", { elapsedMs: Math.round(elapsedMs * 100) / 100, pid: child.pid });
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await fs.rm(temp, { recursive: true, force: true });
}
