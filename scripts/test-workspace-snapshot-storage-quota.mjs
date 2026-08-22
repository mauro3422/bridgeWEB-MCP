import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-snapshot-retention-'));
const projectA = path.join(sandbox, 'project-a');
const projectB = path.join(sandbox, 'project-b');
const projectTruncated = path.join(sandbox, 'project-truncated');
const projectTooLarge = path.join(sandbox, 'project-too-large');
const snapshotRoot = path.join(sandbox, 'snapshots');
for (const root of [projectA, projectB, projectTruncated, projectTooLarge]) fs.mkdirSync(root, { recursive: true });

fs.writeFileSync(path.join(projectA, 'payload.bin'), Buffer.alloc(600 * 1024, 0x41));
fs.writeFileSync(path.join(projectA, 'meta.txt'), 'project-a\n');
fs.writeFileSync(path.join(projectB, 'payload.bin'), Buffer.alloc(32 * 1024, 0x42));
fs.writeFileSync(path.join(projectTruncated, 'a.txt'), 'a\n');
fs.writeFileSync(path.join(projectTruncated, 'b.txt'), 'b\n');
fs.writeFileSync(path.join(projectTooLarge, 'payload.bin'), Buffer.alloc(600 * 1024, 0x43));

const storageLimit = 1536 * 1024;
process.env.BRIDGE_MCP_SNAPSHOT_DIR = snapshotRoot;
process.env.BRIDGE_MCP_SNAPSHOT_MAX_STORAGE_BYTES = String(storageLimit);
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

const { workspaceToolModule } = await import('../dist/tools/workspace-tools.js');
const snapshot = workspaceToolModule.handlers.workspace_snapshot;
const list = workspaceToolModule.handlers.workspace_snapshot_list;

const forRoot = (listing, root) => listing.snapshots.filter((item) => path.resolve(item.sourceRoot) === path.resolve(root));
const labels = (items) => new Set(items.map((item) => item.label));

try {
  const a1 = await snapshot({ projectRoot: projectA, label: 'a1' });
  const a2 = await snapshot({ projectRoot: projectA, label: 'a2' });
  const a3 = await snapshot({ projectRoot: projectA, label: 'a3' });
  assert.equal(a1.verified && a2.verified && a3.verified, true);
  assert.equal(a3.retention.after.removedCount, 1, 'third complete snapshot should rotate the oldest complete fallback');
  assert.ok(a3.retention.transientProjectedBytes > storageLimit, 'test must exercise a transient over-quota write');
  assert.ok(a3.retention.steadyStateProjectedBytes <= storageLimit, 'post-retention projection must remain within quota');

  let listing = await list({ limit: 50 });
  assert.deepEqual(listing.retention, { completePerProject: 2, truncatedPerProject: 1 });
  let aSnapshots = forRoot(listing, projectA);
  assert.equal(aSnapshots.length, 2);
  assert.deepEqual(labels(aSnapshots), new Set(['a2', 'a3']));
  assert.ok(!fs.existsSync(a1.storagePath), 'oldest complete snapshot directory should be removed');

  const concurrent = await Promise.all([
    snapshot({ projectRoot: projectA, label: 'a4' }),
    snapshot({ projectRoot: projectA, label: 'a5' }),
  ]);
  assert.ok(concurrent.every((item) => item.verified), 'serialized concurrent creation should retain and rotate instead of racing quota');
  listing = await list({ limit: 50 });
  aSnapshots = forRoot(listing, projectA);
  assert.equal(aSnapshots.length, 2);
  assert.deepEqual(labels(aSnapshots), new Set(['a4', 'a5']));

  const truncated1 = await snapshot({ projectRoot: projectTruncated, label: 'truncated-1', maxFiles: 1 });
  const truncated2 = await snapshot({ projectRoot: projectTruncated, label: 'truncated-2', maxFiles: 1 });
  assert.equal(truncated1.snapshot.truncated, true);
  assert.equal(truncated2.snapshot.truncated, true);
  listing = await list({ limit: 50 });
  const truncatedSnapshots = forRoot(listing, projectTruncated);
  assert.equal(truncatedSnapshots.length, 1, 'truncated diagnostics should retain only their newest generation');
  assert.equal(truncatedSnapshots[0].label, 'truncated-2');
  assert.equal(truncatedSnapshots[0].truncated, true);

  await snapshot({ projectRoot: projectB, label: 'b1' });
  await snapshot({ projectRoot: projectB, label: 'b2' });
  await snapshot({ projectRoot: projectB, label: 'b3' });
  listing = await list({ limit: 50 });
  const bSnapshots = forRoot(listing, projectB);
  assert.equal(bSnapshots.length, 2, 'retention must be independent per sourceRoot');
  assert.deepEqual(labels(bSnapshots), new Set(['b2', 'b3']));
  assert.deepEqual(labels(forRoot(listing, projectA)), new Set(['a4', 'a5']), 'rotating another project must not evict project A fallbacks');

  const countBeforeRejected = listing.count;
  await assert.rejects(
    () => snapshot({ projectRoot: projectTooLarge, label: 'too-large' }),
    /storage quota exceeded after automatic retention/i,
  );
  const afterRejected = await list({ limit: 50 });
  assert.equal(afterRejected.count, countBeforeRejected, 'a true post-retention quota failure must preserve retained history');
  assert.equal(forRoot(afterRejected, projectTooLarge).length, 0);
  assert.ok(afterRejected.storage.bytes <= afterRejected.storage.limitBytes);
  assert.equal(fs.readdirSync(snapshotRoot).length, afterRejected.count, 'failed snapshot directory must be cleaned up');

  console.log('workspace snapshot retention/quota regression: PASS');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
