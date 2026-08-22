import fs from "node:fs/promises";
import path from "node:path";
import { createDefaultToolRegistry } from "../dist/tool-registry.js";

const nodeId = process.argv[2]?.trim();
if (!nodeId) throw new Error("Usage: node scripts/test-remote-node-live.mjs <configured-node-id>");

const registry = createDefaultToolRegistry();
const status = await registry.call("remote_node_status", {
  nodeId,
  discover: true,
  connectTimeoutMs: 5000,
});
const exec = await registry.call("remote_node_exec", {
  nodeId,
  confirmNodeId: nodeId,
  command: "printf bridge-remote-ok",
  discover: true,
  timeoutMs: 5000,
});

if (exec.exitCode !== 0 || exec.timedOut || exec.stdout !== "bridge-remote-ok") {
  throw new Error(`remote exec smoke failed: ${JSON.stringify(exec)}`);
}

const localSmoke = path.resolve("sandbox", "remote-node-smoke.txt");
const remoteSmoke = "/tmp/bridge-remote-node-smoke.txt";
const payload = `bridge-remote-upload-ok-${Date.now()}\n`;
await fs.mkdir(path.dirname(localSmoke), { recursive: true });
await fs.writeFile(localSmoke, payload, "utf8");
let upload;
let readback;
try {
  upload = await registry.call("remote_node_upload_file", {
    nodeId,
    confirmNodeId: nodeId,
    localPath: localSmoke,
    remotePath: remoteSmoke,
    overwrite: true,
    discover: true,
  });
  readback = await registry.call("remote_node_exec", {
    nodeId,
    confirmNodeId: nodeId,
    command: `wc -c < ${remoteSmoke} && cat ${remoteSmoke}`,
    discover: true,
    timeoutMs: 5000,
  });
  if (readback.exitCode !== 0 || !readback.stdout.includes(payload.trim())) {
    throw new Error(`remote upload readback failed: ${JSON.stringify(readback)}`);
  }
} finally {
  await registry.call("remote_node_exec", {
    nodeId,
    confirmNodeId: nodeId,
    command: `rm -f ${remoteSmoke}`,
    discover: true,
    timeoutMs: 5000,
  }).catch(() => undefined);
  await fs.rm(localSmoke, { force: true });
}

console.log(JSON.stringify({
  ok: true,
  status,
  exec: { exitCode: exec.exitCode, timedOut: exec.timedOut, stdout: exec.stdout, durationMs: exec.durationMs },
  upload: { verified: upload?.verified, bytes: upload?.bytes, readback: readback?.stdout.trim() },
}));
