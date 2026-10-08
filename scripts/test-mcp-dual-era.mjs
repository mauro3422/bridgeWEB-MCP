import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-dual-era-"));
const port = 3900 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["dist/http.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BRIDGE_MCP_HTTP_PORT: String(port),
    BRIDGE_MCP_HTTP_SOFT_SESSION_LIMIT: "4",
    BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS: "10",
    BRIDGE_MCP_HTTP_CLEANUP_INTERVAL_MS: "50",
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(tempRoot, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(tempRoot, "project-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_ROOT: process.cwd(),
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(tempRoot, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(tempRoot, "project-situation.json"),
    BRIDGE_MCP_PROJECT_SITUATION_ROOT: process.cwd(),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitReady() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) return;
    } catch {
      // Process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Dual-era test server did not become ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

const envelope = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "bridge-dual-era-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function modernRequest(id, method, params = {}) {
  const selectorHeaders = method === "tools/call" && typeof params.name === "string"
    ? { "mcp-name": params.name }
    : method === "resources/read" && typeof params.uri === "string"
      ? { "mcp-name": params.uri }
      : {};
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...selectorHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: { ...params, _meta: envelope },
    }),
  });
}

async function openLegacySession(id, clientName) {
  const initializeResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: clientName, version: "1.0.0" },
      },
    }),
  });
  assert.equal(initializeResponse.status, 200);
  const initializeText = await initializeResponse.text();
  const initializeDataLine = initializeText.split(/\r?\n/).find((line) => line.startsWith('data: '));
  const initializeBody = initializeDataLine
    ? JSON.parse(initializeDataLine.slice('data: '.length))
    : JSON.parse(initializeText);
  assert.equal(initializeBody.result.capabilities.tools.listChanged, true, 'Legacy initialize must advertise tools.listChanged so clients can refresh stale tool schemas.');
  assert.ok(initializeBody.result.capabilities.resources, 'Legacy initialize must advertise resources so clients can resolve binary_file_attach resource links.');
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  assert.ok(sessionId);

  const initializedResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  });
  assert.equal(initializedResponse.status, 202);
  return sessionId;
}

async function legacyRequest(sessionId, id, method, params = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

async function readMcpResponse(response) {
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice("data: ".length) : text);
}

async function closeLegacySession(sessionId) {
  return fetch(`${baseUrl}/mcp`, {
    method: "DELETE",
    headers: {
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertCatalogRefreshHook() {
  const { createBridgeServer, createModernBridgeServer } = await import('../dist/bridge-server.js');
  for (const [label, factory] of [['legacy', createBridgeServer], ['modern', createModernBridgeServer]]) {
    const server = factory();
    assert.equal(typeof server.oninitialized, 'function', `${label} server must install an initialized hook for tool-catalog refresh.`);
    let notifications = 0;
    server.sendToolListChanged = async () => { notifications += 1; };
    server.oninitialized();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(notifications, 1, `${label} server must emit one tools/list_changed notification after initialization.`);
  }
}

async function runConcurrentCapacityTest() {
  const raceTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mcp-capacity-"));
  const racePort = 4600 + Math.floor(Math.random() * 500);
  const raceBaseUrl = `http://127.0.0.1:${racePort}`;
  const raceChild = spawn(process.execPath, ["dist/http.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRIDGE_MCP_HTTP_PORT: String(racePort),
      BRIDGE_MCP_HTTP_MAX_SESSIONS: "4",
      BRIDGE_MCP_HTTP_SOFT_SESSION_LIMIT: "4",
      BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS: "60000",
      BRIDGE_MCP_HTTP_CLEANUP_INTERVAL_MS: "60000",
      BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(raceTempRoot, "skill-health.json"),
      BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(raceTempRoot, "project-health.json"),
      BRIDGE_MCP_PROJECT_HEALTH_ROOT: process.cwd(),
      BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(raceTempRoot, "runtime-health.json"),
      BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(raceTempRoot, "project-situation.json"),
      BRIDGE_MCP_PROJECT_SITUATION_ROOT: process.cwd(),
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let raceStderr = "";
  raceChild.stderr.on("data", (chunk) => {
    raceStderr += chunk.toString();
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (raceChild.exitCode !== null) break;
      try {
        const response = await fetch(`${raceBaseUrl}/readyz`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // Retry while the isolated server starts.
      }
      await sleep(50);
    }
    assert.ok(ready, `Concurrent capacity test server did not become ready.\n${raceStderr}`);

    const initializations = await Promise.all(Array.from({ length: 12 }, (_, index) => fetch(`${raceBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 500 + index,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: `bridge-capacity-race-${index}`, version: "1.0.0" },
        },
      }),
    })));

    const successful = initializations.filter((response) => response.status === 200);
    const rejected = initializations.filter((response) => response.status === 503);
    assert.equal(successful.length, 4, `Expected exactly 4 admitted concurrent sessions, got ${successful.length}`);
    assert.equal(rejected.length, 8, `Expected 8 capacity rejections, got ${rejected.length}`);

    const raceStatus = await (await fetch(`${raceBaseUrl}/status`)).json();
    assert.equal(raceStatus.sessions, 4);
    assert.equal(raceStatus.transportsCreating, 0);
    assert.equal(raceStatus.limits.maxSessions, 4);

    await Promise.all(successful.map(async (response) => {
      const sessionId = response.headers.get("mcp-session-id");
      assert.ok(sessionId);
      const closeResponse = await fetch(`${raceBaseUrl}/mcp`, {
        method: "DELETE",
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId,
        },
      });
      assert.ok([200, 202, 204].includes(closeResponse.status));
    }));

    return {
      admitted: successful.length,
      rejected: rejected.length,
      sessions: raceStatus.sessions,
      maxSessions: raceStatus.limits.maxSessions,
    };
  } finally {
    raceChild.kill("SIGTERM");
    await new Promise((resolve) => {
      raceChild.once("exit", resolve);
      setTimeout(resolve, 2000).unref();
    });
    fs.rmSync(raceTempRoot, { recursive: true, force: true });
  }
}

try {
  await waitReady();
  await assertCatalogRefreshHook();

  const discoverResponse = await modernRequest(1, "server/discover");
  assert.equal(discoverResponse.status, 200);
  assert.equal(discoverResponse.headers.get("mcp-session-id"), null);
  const discover = await discoverResponse.json();
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.equal(discover.result._meta["io.modelcontextprotocol/serverInfo"].name, "bridge-mcp");

  const listResponse = await modernRequest(2, "tools/list");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("mcp-session-id"), null);
  const list = await listResponse.json();
  assert.ok(list.result.tools.length >= 100);
  assert.ok(list.result.tools.some((tool) => tool.name === "skill_bootstrap"));

  const librarianSearchTools = list.result.tools.filter((tool) => tool.name === "mssr_librarian_search");
  assert.equal(librarianSearchTools.length, 1, "HTTP tools/list must expose one existing Librarian search tool, not a duplicate sidecar tool.");
  assert.deepEqual(librarianSearchTools[0].inputSchema?.properties?.metadataMode?.enum, ["off", "project-context-single-section", "project-context-librarian-sidecar"]);

  const imageImportTool = list.result.tools.find((tool) => tool.name === "image_asset_import_files");
  assert.ok(imageImportTool, "HTTP tools/list must publish image_asset_import_files.");
  assert.deepEqual(imageImportTool._meta?.["openai/fileParams"], ["files"]);
  assert.ok(imageImportTool.inputSchema?.properties?.files, "image_asset_import_files must expose its authorized file parameter in HTTP tools/list.");
  const assetImportTool = list.result.tools.find((tool) => tool.name === "asset_import_files");
  assert.ok(assetImportTool, "HTTP tools/list must publish the general-purpose asset_import_files tool.");
  assert.deepEqual(assetImportTool._meta?.["openai/fileParams"], ["files"]);
  assert.ok(assetImportTool.inputSchema?.properties?.files, "asset_import_files must expose its authorized file parameter in HTTP tools/list.");

  const actionFallbackTool = list.result.tools.find((tool) => tool.name === "bridge_tool_action");
  assert.ok(actionFallbackTool, "HTTP tools/list must publish bridge_tool_action.");
  assert.deepEqual(actionFallbackTool._meta?.["openai/fileParams"], ["files"]);
  assert.ok(actionFallbackTool.inputSchema?.properties?.files, "bridge_tool_action must preserve top-level authorized file passthrough when dedicated schemas are omitted by a host catalog.");

  const fixtureBinaryPath = path.join(tempRoot, "package-fixture.json");
  fs.copyFileSync(path.join(process.cwd(), "package.json"), fixtureBinaryPath);
  const fixtureBinaryBytes = fs.readFileSync(fixtureBinaryPath);
  const binaryAttachResponse = await modernRequest(3, "tools/call", {
    name: "binary_file_attach",
    arguments: { path: fixtureBinaryPath, mode: "both" },
  });
  const binaryAttachText = await binaryAttachResponse.text();
  assert.equal(binaryAttachResponse.status, 200, binaryAttachText);
  const binaryAttachBody = JSON.parse(binaryAttachText);
  const binaryResourceLink = binaryAttachBody.result.content.find((part) => part.type === "resource_link");
  const binaryEmbeddedResource = binaryAttachBody.result.content.find((part) => part.type === "resource");
  const binaryAttachSummary = JSON.parse(binaryAttachBody.result.content.find((part) => part.type === "text")?.text || "{}");
  assert.equal(binaryResourceLink, undefined, "Modern stateless MCP must not publish a deferred resource link backed by shared process state.");
  assert.equal(Buffer.from(binaryEmbeddedResource?.resource?.blob || "", "base64").compare(fixtureBinaryBytes), 0, "Embedded MCP resource must preserve the exact local file bytes.");
  assert.equal(binaryAttachSummary.mode, "embedded", "Modern mode=both must explicitly fall back to the self-contained embedded resource.");
  assert.equal(binaryAttachSummary.requestedMode, "both");
  const modernResourcesList = await modernRequest(4, "resources/list");
  assert.deepEqual((await modernResourcesList.json()).result.resources, [], "Modern stateless MCP must not enumerate resources created by unrelated requests.");
  const modernInlineRead = await modernRequest(5, "resources/read", { uri: binaryEmbeddedResource.resource.uri });
  const modernInlineReadBody = await modernInlineRead.json();
  assert.equal(modernInlineReadBody.error?.code, -32602, "An embedded modern attachment must fail as an unavailable resource, not an internal server error.");
  assert.match(modernInlineReadBody.error?.message || "", /stateful session/i);
  const modernLinkOnly = await modernRequest(6, "tools/call", {
    name: "binary_file_attach",
    arguments: { path: fixtureBinaryPath, mode: "link" },
  });
  const modernLinkOnlyBody = await modernLinkOnly.json();
  const modernLinkOnlySummary = JSON.parse(modernLinkOnlyBody.result.content[0]?.text || "{}");
  assert.match(modernLinkOnlySummary.error || "", /stateful MCP session/i, "Modern stateless MCP must reject deferred resource-only attachments.");

  const mismatchResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
      params: { _meta: envelope },
    }),
  });
  assert.equal(mismatchResponse.status, 400);

  const reusableSession = await openLegacySession(10, "bridge-legacy-reuse-test");
  await sleep(25);
  const reusedResponse = await legacyRequest(reusableSession, 11, "tools/list");
  assert.equal(reusedResponse.status, 200, "A low-pressure legacy session must remain reusable beyond the reclaim grace window");
  const legacyAttachResponse = await legacyRequest(reusableSession, 12, "tools/call", {
    name: "binary_file_attach",
    arguments: { path: fixtureBinaryPath, mode: "both" },
  });
  assert.equal(legacyAttachResponse.status, 200);
  const legacyAttachBody = await readMcpResponse(legacyAttachResponse);
  const legacyResourceLink = legacyAttachBody.result.content.find((part) => part.type === "resource_link");
  assert.ok(legacyResourceLink?.uri?.startsWith("mauroprime://local-file/"), "Stateful legacy sessions must receive session-scoped resource links.");
  const legacyResourcesList = await legacyRequest(reusableSession, 13, "resources/list");
  assert.equal(legacyResourcesList.status, 200, "Legacy resources/list must expose registered binary resources.");
  const legacyListBody = await readMcpResponse(legacyResourcesList);
  assert.equal(legacyListBody.result.resources.length, 1);
  assert.equal(legacyListBody.result.resources[0].uri, legacyResourceLink.uri);
  const legacyResourceRead = await legacyRequest(reusableSession, 14, "resources/read", { uri: legacyResourceLink.uri });
  assert.equal(legacyResourceRead.status, 200, "Legacy resources/read must resolve a binary_file_attach resource URI.");
  assert.equal(Buffer.from((await readMcpResponse(legacyResourceRead)).result.contents[0].blob, "base64").compare(fixtureBinaryBytes), 0);

  const isolatedLegacySession = await openLegacySession(15, "bridge-legacy-isolation-test");
  const isolatedListResponse = await legacyRequest(isolatedLegacySession, 16, "resources/list");
  const isolatedListBody = await readMcpResponse(isolatedListResponse);
  assert.deepEqual(isolatedListBody.result.resources, [], "A separate stateful MCP session must not list another session's local file resource.");
  const isolatedReadResponse = await legacyRequest(isolatedLegacySession, 17, "resources/read", { uri: legacyResourceLink.uri });
  const isolatedReadBody = await readMcpResponse(isolatedReadResponse);
  assert.equal(isolatedReadBody.error?.code, -32602, "A cross-session URI must be rejected as an unavailable resource.");
  assert.match(isolatedReadBody.error?.message || "", /unknown, expired, or belongs to another MCP session/i, "A separate stateful MCP session must not read another session's local file resource.");
  fs.unlinkSync(fixtureBinaryPath);
  const missingSourceResponse = await legacyRequest(reusableSession, 18, "resources/read", { uri: legacyResourceLink.uri });
  const missingSourceBody = await readMcpResponse(missingSourceResponse);
  assert.equal(missingSourceBody.error?.code, -32602, "A resource whose source was deleted must fail as unavailable, not as an internal server error.");
  assert.match(missingSourceBody.error?.message || "", /no longer available/i);
  await closeLegacySession(isolatedLegacySession);
  const reusableClose = await closeLegacySession(reusableSession);
  assert.ok([200, 202, 204].includes(reusableClose.status));

  const rotatingSessions = [];
  for (let index = 0; index < 8; index += 1) {
    const sessionId = await openLegacySession(20 + index * 10, `bridge-rotating-test-${index}`);
    const toolResponse = await legacyRequest(sessionId, 21 + index * 10, "tools/list");
    assert.equal(toolResponse.status, 200);
    rotatingSessions.push(sessionId);
  }

  // Let the rotating sessions cross the reconnect grace window, then force one
  // more initialization. The steady-state pool should collapse to the soft
  // target instead of drifting toward the hard 64-session ceiling.
  await sleep(30);
  const finalRotatingSession = await openLegacySession(200, "bridge-rotating-test-final");
  const finalToolResponse = await legacyRequest(finalRotatingSession, 201, "tools/list");
  assert.equal(finalToolResponse.status, 200);

  const expiredOldestResponse = await legacyRequest(rotatingSessions[0], 300, "tools/list");
  assert.equal(expiredOldestResponse.status, 404, "Oldest inactive rotating session should be reclaimable under pressure");

  const statusResponse = await fetch(`${baseUrl}/status`);
  const status = await statusResponse.json();
  assert.equal(status.transport, "streamable-http-dual-era");
  assert.match(statusResponse.headers.get("keep-alive") || "", /timeout=120/, "Bridge should advertise the long keep-alive window used by the tunnel client");
  assert.equal(status.protocols.modern.revision, "2026-07-28");
  assert.equal(status.protocols.modern.requests, 7);
  assert.equal(status.limits.softSessionLimit, 4);
  assert.equal(status.limits.httpKeepAliveTimeoutMs, 120000);
  assert.equal(status.limits.httpKeepAliveTimeoutBufferMs, 5000);
  assert.ok(status.limits.httpHeadersTimeoutMs > status.limits.httpKeepAliveTimeoutMs + status.limits.httpKeepAliveTimeoutBufferMs);
  assert.ok(status.sessions <= 4, `Expected steady-state sessions <= 4, got ${status.sessions}`);
  assert.ok(status.sessionLifecycle.steadyStateReclaims >= 1, "Expected at least one pressure reclaim");
  assert.equal(status.sessionLifecycle.hardCapacityReclaims, 0, "Soft pressure handling should avoid the hard ceiling in this regression");
  assert.ok(status.sessionLifecycle.sessionNotFoundResponses >= 1, "Expired/reclaimed session responses should be counted");
  assert.equal(typeof status.sessionLifecycle.lastSessionNotFoundAt, "string", "Last session-not-found timestamp should be observable without storing session ids");
  assert.equal(typeof status.runtimeDiagnostics.eventLoop.maxLagMs, "number", "Event-loop max lag should be observable for transport incident correlation");
  assert.equal(typeof status.runtimeDiagnostics.eventLoop.stallCount, "number", "Event-loop stall count should be observable");
  assert.equal(status.runtimeDiagnostics.http.clientErrors, 0, "Nominal dual-era traffic should not produce HTTP client errors");

  const capacityRace = await runConcurrentCapacityTest();

  console.log(JSON.stringify({
    ok: true,
    modernTools: list.result.tools.length,
    modernRequests: status.protocols.modern.requests,
    legacyRequests: status.protocols.legacy.requests,
    sessions: status.sessions,
    softSessionLimit: status.limits.softSessionLimit,
    steadyStateReclaims: status.sessionLifecycle.steadyStateReclaims,
    capacityRace,
  }));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2000).unref();
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
