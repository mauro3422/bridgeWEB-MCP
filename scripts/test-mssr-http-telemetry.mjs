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
        loadOrder: [], deferredLoadOrder: [],
        intent: {
          domains: ["coding"], actions: ["analyze"], artifacts: ["code"],
          needs: ["integrity-verification"], signals: ["nominal"], risk: "read-only", ambiguity: "low",
        },
        signals: ["nominal"], ambiguity: "low",
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
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.duplicate, false);
  const persistedRoute = (await fs.readFile(path.join(temp, "logs", "mssr-events.jsonl"), "utf8"))
    .trim().split(/\r?\n/).map((line) => JSON.parse(line))
    .find((event) => event.id === envelope.eventId);
  assert.deepEqual(persistedRoute?.details?.intent, envelope.event.route.intent,
    "Bridge must preserve the bounded structured intent projection");
  const decisionEnvelope = {
    ...envelope,
    eventId: `mssr-ext-http-decision-${Date.now()}`,
    emittedAt: new Date(Date.now() + 1).toISOString(),
    event: { kind: "skill_decision", decision: {
      skillName: "external-optional-skill",
      decision: "skipped",
      reasonCode: "irrelevant-domain",
      reasonSummary: "Not useful for this semantic route.",
      stage: "start",
    } },
  };
  const decisionResponse = await fetch(`${base}/api/mssr/events`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(decisionEnvelope),
  });
  assert.equal(decisionResponse.status, 202, await decisionResponse.text());
  const beforeSummaryResponse = await fetch(`${base}/api/mssr/summary?scope=all`);
  const beforeOutcome = await beforeSummaryResponse.json();
  assert.equal(beforeSummaryResponse.status, 200, JSON.stringify(beforeOutcome));
  assert.ok(Array.isArray(beforeOutcome.surfaces), `summary missing surfaces: ${JSON.stringify(beforeOutcome)}`);
  assert.equal(beforeOutcome.intentAnalysis?.intentDimensions?.domains?.coding, 1,
    "summary must expose portable structured-intent dimensions");
  assert.deepEqual(beforeOutcome.intentAnalysis?.maintenanceCandidates, [],
    "nominal single-trace evidence must not create maintenance candidates");
  const externalFeedback = beforeOutcome.intentAnalysis?.selectionFeedback?.find((item) => item.skillName === "external-optional-skill");
  assert.equal(externalFeedback?.skipped, 1, "HTTP-ingested skip must reach selection feedback analysis");
  assert.equal(externalFeedback?.reasonCounts?.["irrelevant-domain"], 1);
  assert.ok(externalFeedback?.signatures?.some((item) => item.signature.includes("d=coding")), "decision feedback must retain the route semantic signature");
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

  const closeRoute = {
    ...envelope,
    eventId: `mssr-ext-http-close-${Date.now()}`,
    emittedAt: new Date(Date.now() + 2).toISOString(),
    event: { kind: "route", action: "plan", taskHash: envelope.event.taskHash, route: {
      ...envelope.event.route,
      stage: "close",
      completedPhases: ["discovery", "verification", "persistence"],
    } },
  };
  const closeRouteResponse = await fetch(`${base}/api/mssr/events`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(closeRoute),
  });
  assert.equal(closeRouteResponse.status, 202, await closeRouteResponse.text());

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

  const routeEnvelopeFor = (traceId, eventId, workflowKey) => ({
    ...envelope,
    eventId,
    traceId,
    event: { kind: "route", action: "plan", taskHash: "a".repeat(64), route: { ...envelope.event.route, workflowKey } },
  });
  const hostEnvelopeFor = (traceId, eventId, opts) => ({
    protocolVersion: "mssr-host-call-v1",
    eventId,
    emittedAt: new Date().toISOString(),
    source: "opencode-plugin",
    caller: "opencode-local",
    traceId,
    host: {
      sessionKey: opts.sessionKey, parentSessionKey: "9".repeat(64), messageKey: "d".repeat(64),
      callKey: opts.callKey, agent: opts.agent, model: "opencode/deepseek-v4-flash-free",
      reasoningEffort: opts.reasoningEffort, variant: opts.variant, project: "fixture-project", projectKey: "e".repeat(64),
    },
    tool: {
      name: opts.toolName || "bash", startedAt: new Date().toISOString(), endedAt: new Date(Date.now() + 300).toISOString(),
      durationMs: 300, status: "success",
    },
  });
  const highTraceId = `mssr-opencode-http-high-${Date.now()}`;
  const lowTraceId = `mssr-opencode-http-low-${Date.now()}`;
  const lifecycleOnlyTraceId = `mssr-opencode-http-lifecycle-${Date.now()}`;
  assert.equal((await postHostCall(routeEnvelopeFor(highTraceId, `mssr-ext-http-high-route-${Date.now()}`, "http-regression-high"))).status, 202);
  assert.equal((await postHostCall(hostEnvelopeFor(highTraceId, `mssr-host-${"3".repeat(64)}`, {
    sessionKey: "1".repeat(64), callKey: "1".repeat(64), agent: "build", reasoningEffort: "high", variant: "high",
  }))).status, 202);
  assert.equal((await postHostCall(routeEnvelopeFor(lowTraceId, `mssr-ext-http-low-route-${Date.now()}`, "http-regression-low"))).status, 202);
  assert.equal((await postHostCall(hostEnvelopeFor(lowTraceId, `mssr-host-${"4".repeat(64)}`, {
    sessionKey: "2".repeat(64), callKey: "2".repeat(64), agent: "plan", reasoningEffort: "low", variant: "low",
  }))).status, 202);
  assert.equal((await postHostCall(routeEnvelopeFor(lifecycleOnlyTraceId, `mssr-ext-http-lifecycle-route-${Date.now()}`, "http-regression-lifecycle"))).status, 202);

  const routeEnvelopeWithEffort = (traceId, eventId, workflowKey, reasoningEffort) => ({
    ...envelope,
    eventId,
    traceId,
    event: { kind: "route", action: "plan", taskHash: "a".repeat(64), route: {
      ...envelope.event.route, workflowKey, agentProfile: { ...envelope.event.route.agentProfile, reasoningEffort },
    } },
  });
  const detourTraceId = `mssr-opencode-http-detour-${Date.now()}`;
  assert.equal((await postHostCall(routeEnvelopeFor(detourTraceId, `mssr-ext-http-detour-route-${Date.now()}`, "http-regression-detour"))).status, 202);
  assert.equal((await postHostCall(hostEnvelopeFor(detourTraceId, `mssr-host-${"5".repeat(64)}`, {
    sessionKey: "7".repeat(64), callKey: "5".repeat(64), agent: "build",
    reasoningEffort: "medium", variant: "medium", toolName: "project_context_load",
  }))).status, 202);
  assert.equal((await postHostCall(hostEnvelopeFor(detourTraceId, `mssr-host-${"6".repeat(64)}`, {
    sessionKey: "7".repeat(64), callKey: "6".repeat(64), agent: "build",
    reasoningEffort: "medium", variant: "medium", toolName: "project_context_load",
  }))).status, 202);
  const replanTraceId = `mssr-opencode-http-replan-${Date.now()}`;
  assert.equal((await postHostCall(routeEnvelopeWithEffort(replanTraceId, `mssr-ext-http-replan-low-${Date.now()}`, "http-regression-replan", "low"))).status, 202);
  assert.equal((await postHostCall(routeEnvelopeWithEffort(replanTraceId, `mssr-ext-http-replan-high-${Date.now()}`, "http-regression-replan", "high"))).status, 202);

  const finalSummary = await (await fetch(`${base}/api/mssr/summary?scope=all`)).json();
  const comparison = finalSummary.reasoningEffortComparison;
  assert.ok(Array.isArray(comparison), "summary must expose reasoningEffortComparison");
  assert.deepEqual(comparison.map((row) => row.bucket),
    ["low", "high", "other", "unknown", "multiple-observed"], "all effort buckets must be present in fixed order");
  const byBucket = new Map(comparison.map((row) => [row.bucket, row]));
  const lowBucket = byBucket.get("low");
  assert.equal(lowBucket.traces, 1);
  assert.deepEqual(lowBucket.identitySources, { "trace-correlated-host": 1 }, "low must stay a single-observed host bucket");
  assert.equal(lowBucket.physicalToolCalls, 1);
  assert.equal(lowBucket.hostObservedToolCalls, 1);
  assert.equal(lowBucket.bridgeDirectToolCalls, 0);
  assert.equal(lowBucket.delegatedToolCalls, 0);
  const highBucket = byBucket.get("high");
  assert.equal(highBucket.traces, 2, "replan lifecycle-only trace must collapse into a single high bucket");
  assert.deepEqual(highBucket.identitySources, { "trace-correlated-host": 1, "lifecycle-only": 1 }, "high merges the host trace and the canonicalized replan trace");
  assert.equal(highBucket.routeEvents, 3, "all route events of replanned traces must remain in their single bucket");
  assert.equal(highBucket.physicalToolCalls, 1);
  assert.equal(highBucket.hostObservedToolCalls, 1);
  const otherBucket = byBucket.get("other");
  assert.equal(otherBucket.traces, 1, "a non-standard effort must fall into other");
  assert.deepEqual(otherBucket.identitySources, { "trace-correlated-host": 1 });
  assert.equal(otherBucket.physicalToolCalls, 2);
  assert.equal(otherBucket.hostObservedToolCalls, 2);
  assert.equal(otherBucket.discoveryDetours, 2, "preparation host calls before any substantive action count as discovery detours");
  assert.equal(otherBucket.averageDiscoveryDetoursPerTrace, 2, "average discovery detours must be a plain ratio, not a percentage");
  const unknownBucket = byBucket.get("unknown");
  assert.equal(unknownBucket.traces, 1);
  assert.deepEqual(unknownBucket.identitySources, { "lifecycle-only": 1 }, "unobserved host metadata must stay lifecycle-only");
  assert.equal(unknownBucket.physicalToolCalls, 0, "lifecycle-only traces have no physical host calls");
  assert.equal(unknownBucket.hostObservedToolCalls, 0);
  const mixedBucket = byBucket.get("multiple-observed");
  assert.equal(mixedBucket.traces, 1);
  assert.deepEqual(mixedBucket.identitySources, { "trace-host-mixed": 1 }, "handoffs must bucket as multiple-observed");
  assert.equal(mixedBucket.physicalToolCalls, 3, "only the three OpenCode host calls count as physical on the handoff trace");
  assert.equal(mixedBucket.hostObservedToolCalls, 3);
  assert.equal(mixedBucket.bridgeDirectToolCalls, 0);
  assert.equal(mixedBucket.outcomeCoverage, 100, "bucket outcome coverage derives from exact trace counts");
  assert.equal(mixedBucket.outcomeSuccessRate, 100);
  const routedTraceIds = [traceId, highTraceId, lowTraceId, lifecycleOnlyTraceId, detourTraceId, replanTraceId];
  const uniqueRoutedTraces = new Set(routedTraceIds).size;
  const sumBucketTraces = comparison.reduce((total, row) => total + row.traces, 0);
  assert.equal(sumBucketTraces, uniqueRoutedTraces, "each routed trace must land in exactly one effort bucket");
  const sumBucketPhysical = comparison.reduce((total, row) => total + row.physicalToolCalls, 0);
  assert.equal(sumBucketPhysical, 3 + 1 + 1 + 2, "physical host calls must not be duplicated across buckets");
  assert.equal(byBucket.get("low").traces, 1, "replan trace must not bleed into a second bucket");
  assert.ok(!String(byBucket.get("other").averageDiscoveryDetoursPerTrace).includes("200"), "average discovery detours must never be a percentage");
  const durationKeys = ["averageFirstActionMs", "averageToolSpanMs", "averageCompletionMs", "averageReminderIdleMs", "averageDurationMs"];
  for (const row of comparison) {
    for (const key of durationKeys) {
      assert.equal(Object.hasOwn(row, key), false, `reasoningEffort bucket ${row.bucket} must not expose ${key}`);
    }
  }
  console.log("MSSR external lifecycle + OpenCode host-call telemetry and dashboard escaping: PASS");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(temp, { recursive: true, force: true });
}
