import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-snapshot-quota-'));
const projectRoot = path.join(sandbox, 'project');
const snapshotRoot = path.join(sandbox, 'snapshots');
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'payload.bin'), Buffer.alloc(600 * 1024, 0x41));

process.env.BRIDGE_MCP_SNAPSHOT_DIR = snapshotRoot;
process.env.BRIDGE_MCP_SNAPSHOT_MAX_STORAGE_BYTES = String(1024 * 1024);
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

const { workspaceToolModule } = await import('../dist/tools/workspace-tools.js');
const snapshot = workspaceToolModule.handlers.workspace_snapshot;
const list = workspaceToolModule.handlers.workspace_snapshot_list;

try {
  const concurrent = await Promise.allSettled([
    snapshot({ projectRoot, label: 'quota-concurrent-a' }),
    snapshot({ projectRoot, label: 'quota-concurrent-b' }),
  ]);
  const fulfilled = concurrent.filter((item) => item.status === 'fulfilled');
  const rejected = concurrent.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'quota check must serialize concurrent snapshot creation');
  assert.equal(rejected.length, 1, 'one concurrent snapshot must be rejected by the aggregate quota');
  assert.match(String(rejected[0].reason), /storage quota exceeded.*Existing snapshots were preserved/i);

  const first = fulfilled[0].value;
  assert.equal(first.created, true);
  assert.equal(first.verified, true);

  const afterConcurrent = await list({ limit: 20 });
  assert.equal(afterConcurrent.count, 1);
  assert.equal(afterConcurrent.storage.limitBytes, 1024 * 1024);
  assert.ok(afterConcurrent.storage.bytes >= 600 * 1024);
  assert.ok(afterConcurrent.storage.remainingBytes < afterConcurrent.storage.limitBytes);

  await assert.rejects(
    () => snapshot({ projectRoot, label: 'quota-later' }),
    /storage quota exceeded.*Existing snapshots were preserved/i,
  );

  const afterRejected = await list({ limit: 20 });
  assert.equal(afterRejected.count, 1, 'rejected snapshot must not delete or add history');
  assert.equal(afterRejected.snapshots[0].id, first.snapshot.id);
  assert.equal(fs.readdirSync(snapshotRoot).length, 1, 'failed snapshot directories must be cleaned up');
  console.log('workspace snapshot storage quota regression: PASS');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
