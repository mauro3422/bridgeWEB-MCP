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

  const initializeResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bridge-legacy-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(initializeResponse.status, 200);
  assert.ok(initializeResponse.headers.get("mcp-session-id"));

  const status = await (await fetch(`${baseUrl}/status`)).json();
  assert.equal(status.transport, "streamable-http-dual-era");
  assert.equal(status.protocols.modern.revision, "2026-07-28");
  assert.equal(status.protocols.modern.requests, 3);
  assert.equal(status.protocols.legacy.requests, 1);

  console.log(JSON.stringify({
    ok: true,
    modernTools: list.result.tools.length,
    modernRequests: status.protocols.modern.requests,
    legacyRequests: status.protocols.legacy.requests,
  }));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2000).unref();
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
