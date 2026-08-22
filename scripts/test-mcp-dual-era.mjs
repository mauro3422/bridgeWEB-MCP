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
  stdio: ["ignore", "ignore", "pipe"],
  windowsHide: true,
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) return;
    } catch {
      // Process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Dual-era test server did not become ready.\n${stderr}`);
}

const envelope = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "bridge-dual-era-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function modernRequest(id, method, params = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
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

  const mismatchResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: { _meta: envelope },
    }),
  });
  assert.equal(mismatchResponse.status, 400);

  const reusableSession = await openLegacySession(10, "bridge-legacy-reuse-test");
  await sleep(25);
  const reusedResponse = await legacyRequest(reusableSession, 11, "tools/list");
  assert.equal(reusedResponse.status, 200, "A low-pressure legacy session must remain reusable beyond the reclaim grace window");
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

  const status = await (await fetch(`${baseUrl}/status`)).json();
  assert.equal(status.transport, "streamable-http-dual-era");
  assert.equal(status.protocols.modern.revision, "2026-07-28");
  assert.equal(status.protocols.modern.requests, 3);
  assert.equal(status.limits.softSessionLimit, 4);
  assert.ok(status.sessions <= 4, `Expected steady-state sessions <= 4, got ${status.sessions}`);
  assert.ok(status.sessionLifecycle.steadyStateReclaims >= 1, "Expected at least one pressure reclaim");
  assert.equal(status.sessionLifecycle.hardCapacityReclaims, 0, "Soft pressure handling should avoid the hard ceiling in this regression");

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
