import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const compiledPath = process.env.BRIDGE_BLENDER_PROXY_TEST_BUILD
  ? path.resolve(process.env.BRIDGE_BLENDER_PROXY_TEST_BUILD)
  : path.join(root, "dist", "tools", "blender-standalone-proxy-tools.js");
const imported = await import(pathToFileURL(compiledPath).href);
const proxy = imported.blenderStandaloneProxyToolModule;
assert.equal(proxy.name, "blender-standalone-mcp-proxy");
assert.deepEqual(proxy.tools.map(tool => tool.name), ["blender_viewport_capture", "blender_session_snapshot"]);
const registry = fs.readFileSync(path.join(root, "src", "tool-registry.ts"), "utf8");
assert.match(registry, /import \{ blenderStandaloneProxyToolModule \}/);
assert.match(registry, /\s+blenderStandaloneProxyToolModule,\s*/);
for (const [name, moduleName, exportName] of [
  ["blender_viewport_capture", "viewport-capture", "blenderViewportCaptureTool"],
  ["blender_session_snapshot", "session-snapshot", "blenderSessionSnapshotTool"]
]) {
  const upstreamRoot = path.resolve(process.env.MAURO_BLENDER_MCP_ROOT || path.resolve(root, "..", "blender-mcp"));
  const upstreamPath = path.join(upstreamRoot, "dist", "src", "tools", moduleName + ".js");
  const upstream = (await import(pathToFileURL(upstreamPath).href))[exportName];
  const bridge = proxy.tools.find(tool => tool.name === name);
  assert.equal(upstream.name, bridge.name);
  assert.deepEqual(Object.keys(bridge.inputSchema.properties).sort(),
    Object.keys(upstream.inputSchema.properties).sort(), name + ": schema fields must stay in sync");
  assert.deepEqual([...bridge.inputSchema.required].sort(),
    [...upstream.inputSchema.required].sort(), name + ": required properties must stay in sync");
  for (const key of Object.keys(upstream.inputSchema.properties)) {
    for (const attribute of ["type", "minimum", "maximum", "default", "minLength"]) {
      assert.deepEqual(bridge.inputSchema.properties[key][attribute],
        upstream.inputSchema.properties[key][attribute], `${name}.${key}.${attribute}: schema drift`);
    }
  }
  assert.equal(typeof proxy.handlers[name], "function");
}
await assert.rejects(
  proxy.handlers.blender_session_snapshot({
    expectedBlendFile: "D:/Dev/blender-mcp/practice/kitsune_03_modelado.blend",
    outputBlendFile: "D:/Dev/blender-mcp/practice/kitsune_03_modelado.blend"
  }),
  /cannot be the active Blender file/
);
await assert.rejects(
  proxy.handlers.blender_viewport_capture({
    expectedScene: "Scene",
    expectedWorkspace: "Layout",
    outputPath: "D:/Dev/blender-mcp/output/should-not-be-written.blend"
  }),
  /Expected \.png output path/
);
const registryCompiledPath = path.join(root, "dist", "tool-registry.js");
if (fs.existsSync(registryCompiledPath)) {
  const liveRegistry = await import(pathToFileURL(registryCompiledPath).href);
  const catalog = liveRegistry.getDefaultToolCatalog();
  const summary = liveRegistry.createDefaultToolRegistry().riskSummary;
  for (const name of ["blender_viewport_capture", "blender_session_snapshot"]) {
    assert.equal(catalog.filter(tool => tool.name === name).length, 1, `exactly one ${name} in published catalog`);
    assert.ok(summary.destructive.includes(name), `${name} must be classified as a side-effectful Bridge tool`);
  }
}
console.log("Blender standalone proxy catalog contract PASS: schemas, registry, risk, ownership, safe rejection");
