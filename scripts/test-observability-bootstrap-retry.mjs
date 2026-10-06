import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeoutMs = 30_000;
const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(2_000) });

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return true;
  return await new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeout);
    child.once("exit", onExit);
  });
}

async function startLockedServer(label) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-observability-bootstrap-" + label + "-"));
  const metricsDir = path.join(temp, "data");
  const logDir = path.join(temp, "logs");
  const sqlitePath = path.join(metricsDir, "metrics.sqlite");
  await fs.mkdir(metricsDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

  const port = await reservePort();
  const base = "http://127.0.0.1:" + port;
  const lockDb = new DatabaseSync(sqlitePath);
  lockDb.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 100; BEGIN IMMEDIATE;");

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
      BRIDGE_MCP_TEST_OBSERVABILITY_STORAGE_INIT_DELAY_MS: "0",
    },
  });

  let stderr = "";
  let spawnError = null;
  let resolveRetryNotice;
  let resolveChildExit;
  const retryNotice = new Promise((resolve) => { resolveRetryNotice = resolve; });
  const childExit = new Promise((resolve) => { resolveChildExit = resolve; });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    if (/observability storage bootstrap hit transient SQLite contention; retrying once/i.test(stderr)) {
      resolveRetryNotice();
    }
  });
  child.once("error", (error) => {
    spawnError = error;
    resolveChildExit({ code: null, signal: null, error });
  });
  child.once("exit", (code, signal) => resolveChildExit({ code, signal, error: spawnError }));

  return {
    base,
    child,
    childExit,
    label,
    lockDb,
    retryNotice,
    stderr: () => stderr,
    temp,
    port,
    releaseLock() {
      try { lockDb.exec("ROLLBACK;"); } catch {}
      try { lockDb.close(); } catch {}
    },
  };
}

async function waitForHttpStartup(state) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new Error(state.label + " HTTP child exited before listen (code " + state.child.exitCode
        + ", signal " + state.child.signalCode + "): " + state.stderr());
    }
    try {
      const response = await fetch(state.base + "/status", { signal: AbortSignal.timeout(1_000) });
      const status = await response.json();
      if ([200, 503].includes(response.status)
        && ["initializing", "ready", "failed"].includes(status?.observabilityStorage?.state)) {
        return status;
      }
    } catch {}
    await sleep(25);
  }
  throw new Error(state.label + " HTTP startup timed out (pid " + state.child.pid + ", port " + state.port
    + "): " + state.stderr());
}

async function waitForRetryNotice(state) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(state.label + " retry warning timed out (pid " + state.child.pid
      + ", port " + state.port + ", exitCode " + state.child.exitCode + "): " + state.stderr())), timeoutMs);
  });
  const earlyExit = state.childExit.then(({ code, signal, error }) => {
    throw new Error(state.label + " HTTP child exited before retry warning (code " + code
      + ", signal " + signal + ", spawnError " + (error?.message ?? "none") + "): " + state.stderr());
  });
  try {
    await Promise.race([state.retryNotice, earlyExit, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForStorageTerminalState(state) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new Error(state.label + " HTTP child exited while waiting for storage state (code "
        + state.child.exitCode + ", signal " + state.child.signalCode + "): " + state.stderr());
    }
    try {
      const response = await fetch(state.base + "/status", { signal: AbortSignal.timeout(1_000) });
      if (response.ok || response.status === 503) lastStatus = await response.json();
      const storageState = lastStatus?.observabilityStorage?.state;
      if (storageState === "ready" || storageState === "failed") return lastStatus;
    } catch {}
    await sleep(25);
  }
  throw new Error(state.label + " storage bootstrap timed out: " + JSON.stringify(lastStatus) + "; " + state.stderr());
}

async function cleanup(state) {
  state.releaseLock();
  if (state.child.exitCode === null && state.child.signalCode === null && state.child.pid !== undefined) {
    state.child.kill("SIGTERM");
    if (!(await waitForExit(state.child, 2_000))) {
      state.child.kill("SIGKILL");
      await waitForExit(state.child, 2_000);
    }
  }
  await fs.rm(state.temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

async function testRecoveryAfterLockRelease() {
  const state = await startLockedServer("retry-recovery");
  try {
    await waitForHttpStartup(state);
    await waitForRetryNotice(state);
    assert.equal((state.stderr().match(/transient SQLite contention; retrying once/gi) || []).length, 1,
      "bootstrap should retry exactly once");

    // The retry delay is 200 ms. Releasing as soon as the warning arrives avoids a timing sleep.
    state.releaseLock();
    const status = await waitForStorageTerminalState(state);
    assert.equal(status.observabilityStorage?.state, "ready", "bootstrap retry should recover after lock release");
    const metrics = await timedFetch(state.base + "/api/metrics/status");
    assert.equal(metrics.status, 200, "database-backed routes should work after a successful bootstrap retry");
    console.log("observability bootstrap transient SQLite retry PASS", {
      readiness: status.ready,
      metrics: metrics.status,
      pid: state.child.pid,
    });
  } finally {
    await cleanup(state);
  }
}

async function testRetryExhaustionFailsClosed() {
  const state = await startLockedServer("retry-exhaustion");
  try {
    await waitForHttpStartup(state);
    await waitForRetryNotice(state);
    const status = await waitForStorageTerminalState(state);
    assert.equal(status.observabilityStorage?.state, "failed", "persistent lock should exhaust the bounded retry");
    assert.equal((state.stderr().match(/transient SQLite contention; retrying once/gi) || []).length, 1,
      "persistent contention should trigger only one retry");

    const [health, ready, failedStatus] = await Promise.all([
      timedFetch(state.base + "/healthz"),
      timedFetch(state.base + "/readyz"),
      timedFetch(state.base + "/status"),
    ]);
    assert.equal(health.status, 200, "HTTP liveness should remain observable after retry exhaustion");
    assert.equal(ready.status, 503, "retry exhaustion should revoke readiness");
    assert.equal(failedStatus.status, 503);
    const failedPayload = await failedStatus.json();
    assert.equal(failedPayload.ready, false);
    assert.equal(failedPayload.observabilityStorage?.state, "failed");

    const metrics = await timedFetch(state.base + "/api/metrics/status");
    assert.equal(metrics.status, 503, "metrics routes should fail before querying an unavailable schema");
    const mcp = await timedFetch(state.base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(mcp.status, 503, "MCP must not dispatch while observability storage is unavailable");
    const afterMcp = await (await timedFetch(state.base + "/status")).json();
    assert.equal(afterMcp.protocols.legacy.requests, 0);
    assert.equal(afterMcp.protocols.modern.requests, 0);

    console.log("observability bootstrap SQLite retry exhaustion fails closed PASS", {
      health: health.status,
      readiness: ready.status,
      metrics: metrics.status,
      mcp: mcp.status,
      pid: state.child.pid,
    });
  } finally {
    await cleanup(state);
  }
}

await testRecoveryAfterLockRelease();
await testRetryExhaustionFailsClosed();
