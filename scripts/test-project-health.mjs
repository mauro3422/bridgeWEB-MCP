import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { initializeMssrProject } from "@mauroprime/mssr";
import {
  captureProjectHealthIfDue,
  collectProjectHealthSnapshot,
  getProjectHealthReport,
} from "../dist/project-health.js";
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
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
      const response = await fetch(url, { cache: "no-store" });
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

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-project-health-"));
const store = path.join(root, "project-health.json");
const marker = "PRIVATE_CONTENT_MUST_NOT_BE_STORED_8c42";
try {
  const healthy = path.join(root, "healthy");
  const review = path.join(root, "review");
  for (const repo of [healthy, review]) {
    await fs.mkdir(path.join(repo, ".git"), { recursive: true });
    const init = await initializeMssrProject(repo, { initializeMissing: true, cleanupLegacyArtifacts: true });
    assert.equal(init.initialized, true);
  }

  const reviewState = path.join(review, ".mssr", "PROJECT_STATE.md");
  await fs.writeFile(reviewState, `# Project State\n\n## Oversized current state\n\n${marker}\n${"state-line-with-structure\n".repeat(1800)}`, "utf8");
  const reviewManifestPath = path.join(review, ".mssr", "project-context.json");
  const manifest = JSON.parse(await fs.readFile(reviewManifestPath, "utf8"));
  manifest.modules.push({
    id: "oversized-state",
    kind: "state",
    topic: "state",
    area: "review-fixture",
    description: "Oversized selected state fixture.",
    source: { path: ".mssr/PROJECT_STATE.md", sections: ["## Oversized current state"] },
    stages: ["resume"],
    domains: ["coding"],
    actions: ["review"],
    artifacts: ["project"],
    needs: ["history-recovery"],
    signals: [],
    required: false,
    priority: 10,
    maxChars: 80000,
  });
  await fs.writeFile(reviewManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const snapshot = await collectProjectHealthSnapshot({ workspaceRoot: root, maxDepth: 2, now: new Date("2026-08-15T20:00:00Z") });
  assert.equal(snapshot.counts.projects, 2);
  assert.equal(snapshot.counts.initialized, 2);
  assert.equal(snapshot.counts.review, 1);
  assert.equal(snapshot.counts.ok, 1);
  assert.equal(snapshot.projects[0].name, "review");
  assert.equal(snapshot.projects[0].level, "review");
  assert.equal(snapshot.projects[0].findingCodes.includes("oversized-authority"), true);
  assert.equal(snapshot.projects[0].findingCodes.includes("oversized-module"), true);

  const captured = await captureProjectHealthIfDue({
    force: true,
    workspaceRoot: root,
    filePath: store,
    maxDepth: 2,
    now: new Date("2026-08-15T20:00:00Z"),
  });
  assert.equal(captured.captured, true);
  assert.equal(captured.snapshotCount, 1);

  const second = await captureProjectHealthIfDue({
    workspaceRoot: root,
    filePath: store,
    maxDepth: 2,
    now: new Date("2026-08-15T20:10:00Z"),
  });
  assert.equal(second.captured, false);
  assert.equal(second.snapshotCount, 1);

  const report = await getProjectHealthReport(store);
  assert.equal(report.latest.counts.review, 1);
  assert.equal(report.policy.autoEdit, false);
  assert.equal(report.policy.contentStored, false);
  assert.equal(report.policy.watchesNotify, false);
  assert.equal(report.policy.reviewsNotify, true);

  const stored = await fs.readFile(store, "utf8");
  assert.equal(stored.includes(marker), false, "Project Health store must not persist project content");
  assert.equal(stored.includes("state-line-with-structure"), false);

  const port = await freePort();
  const httpStore = path.join(root, "http-project-health.json");
  const httpSkillStore = path.join(root, "http-skill-health.json");
  const httpRuntimeStore = path.join(root, "http-runtime-health.json");
  const httpSituationStore = path.join(root, "http-project-situation.json");
  let childOutput = "";
  const child = spawn(process.execPath, ["dist/http.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRIDGE_MCP_HTTP_HOST: "127.0.0.1",
      BRIDGE_MCP_HTTP_PORT: String(port),
      BRIDGE_MCP_PROJECT_HEALTH_ROOT: root,
      BRIDGE_MCP_PROJECT_HEALTH_PATH: httpStore,
      BRIDGE_MCP_SKILL_HEALTH_PATH: httpSkillStore,
      BRIDGE_MCP_RUNTIME_HEALTH_PATH: httpRuntimeStore,
      BRIDGE_MCP_PROJECT_SITUATION_PATH: httpSituationStore,
      BRIDGE_MCP_PROJECT_SITUATION_ROOT: root,
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
      health = await waitForJson(`http://127.0.0.1:${port}/api/mssr/project-health`, 3000, child, () => childOutput);
      if (health.latest) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(health?.latest, `HTTP Project Health scheduler did not create startup snapshot: ${childOutput}`);
    assert.equal(health.latest.counts.projects, 2);
    assert.equal(health.latest.counts.review, 1);
    assert.equal(health.policy.autoEdit, false);
    assert.equal(health.policy.watchesNotify, false);

    const runtimeHealth = await waitForJson(`http://127.0.0.1:${port}/api/mssr/runtime-health`, 3000, child, () => childOutput);
    assert.equal(runtimeHealth.version, 1);
    assert.equal(runtimeHealth.policy.metadataOnly, true);
    assert.equal(runtimeHealth.policy.transportObservation, "external-only");
    const notices = await waitForJson(`http://127.0.0.1:${port}/api/notices?limit=20`, 15000, child, () => childOutput);
    const noticeRows = Array.isArray(notices) ? notices : notices.notices || notices.items || [];
    assert.equal(noticeRows.some((item) => item.code === "mssr-project-health-review"), true, `Expected REVIEW notice: ${JSON.stringify(notices)}`);

    const dashboardResponse = await waitForResponse(`http://127.0.0.1:${port}/dashboard`, 5000, child, () => childOutput);
    assert.equal(dashboardResponse.ok, true);
    const dashboard = await dashboardResponse.text();
    assert.equal(dashboard.includes('id="mssr-project-health"'), true);
    assert.equal(dashboard.includes('/api/mssr/project-health'), true);
    assert.equal(dashboard.includes('id="mssr-runtime-health-status"'), true);
    assert.equal(dashboard.includes('/api/mssr/runtime-health'), true);
  } finally {
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("Bridge project health tests PASS");
