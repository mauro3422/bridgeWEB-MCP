import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { captureSkillHealthIfDue, getSkillHealthReport } from "../dist/skill-health.js";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForResponse(url, timeoutMs = 15000, child = null, getChildOutput = () => "") {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`HTTP child exited with code ${child.exitCode} while waiting for ${url}: ${getChildOutput()}`);
    }
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function waitForJson(url, timeoutMs = 15000, child = null, getChildOutput = () => "") {
  const response = await waitForResponse(url, timeoutMs, child, getChildOutput);
  return await response.json();
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-skill-health-"));
const filePath = path.join(root, "skill-health.json");

try {
  const t0 = new Date("2026-08-15T12:00:00.000Z");
  const first = await captureSkillHealthIfDue({ force: true, now: t0, filePath, retention: 3 });
  assert.equal(first.captured, true);
  assert.ok(first.latest);
  assert.ok(Number(first.latest.counts.ownedSkills || 0) > 0);
  assert.ok(Array.isArray(first.latest.skills));
  assert.ok(first.latest.skills.every((item) => !("content" in item) && !("path" in item)), "snapshot must not persist skill/reference contents or filesystem paths");

  const notDue = await captureSkillHealthIfDue({ now: new Date(t0.getTime() + 60 * 60 * 1000), filePath });
  assert.equal(notDue.captured, false, "daily audit must not create another snapshot within the cadence");

  const second = await captureSkillHealthIfDue({ now: new Date(t0.getTime() + 25 * 60 * 60 * 1000), filePath });
  assert.equal(second.captured, true);
  const report = await getSkillHealthReport(filePath);
  assert.equal(report.snapshotCount, 2);
  assert.equal(report.policy.advisoryOnly, true);
  assert.equal(report.policy.autoEdit, false);
  assert.equal(report.policy.contentStored, false);
  assert.ok(report.latest.skills.every((item) => "deltaChars" in item && "deltaLines" in item));

  const raw = await fs.readFile(filePath, "utf8");
  assert.equal(raw.includes("SKILL.md"), false, "store must not persist source paths");
  assert.equal(raw.includes("# Complex System Design"), false, "store must not persist procedural contents");

  const port = await freePort();
  const httpHealthPath = path.join(root, "http-skill-health.json");
  const httpProjectHealthPath = path.join(root, "http-project-health.json");
  const httpRuntimeHealthPath = path.join(root, "http-runtime-health.json");
  const httpSituationPath = path.join(root, "http-project-situation.json");
  let childOutput = "";
  const child = spawn(process.execPath, ["dist/http.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRIDGE_MCP_HTTP_HOST: "127.0.0.1",
      BRIDGE_MCP_HTTP_PORT: String(port),
      BRIDGE_MCP_SKILL_HEALTH_PATH: httpHealthPath,
      BRIDGE_MCP_PROJECT_HEALTH_PATH: httpProjectHealthPath,
      BRIDGE_MCP_PROJECT_HEALTH_ROOT: process.cwd(),
      BRIDGE_MCP_RUNTIME_HEALTH_PATH: httpRuntimeHealthPath,
      BRIDGE_MCP_PROJECT_SITUATION_PATH: httpSituationPath,
      BRIDGE_MCP_PROJECT_SITUATION_ROOT: process.cwd(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { childOutput += chunk.toString(); });
  try {
    await waitForJson(`http://127.0.0.1:${port}/status`, 15000, child, () => childOutput);
    let health;
    const deadline = Date.now() + 15000;
    do {
      health = await waitForJson(`http://127.0.0.1:${port}/api/mssr/skill-health`, 3000, child, () => childOutput);
      if (health.latest) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(health?.latest, `HTTP scheduler did not create the startup snapshot: ${childOutput}`);
    assert.equal(health.policy.autoEdit, false);
    const dashboardResponse = await waitForResponse(`http://127.0.0.1:${port}/dashboard`, 5000, child, () => childOutput);
    assert.equal(dashboardResponse.ok, true);
    const dashboard = await dashboardResponse.text();
    assert.equal(dashboard.includes('id="mssr-skill-health"'), true);
    assert.equal(dashboard.includes('/api/mssr/skill-health'), true);
  } finally {
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }

  console.log("Bridge daily skill health snapshots: PASS");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
