import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-mssr-http-"));
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
    BRIDGE_MCP_METRICS_DIR: path.join(temp, "data"),
    BRIDGE_MCP_LOG_DIR: path.join(temp, "logs"),
    BRIDGE_MCP_METRICS_SQLITE: path.join(temp, "data", "metrics.sqlite"),
    BRIDGE_MCP_MSSR_INGEST_TOKEN_FILE: tokenPath,
  },
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/readyz`);
      if (response.ok && await response.text() === "ready") { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, `isolated Bridge did not become ready: ${stderr}`);
  assert.equal((await fetch(`${base}/api/metrics/status`)).status, 200, "metrics schema initialization failed");

  const dashboard = await (await fetch(`${base}/dashboard`)).text();
  assert.ok(dashboard.includes("replace(/\\s+/g"), "served dashboard must compact whitespace");
  assert.equal(dashboard.includes("replace(/s+/g"), false, "served dashboard must not remove every letter s");

  const traceId = `mssr-opencode-http-${Date.now()}`;
  const envelope = {
    protocolVersion: "mssr-telemetry-v1",
    eventId: `mssr-ext-http-${Date.now()}`,
    emittedAt: new Date().toISOString(),
    source: "opencode-cli",
    traceId,
    caller: "opencode-local",
    event: {
      kind: "route", action: "plan", taskHash: "a".repeat(64),
      route: {
        caller: "opencode-local", stage: "start", classificationMode: "structured-semantic",
        workflowKey: "http-regression", agentProfile: { model: "unknown", reasoningEffort: "unknown" },
        contextUsed: false, contextCharacters: 0, workflows: [], activeSkills: [], deferredSkills: [],
        loadOrder: [], deferredLoadOrder: [], signals: ["nominal"], ambiguity: "low",
        requiredPhases: [], completedPhases: [], missingRequiredPhases: [],
      },
    },
  };
  const unauthorized = await fetch(`${base}/api/mssr/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope),
  });
  assert.equal(unauthorized.status, 401);
  const token = (await fs.readFile(tokenPath, "utf8")).trim();
  const send = () => fetch(`${base}/api/mssr/events`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const accepted = await send();
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).duplicate, false);
  const beforeSummaryResponse = await fetch(`${base}/api/mssr/summary?scope=all`);
  const beforeOutcome = await beforeSummaryResponse.json();
  assert.equal(beforeSummaryResponse.status, 200, JSON.stringify(beforeOutcome));
  assert.ok(Array.isArray(beforeOutcome.surfaces), `summary missing surfaces: ${JSON.stringify(beforeOutcome)}`);
  assert.equal(beforeOutcome.surfaces.find((item) => item.caller === "opencode-local")?.routedTraces, 1);
  assert.equal(beforeOutcome.surfaces.find((item) => item.caller === "opencode-local")?.outcomeTraces, 0, "outcome must not be inferred");
  const duplicate = await send();
  assert.equal((await duplicate.json()).duplicate, true);

  const outcome = {
    ...envelope,
    eventId: `mssr-ext-http-outcome-${Date.now()}`,
    event: { kind: "checkpoint", checkpoint: {
      eventType: "outcome", stage: "close", status: "success", primarySkill: "mssr-agent-routing",
      accepted: true, verificationPassed: true, persisted: true, evidenceKind: "tests",
      evidenceRef: "scripts/test-mssr-http-telemetry.mjs", summary: "Authenticated OpenCode telemetry regression passed.",
    } },
  };
  const outcomeResponse = await fetch(`${base}/api/mssr/events`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(outcome),
  });
  assert.equal(outcomeResponse.status, 202, await outcomeResponse.text());
  const afterOutcome = await (await fetch(`${base}/api/mssr/summary?scope=all`)).json();
  const surface = afterOutcome.surfaces.find((item) => item.caller === "opencode-local");
  assert.equal(surface.outcomeTraces, 1);
  assert.equal(surface.outcomeCoverage, 100);
  console.log("MSSR external HTTP telemetry and dashboard escaping: PASS");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(temp, { recursive: true, force: true });
}
