import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultToolRegistry } from "../dist/tool-registry.js";

const registry = createDefaultToolRegistry();
const byName = new Map(registry.tools.map((tool) => [tool.name, tool]));

for (const name of ["remote_node_list", "remote_node_status", "remote_node_exec", "remote_node_upload_file"]) {
  assert.equal(registry.has(name), true, `missing tool ${name}`);
  assert.ok(byName.has(name), `missing schema ${name}`);
}

assert.equal(byName.get("remote_node_list")?.annotations?.readOnlyHint, true);
assert.equal(byName.get("remote_node_status")?.annotations?.readOnlyHint, true);
assert.equal(byName.get("remote_node_exec")?.annotations?.destructiveHint, true);
assert.equal(byName.get("remote_node_upload_file")?.annotations?.destructiveHint, true);

await assert.rejects(
  registry.call("remote_node_exec", {
    nodeId: "test-node",
    confirmNodeId: "other-node",
    command: "true",
  }),
  /confirmNodeId must exactly match 'test-node'/,
);

await assert.rejects(
  registry.call("remote_node_upload_file", {
    nodeId: "test-node",
    confirmNodeId: "other-node",
    localPath: "README.md",
    remotePath: "/tmp/test.txt",
  }),
  /confirmNodeId must exactly match 'test-node'/,
);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-remote-node-test-"));
const configPath = path.join(tempDir, "remote-nodes.json");
await fs.writeFile(configPath, JSON.stringify({
  schemaVersion: 1,
  nodes: [{
    id: "test-node",
    host: "127.0.0.1",
    port: 22,
    username: "nobody",
    identityFile: path.join(tempDir, "missing-key"),
    expectedHostKeySha256: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }],
}, null, 2));

const priorConfig = process.env.BRIDGE_REMOTE_NODES_FILE;
process.env.BRIDGE_REMOTE_NODES_FILE = configPath;
try {
  const listed = await registry.call("remote_node_list", {});
  assert.equal(listed.nodes.length, 1);
  assert.equal(listed.nodes[0].id, "test-node");
  assert.equal(listed.nodes[0].hostKeyPinned, true);
  assert.equal("identityFile" in listed.nodes[0], false, "private identity path must not be returned");

  await assert.rejects(
    registry.call("remote_node_status", { nodeId: "test-node", discover: false }),
    /\[remote-node-identity-missing\]/,
  );
} finally {
  if (priorConfig === undefined) delete process.env.BRIDGE_REMOTE_NODES_FILE;
  else process.env.BRIDGE_REMOTE_NODES_FILE = priorConfig;
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tools: ["remote_node_list", "remote_node_status", "remote_node_exec", "remote_node_upload_file"],
  risk: {
    readOnly: ["remote_node_list", "remote_node_status"],
    destructive: ["remote_node_exec", "remote_node_upload_file"],
  },
}));
