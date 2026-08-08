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
  const lifecycleOnlyProfile = beforeOutcome.agentProfiles.find((item) => item.caller === "opencode-local");
  assert.equal(lifecycleOnlyProfile?.identitySource, "lifecycle-only", "unobserved host metadata must remain unobserved");
  assert.equal(lifecycleOnlyProfile?.hostAgent, "unknown");
  const duplicate = await send();
  assert.equal((await duplicate.json()).duplicate, true);

  const routeHostCall = {
    protocolVersion: "mssr-host-call-v1",
    eventId: `mssr-host-${"a".repeat(64)}`,
    emittedAt: new Date().toISOString(),
    source: "opencode-plugin",
    caller: "opencode-local",
    host: {
      sessionKey: "c".repeat(64), parentSessionKey: "9".repeat(64), messageKey: "d".repeat(64), callKey: "a".repeat(64),
      agent: "build", model: "opencode/deepseek-v4-flash-free", reasoningEffort: "high",
      variant: "high", project: "fixture-project", projectKey: "e".repeat(64),
    },
    tool: {
      name: "mssr_mssr_route_plan", startedAt: new Date(Date.now() - 2_000).toISOString(), endedAt: new Date(Date.now() + 2_000).toISOString(),
      durationMs: 4_000, status: "success",
    },
  };
  const postHostCall = (body) => fetch(`${base}/api/mssr/events`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const routeObserved = await postHostCall(routeHostCall);
  const routeObservedBody = await routeObserved.json();
  assert.equal(routeObserved.status, 202, JSON.stringify(routeObservedBody));
  assert.equal(routeObservedBody.traceId, traceId, "host route must correlate to the unique lifecycle route");
  const hostCall = {
    ...routeHostCall,
    eventId: `mssr-host-${"b".repeat(64)}`,
    host: { ...routeHostCall.host, callKey: "b".repeat(64) },
    tool: {
      name: "bash", startedAt: new Date().toISOString(), endedAt: new Date(Date.now() + 425).toISOString(),
      durationMs: 425, status: "error",
    },
  };
  const hostAccepted = await postHostCall(hostCall);
  const hostAcceptedBody = await hostAccepted.json();
  assert.equal(hostAccepted.status, 202, JSON.stringify(hostAcceptedBody));
  assert.equal(hostAcceptedBody.traceId, traceId, "next host call must inherit the session trace");
  assert.equal((await postHostCall(hostCall).then((response) => response.json())).duplicate, true);
  const recent = await (await fetch(`${base}/api/metrics/recent?scope=all&limit=20`)).json();
  const observed = recent.recent.find((item) => item.call_key === "b".repeat(64));
  assert.ok(observed, "OpenCode host call metric missing");
  assert.equal(observed.host_agent, "build");
  assert.equal(observed.host_variant, "high");
  assert.equal(observed.model, "opencode/deepseek-v4-flash-free");
  assert.equal(observed.duration_ms, 425);
  assert.equal(observed.ok, 0);
  assert.equal(observed.trace_id, traceId);
  assert.equal(observed.host_parent_session_key, "9".repeat(64), "only the host-provided parent-session hash is persisted");
  assert.equal(observed.error, null, "host error text must never be stored");

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
  const lifecycleProfile = afterOutcome.agentProfiles.find((item) =>
    item.caller === "opencode-local"
    && item.hostAgent === "build"
    && item.model === "opencode/deepseek-v4-flash-free"
    && item.identitySource === "trace-correlated-host");
  assert.ok(lifecycleProfile, "lifecycle rows must expose the one host identity observed on their trace");
  assert.equal(lifecycleProfile.reasoningEffort, "high");
  assert.equal(lifecycleProfile.hostVariant, "high");
  assert.equal(lifecycleProfile.observedSessionCount, 1, "only hashed host session cardinality is projected");
  assert.equal(lifecycleProfile.observedParentSessionCount, 1, "parent relationship is counted only when OpenCode exposed a hash");
  assert.equal(lifecycleProfile.hostObservedToolCalls, 2, "native OpenCode calls remain physical host observations");
  assert.equal(lifecycleProfile.bridgeDirectToolCalls, 0, "host observations must not be labelled Bridge execution");
  assert.equal(lifecycleProfile.physicalToolCalls, 2, "lifecycle events must not inflate physical call cardinality");
  const handoff = {
    ...hostCall,
    eventId: `mssr-host-${"f".repeat(64)}`,
    traceId,
    host: {
      ...hostCall.host,
      callKey: "f".repeat(64),
      agent: "explore",
      variant: "low",
    },
  };
  assert.equal((await postHostCall(handoff)).status, 202);
  const mixedSummary = await (await fetch(`${base}/api/mssr/summary?scope=all`)).json();
  const mixedProfile = mixedSummary.agentProfiles.find((item) =>
    item.caller === "opencode-local" && item.identitySource === "trace-host-mixed");
  assert.ok(mixedProfile, "an agent handoff must remain explicit instead of picking the latest host identity");
  assert.equal(mixedProfile.hostAgent, "multiple-observed");
  assert.equal(mixedProfile.hostObservedToolCalls, 3);
  console.log("MSSR external lifecycle + OpenCode host-call telemetry and dashboard escaping: PASS");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(temp, { recursive: true, force: true });
}
