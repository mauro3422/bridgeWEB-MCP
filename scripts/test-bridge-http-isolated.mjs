import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-http-verify-"));
const dataDir = path.join(temp, "data");
const logDir = path.join(temp, "logs");
const tokenPath = path.join(dataDir, "mssr-ingest.token");
let bridge = null;
let bridgeStderr = "";
let smokeOutput = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntilReady(baseUrl, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bridge.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && await response.text() === "ready") return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`isolated candidate HTTP server did not become ready: ${bridgeStderr.slice(-4_000)}`);
}

function runSmoke(baseUrl) {
  const scriptPath = path.join(root, "scripts", "test-bridge-http.ps1");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-File", scriptPath, "-BaseUrl", baseUrl,
    ], {
      cwd: temp,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => { smokeOutput += String(chunk); });
    child.stderr.on("data", (chunk) => { smokeOutput += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

try {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const metricsPath = path.join(dataDir, "metrics.sqlite");
  const eventsPath = path.join(logDir, "mssr-events.jsonl");
  const env = {
    ...process.env,
    BRIDGE_MCP_HTTP_HOST: "127.0.0.1",
    BRIDGE_MCP_HTTP_PORT: String(port),
    BRIDGE_MCP_HTTP_PATH: "/mcp",
    BRIDGE_MCP_METRICS_DIR: dataDir,
    BRIDGE_MCP_LOG_DIR: logDir,
    BRIDGE_MCP_METRICS_SQLITE: metricsPath,
    BRIDGE_MCP_MSSR_EVENTS_JSONL: eventsPath,
    BRIDGE_MCP_MSSR_INGEST_TOKEN_FILE: tokenPath,
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(dataDir, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(dataDir, "project-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_ROOT: root,
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(dataDir, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(dataDir, "project-situation.json"),
    BRIDGE_MCP_PROJECT_SITUATION_ROOT: root,
  };

  bridge = spawn(process.execPath, [path.join(root, "dist", "http.js")], {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  bridge.stderr.on("data", (chunk) => { bridgeStderr += String(chunk); });

  await waitUntilReady(baseUrl);
  const statusResponse = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(2_000) });
  assert.equal(statusResponse.ok, true, "isolated candidate /status must respond");
  const status = await statusResponse.json();
  assert.equal(status.server?.version, packageJson.version, "isolated HTTP process must report this worktree's package version");
  const metricsStatusResponse = await fetch(`${baseUrl}/api/metrics/status`, { signal: AbortSignal.timeout(2_000) });
  assert.equal(metricsStatusResponse.ok, true, "isolated HTTP process must initialize its temporary metrics schema");

  const result = await runSmoke(baseUrl);
  if (result.code !== 0) {
    throw new Error(`candidate HTTP smoke failed (exit=${result.code}, signal=${result.signal ?? "none"}):\n${smokeOutput.slice(-8_000)}\nBridge stderr:\n${bridgeStderr.slice(-4_000)}`);
  }
  process.stdout.write(smokeOutput);
  console.log(`[bridge-http-isolated] PASS version=${status.server.version} boot=${status.runtimeBootId} data=temporary`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (bridge && bridge.exitCode === null) {
    const exited = new Promise((resolve) => bridge.once("exit", resolve));
    bridge.kill("SIGTERM");
    await Promise.race([exited, sleep(5_000)]);
    if (bridge.exitCode === null) {
      bridge.kill("SIGKILL");
      await Promise.race([exited, sleep(2_000)]);
    }
  }

  const tempRoot = path.resolve(os.tmpdir());
  const resolvedTemp = path.resolve(temp);
  assert.ok(resolvedTemp.startsWith(`${tempRoot}${path.sep}`), "cleanup target must stay inside the OS temp directory");
  await fs.rm(resolvedTemp, { recursive: true, force: true });
}
