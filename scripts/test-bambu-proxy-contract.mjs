import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDefaultToolCatalog, createDefaultToolRegistry } from "../dist/tool-registry.js";

const catalog = getDefaultToolCatalog();
const registry = createDefaultToolRegistry();
const names = ["bambu_mcp_status", "bambu_mcp_tool_list", "bambu_mcp_tool_call"];
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
for (const oldTool of ["bambu_project_inspect", "bambu_slice_headless_save", "bambu_history_start", "bambu_device_status"]) {
  assert.equal(registry.has(oldTool), false, `${oldTool} must remain owned by the provider, not Bridge`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-bambu-fake-provider-"));
const fakeProvider = path.join(root, "fake-provider.py");
const previousProvider = process.env.BRIDGE_BAMBU_MCP_SERVER_PATH;
await fs.writeFile(fakeProvider, String.raw`import json
TOOLS=[{"name":"bambu_slice_estimate_save","description":"Provider-owned slice estimate","inputSchema":{"type":"object","properties":{"inputPath":{"type":"string"}},"required":["inputPath"]},"annotations":{"readOnlyHint":False,"destructiveHint":False}}]
for line in __import__("sys").stdin:
    try: request=json.loads(line)
    except Exception: continue
    method=request.get("method")
    if method=="initialize": result={"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}
    elif method=="tools/list": result={"tools":TOOLS}
    elif method=="tools/call":
        params=request.get("params",{})
        result={"content":[{"type":"text","text":"fixture"}],"structuredContent":{"ok":True,"name":params.get("name"),"arguments":params.get("arguments",{})}}
    elif "id" in request: result={}
    else: continue
    if "id" in request: print(json.dumps({"jsonrpc":"2.0","id":request["id"],"result":result}),flush=True)
`);
process.env.BRIDGE_BAMBU_MCP_SERVER_PATH = fakeProvider;
try {
  const status = await registry.call("bambu_mcp_status", {});
  assert.equal(status.ok, true);
  assert.equal(status.toolCount, 1);
  const listed = await registry.call("bambu_mcp_tool_list", {});
  assert.equal(listed.tools[0].name, "bambu_slice_estimate_save");
  assert.equal(listed.tools[0].inputSchema.required[0], "inputPath", "provider owns the live schema");
  const forwarded = await registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_slice_estimate_save",
    confirmToolName: "bambu_slice_estimate_save",
    arguments: { inputPath: "qa/sample.3mf" },
  });
  assert.deepEqual(forwarded, { ok: true, name: "bambu_slice_estimate_save", arguments: { inputPath: "qa/sample.3mf" } });
  await assert.rejects(() => registry.call("bambu_mcp_tool_call", {
    toolName: "bambu_slice_estimate_save", confirmToolName: "bambu_device_status", arguments: {},
  }), /must exactly match/);
  await assert.rejects(() => registry.call("bambu_mcp_tool_call", {
    toolName: "unknown_provider_tool", confirmToolName: "unknown_provider_tool", arguments: {},
  }), /does not expose/);
} finally {
  if (previousProvider === undefined) delete process.env.BRIDGE_BAMBU_MCP_SERVER_PATH;
  else process.env.BRIDGE_BAMBU_MCP_SERVER_PATH = previousProvider;
  await fs.rm(root, { recursive: true, force: true });
}
console.log("Bambu Bridge single-connection contract PASS (live schemas and behavior remain provider-owned; fake MCP only; no printer access)");
process.exit(0);
