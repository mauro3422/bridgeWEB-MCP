import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-observability-bootstrap-retry-"));
const metricsDir = path.join(temp, "data");
const logDir = path.join(temp, "logs");
const sqlitePath = path.join(metricsDir, "metrics.sqlite");
await fs.mkdir(metricsDir, { recursive: true });
await fs.mkdir(logDir, { recursive: true });

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const lockDb = new DatabaseSync(sqlitePath);
lockDb.exec("PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 100; BEGIN EXCLUSIVE;");

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
    BRIDGE_MCP_DASHBOARD_SNAPSHOT_STATE: path.join(metricsDir, "dashboard-snapshot-cache.json"),
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(metricsDir, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(metricsDir, "project-health.json"),
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(metricsDir, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(metricsDir, "project-situation.json"),
  },
});

let stderr = "";
let resolveRetryNotice;
const retryNotice = new Promise((resolve) => { resolveRetryNotice = resolve; });
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
  if (/observability storage bootstrap hit transient SQLite contention; retrying once/i.test(stderr)) {
    resolveRetryNotice();
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

try {
  let retryTimeout;
  try {
    await Promise.race([
      retryNotice,
      new Promise((_, reject) => {
        retryTimeout = setTimeout(() => reject(new Error(`transient SQLite contention was not retried: ${stderr}`)), 8_000);
      }),
    ]);
  } finally {
    clearTimeout(retryTimeout);
  }

  // Release the deliberately held lock after the first failure but before the bounded retry.
  await sleep(25);
  lockDb.exec("ROLLBACK;");

  let status;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(500) });
      if (response.ok || response.status === 503) status = await response.json();
      if (status?.observabilityStorage?.state === "ready") break;
      if (status?.observabilityStorage?.state === "failed") break;
    } catch {}
    if (child.exitCode !== null) break;
    await sleep(25);
  }

  assert.equal((stderr.match(/transient SQLite contention; retrying once/gi) || []).length, 1, "bootstrap should retry exactly once");
  assert.equal(status?.observabilityStorage?.state, "ready", `bootstrap retry did not recover: ${stderr}`);
  const metrics = await fetch(`http://127.0.0.1:${port}/api/metrics/status`, { signal: AbortSignal.timeout(2_000) });
  assert.equal(metrics.status, 200, "database-backed routes should work after a successful bootstrap retry");
  console.log("observability bootstrap transient SQLite retry PASS", { readiness: status.ready, metrics: metrics.status, pid: child.pid });
} finally {
  try { lockDb.exec("ROLLBACK;"); } catch {}
  lockDb.close();
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 2_000))) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  }
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
