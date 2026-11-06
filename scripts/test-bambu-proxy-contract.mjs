import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDefaultToolCatalog, createDefaultToolRegistry } from "../dist/tool-registry.js";

const names = [
  "bambu_storage_list", "bambu_storage_download_save", "bambu_sliced_profile_inspect",
  "bambu_postprint_audit_save", "bambu_job_archive_sync", "bambu_media_index",
  "bambu_media_download_save", "bambu_media_video_inspect_save", "bambu_camera_snapshot_save",
  "bambu_device_probe", "bambu_device_status", "bambu_active_project_inspect",
];
const catalog = getDefaultToolCatalog();
const registry = createDefaultToolRegistry();
for (const name of names) {
  assert.equal(catalog.filter(tool => tool.name === name).length, 1, `${name} must appear exactly once`);
  assert.equal(registry.has(name), true, `${name} must have a handler`);
  assert.ok(catalog.find(tool => tool.name === name).inputSchema, `${name} must publish a schema`);
}
for (const name of ["bambu_storage_list", "bambu_sliced_profile_inspect", "bambu_media_index", "bambu_device_probe", "bambu_active_project_inspect"]) {
  assert.ok(registry.riskSummary.readOnly.includes(name), `${name} must be read-only`);
}
for (const name of ["bambu_storage_download_save", "bambu_postprint_audit_save", "bambu_job_archive_sync", "bambu_media_download_save", "bambu_media_video_inspect_save", "bambu_camera_snapshot_save", "bambu_device_status"]) {
  assert.ok(registry.riskSummary.neutral.includes(name), `${name} must remain non-destructive in the published risk contract`);
}
for (const name of ["bambu_storage_list", "bambu_storage_download_save", "bambu_job_archive_sync", "bambu_media_index", "bambu_media_download_save", "bambu_camera_snapshot_save"]) {
  assert.match(catalog.find(tool => tool.name === name).description, /trusted LAN/i, `${name} must disclose TLS trust boundary`);
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-bambu-fake-provider-"));
const fakeProvider = path.join(root, "fake-provider.py");
const previousProvider = process.env.BRIDGE_BAMBU_MCP_SERVER_PATH;
await fs.writeFile(fakeProvider, String.raw`import json, sys
for line in sys.stdin:
    try: request = json.loads(line)
    except Exception: continue
    method = request.get("method")
    if method == "initialize":
        result = {"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}
    elif method == "tools/list":
        result = {"tools":[{"name":"bambu_device_probe","inputSchema":{"type":"object","properties":{}}}]}
    elif method == "tools/call":
        params = request.get("params", {})
        result = {"content":[{"type":"text","text":"fixture"}],"structuredContent":{"ok":True,"name":params.get("name"),"arguments":params.get("arguments",{})}}
    elif "id" in request:
        result = {}
    else:
        continue
    if "id" in request:
        print(json.dumps({"jsonrpc":"2.0","id":request["id"],"result":result}), flush=True)
`);
process.env.BRIDGE_BAMBU_MCP_SERVER_PATH = fakeProvider;
try {
  const forwarded = await registry.call("bambu_device_probe", {});
  assert.deepEqual(forwarded, {ok:true,name:"bambu_device_probe",arguments:{}});
} finally {
  if (previousProvider === undefined) delete process.env.BRIDGE_BAMBU_MCP_SERVER_PATH;
  else process.env.BRIDGE_BAMBU_MCP_SERVER_PATH = previousProvider;
  await fs.rm(root, {recursive:true, force:true});
}
console.log("Bambu Bridge proxy catalog/schema/risk/security and fake-provider forwarding contract PASS (offline; no printer access)");
// The Bridge module intentionally caches its stdio provider link for process lifetime.
process.exit(0);
