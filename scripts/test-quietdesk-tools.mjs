import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createQuietDeskToolModule } from "../dist/tools/quietdesk-tools.js";
import { createDefaultToolRegistry } from "../dist/tool-registry.js";
import { getPathPolicy } from "../dist/tools/shared/path.js";

const calls = [];
const fakeFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ pathname: url.pathname, search: url.search, method: init.method ?? "GET", body });

  const payloads = new Map([
    ["/health", { service: "quietdesk", version: "fixture", status: "ok", platform: "windows", userPresence: { active: false, idleMs: 1000 }, foregroundWindow: null }],
    ["/v1/desktop/snapshot", { snapshotId: "snap:1", windows: [] }],
    ["/v1/desktop/coverage", { observationRef: "snap:1", level: "usable" }],
    ["/v1/desktop/candidates", { observationRef: "snap:1", operations: [], targets: [] }],
    ["/v1/desktop/semantic-context", { snapshot: { snapshotId: "snap:1" }, candidates: { observationRef: "snap:1" } }],
    ["/v1/desktop/capture", { captureId: "capture:1", windowRef: "win:1", artifactRef: "C:\\Users\\fixture\\AppData\\Local\\QuietDesk\\captures\\capture.png", capturedAtUnixMs: 1, expiresAtUnixMs: 2, widthPx: 640, heightPx: 480, contentSha256: "a".repeat(64), freshnessToken: "fresh:1" }],
    ["/v1/telemetry/runtime", { disturbance: {}, semanticCoverage: {}, recentEvidence: [] }],
    ["/v1/desktop/execute", { status: "succeeded", reasonCodes: [], evidenceRefs: [] }],
  ]);
  const payload = payloads.get(url.pathname);
  if (!payload) return new Response("not found", { status: 404 });
  return Response.json(payload);
};

const module = createQuietDeskToolModule({ fetch: fakeFetch, timeoutMs: 1000 });
assert.equal(module.name, "quietdesk");
assert.equal(module.tools.length, 8);

await module.handlers.quietdesk_status({});
await module.handlers.quietdesk_desktop_snapshot({ windowRef: "win:1" });
await module.handlers.quietdesk_desktop_coverage({ windowRef: "win:1", sessionId: "session:1" });
await module.handlers.quietdesk_desktop_candidates({ windowRef: "win:1" });
await module.handlers.quietdesk_desktop_semantic_context({ windowRef: "win:1" });
const capture = await module.handlers.quietdesk_desktop_capture({ windowRef: "win:1", ttlMs: 30_000 });
await module.handlers.quietdesk_runtime_telemetry({ sessionId: "session:1" });
await module.handlers.quietdesk_execute_semantic({
  windowRef: "win:1",
  selection: { operationId: "uia.invoke", targetId: "target:1", targetFreshnessToken: "target:fresh" },
  policy: { disturbance: "silent", autonomy: "bounded", pauseOnUserActivity: true },
  sessionId: "session:1",
  decision: { provider: "large_model", decisionId: "decision:1", confidence: 0.98, margin: 0.8 },
});

assert.equal(capture.captureId, "capture:1");
assert.deepEqual(calls.map((call) => [call.method, call.pathname]), [
  ["GET", "/health"],
  ["GET", "/v1/desktop/snapshot"],
  ["GET", "/v1/desktop/coverage"],
  ["GET", "/v1/desktop/candidates"],
  ["GET", "/v1/desktop/semantic-context"],
  ["POST", "/v1/desktop/capture"],
  ["GET", "/v1/telemetry/runtime"],
  ["POST", "/v1/desktop/execute"],
]);
assert.equal(calls[1].search, "?windowRef=win%3A1");
assert.equal(calls[2].search, "?windowRef=win%3A1&sessionId=session%3A1");
assert.deepEqual(calls[5].body, { windowRef: "win:1", ttlMs: 30_000 });
assert.equal(calls[7].body.payload.kind, "none");
assert.equal(calls[7].body.selection.targetFreshnessToken, "target:fresh");
assert.equal(calls[7].body.policy.disturbance, "silent");

assert.throws(
  () => createQuietDeskToolModule({ baseUrl: "https://example.com" }),
  /loopback HTTP origins/,
);
await assert.rejects(
  () => module.handlers.quietdesk_desktop_capture({ windowRef: "win:1", ttlMs: 30_001 }),
  /less than or equal to 30000/,
);
await assert.rejects(
  () => module.handlers.quietdesk_execute_semantic({
    windowRef: "win:1",
    selection: { operationId: "uia.invoke", targetId: "target:1", targetFreshnessToken: "target:fresh", x: 12 },
    policy: { disturbance: "silent", autonomy: "bounded" },
  }),
  /unrecognized key/i,
);

const registry = createDefaultToolRegistry();
const quietDeskTools = registry.tools.filter((tool) => tool.name.startsWith("quietdesk_"));
assert.equal(quietDeskTools.length, 8);
for (const tool of quietDeskTools) assert.equal(tool.metadata?.role, "provider-proxy");
const statusTool = quietDeskTools.find((tool) => tool.name === "quietdesk_status");
assert.equal(statusTool?.annotations?.readOnlyHint, true);
const captureTool = quietDeskTools.find((tool) => tool.name === "quietdesk_desktop_capture");
assert.equal(captureTool?.annotations?.readOnlyHint, false);
assert.equal(captureTool?.annotations?.destructiveHint, false);
assert.deepEqual(captureTool?.metadata?.mssrLifecycle, { effect: "inspect", scale: "trivial" });
const executeTool = quietDeskTools.find((tool) => tool.name === "quietdesk_execute_semantic");
assert.equal(executeTool?.annotations?.destructiveHint, true);
assert.deepEqual(executeTool?.metadata?.mssrLifecycle, { effect: "external-side-effect", scale: "unknown" });

const capturesRoot = path.join(os.homedir(), "AppData", "Local", "QuietDesk", "captures");
if (fs.existsSync(capturesRoot)) {
  assert.ok(getPathPolicy().readOnlyRoots.some((root) => path.resolve(root) === path.resolve(capturesRoot)));
}

console.log("QuietDesk Bridge provider-proxy tools: PASS");
