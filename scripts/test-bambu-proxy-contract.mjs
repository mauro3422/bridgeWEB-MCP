import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDefaultToolCatalog, createDefaultToolRegistry } from "../dist/tool-registry.js";

const catalog = getDefaultToolCatalog();
const registry = createDefaultToolRegistry();
const names = ["bambu_mcp_status", "bambu_mcp_tool_list", "bambu_mcp_tool_call", "bambu_mcp_reconnect"];
for (const name of names) {
  assert.equal(catalog.filter((tool) => tool.name === name).length, 1, `${name} must appear exactly once`);
  assert.equal(registry.has(name), true, `${name} must have a handler`);
  assert.ok(catalog.find((tool) => tool.name === name).inputSchema, `${name} must publish a schema`);
  assert.equal(catalog.find((tool) => tool.name === name).metadata?.role, "provider-proxy");
  assert.equal(catalog.find((tool) => tool.name === name).metadata?.family, "bambu-mcp-connection");
}
assert.ok(registry.riskSummary.readOnly.includes("bambu_mcp_status"));
assert.ok(registry.riskSummary.readOnly.includes("bambu_mcp_tool_list"));
assert.ok(registry.riskSummary.destructive.includes("bambu_mcp_tool_call"), "generic remote dispatch must be conservatively classified");
assert.ok(registry.riskSummary.destructive.includes("bambu_mcp_reconnect"), "provider lifecycle control must be conservatively classified");
for (const oldTool of ["bambu_project_inspect", "bambu_slice_headless_save", "bambu_history_start", "bambu_device_status"]) {
  assert.equal(registry.has(oldTool), false, `${oldTool} must remain owned by the provider, not Bridge`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-bambu-fake-provider-"));
const fakeProvider = path.join(root, "fake-provider.py");
const previousProvider = process.env.BRIDGE_BAMBU_MCP_SERVER_PATH;
const previousNodeEnv = process.env.NODE_ENV;
const previousStartTimeout = process.env.BRIDGE_BAMBU_MCP_TEST_START_TIMEOUT_MS;
process.env.NODE_ENV = "test";
process.env.BRIDGE_BAMBU_MCP_TEST_START_TIMEOUT_MS = "1000";
const providerSource = (version, tools, startupDelayMs = 0) => `import json, time
VERSION=${JSON.stringify(version)}
TOOLS=json.loads(${JSON.stringify(JSON.stringify(tools))})
STARTUP_DELAY_MS=${startupDelayMs}
for line in __import__("sys").stdin:
    try: request=json.loads(line)
    except Exception: continue
    method=request.get("method")
    if method=="initialize":
        time.sleep(STARTUP_DELAY_MS/1000)
        result={"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":VERSION}}
    elif method=="tools/list": result={"tools":TOOLS}
    elif method=="tools/call":
        params=request.get("params",{})
        if params.get("name")=="bambu_fixture_delay": time.sleep(0.25)
        result={"content":[{"type":"text","text":"fixture"}],"structuredContent":{"ok":True,"version":VERSION,"name":params.get("name"),"arguments":params.get("arguments",{})}}
    elif "id" in request: result={}
    else: continue
    if "id" in request: print(json.dumps({"jsonrpc":"2.0","id":request["id"],"result":result}),flush=True)
`;
const fixtureTool = (name) => ({ name, description: "Fixture provider tool", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false } });
const v1Tools = [fixtureTool("bambu_fixture_old"), fixtureTool("bambu_fixture_delay")];
const v2Tools = [...v1Tools, fixtureTool("bambu_fixture_new")];
await fs.writeFile(fakeProvider, providerSource("1", v1Tools));
process.env.BRIDGE_BAMBU_MCP_SERVER_PATH = fakeProvider;
try {
  const status = await registry.call("bambu_mcp_status", {});
  assert.equal(status.ok, true);
  assert.equal(status.toolCount, 2);
  assert.equal(status.providerVersion.version, "1");
  const listed = await registry.call("bambu_mcp_tool_list", {});
  assert.equal(listed.tools[0].name, "bambu_fixture_old");
  await assert.rejects(() => registry.call("bambu_mcp_reconnect", { confirmation: "restart everything" }), /confirmation/);

  const sameSource = await registry.call("bambu_mcp_reconnect", { confirmation: "RECONNECT_BAMBU_PROVIDER" });
  assert.equal(sameSource.refreshed, false, "unchanged source must be an idempotent no-op");
  assert.equal(sameSource.generation, status.generation);

  const longCall = registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_fixture_delay", confirmToolName: "bambu_fixture_delay", arguments: { sequence: 1 },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await fs.writeFile(fakeProvider, providerSource("2", v2Tools));
  const refreshed = await registry.call("bambu_mcp_reconnect", { confirmation: "RECONNECT_BAMBU_PROVIDER" });
  const drainedCall = await longCall;
  assert.equal(drainedCall.version, "1", "in-flight call must finish against the old session");
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.providerVersion.version, "2");
  assert.equal(refreshed.toolCount, 3);
  assert.deepEqual(refreshed.addedToolNames, ["bambu_fixture_new"]);
  assert.notEqual(refreshed.sourceFingerprint, status.sourceFingerprint);

  const refreshedList = await registry.call("bambu_mcp_tool_list", {});
  assert.ok(refreshedList.tools.some((tool) => tool.name === "bambu_fixture_new"));
  const forwarded = await registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_fixture_new", confirmToolName: "bambu_fixture_new", arguments: { marker: "new-provider" },
  });
  assert.deepEqual(forwarded, { ok: true, version: "2", name: "bambu_fixture_new", arguments: { marker: "new-provider" } });
  await assert.rejects(() => registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_fixture_new", confirmToolName: "bambu_fixture_old", arguments: {},
  }), /must exactly match/);
  await assert.rejects(() => registry.call("bambu_mcp_tool_call", {
    toolName: "unknown_provider_tool", confirmToolName: "unknown_provider_tool", arguments: {},
  }), /does not expose/);

  const beforeConcurrent = (await registry.call("bambu_mcp_status", {})).generation;
  const concurrentRefreshes = await Promise.all([
    registry.call("bambu_mcp_reconnect", { confirmation: "RECONNECT_BAMBU_PROVIDER", force: true }),
    registry.call("bambu_mcp_reconnect", { confirmation: "RECONNECT_BAMBU_PROVIDER", force: true }),
  ]);
  assert.equal(concurrentRefreshes[0].generation, concurrentRefreshes[1].generation, "simultaneous refreshes must coalesce");
  assert.equal(concurrentRefreshes[0].generation, beforeConcurrent + 1, "coalesced refresh must create only one session");

  await fs.writeFile(fakeProvider, providerSource("3", v2Tools, 2_000));
  await assert.rejects(() => registry.call("bambu_mcp_reconnect", { confirmation: "RECONNECT_BAMBU_PROVIDER" }), /initialize timed out/);
  const afterTimeout = await registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_fixture_new", confirmToolName: "bambu_fixture_new", arguments: { timeoutRecovery: true },
  });
  assert.equal(afterTimeout.version, "2", "initialize timeout must leave the healthy provider usable");

  await fs.rm(fakeProvider);
  await assert.rejects(() => registry.call("bambu_mcp_reconnect", { confirmation: "RECONNECT_BAMBU_PROVIDER" }), /not found/);
  const afterFailure = await registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_fixture_new", confirmToolName: "bambu_fixture_new", arguments: { recovery: true },
  });
  assert.equal(afterFailure.version, "2", "failed replacement must leave the healthy provider usable");
} finally {
  if (previousProvider === undefined) delete process.env.BRIDGE_BAMBU_MCP_SERVER_PATH;
  else process.env.BRIDGE_BAMBU_MCP_SERVER_PATH = previousProvider;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousStartTimeout === undefined) delete process.env.BRIDGE_BAMBU_MCP_TEST_START_TIMEOUT_MS;
  else process.env.BRIDGE_BAMBU_MCP_TEST_START_TIMEOUT_MS = previousStartTimeout;
  await fs.rm(root, { recursive: true, force: true });
}
console.log("Bambu Bridge selective-reconnect contract PASS (versioned fake MCP only; drains calls, coalesces refresh, retains old session on failure; no printer access)");
process.exit(0);
