import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-storage-growth-'));
const root = path.join(sandbox, 'watched-root');
const state = path.join(sandbox, 'state');
fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
const trackedFile = path.join(root, 'a.txt');
const knownMtime = new Date('2026-09-24T12:34:56.000Z');
fs.writeFileSync(trackedFile, '1234567890');
fs.utimesSync(trackedFile, knownMtime, knownMtime);
fs.writeFileSync(path.join(root, 'nested', 'b.bin'), '12345');
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);
process.env.BRIDGE_MCP_STORAGE_GROWTH_DIR = state;

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const { closeStorageGrowthWatchersForTests } = await import('../dist/tools/storage-growth-tools.js');
const registry = createDefaultToolRegistry();

try {
  assert.equal(registry.has('storage_growth_scan'), true);
  const schema = registry.tools.find((tool) => tool.name === 'storage_growth_scan');
  assert.equal(schema?.annotations?.readOnlyHint, true);

  const baseline = await registry.call('storage_growth_scan', { path: root, mode: 'baseline', top: 10, groupDepth: 3, maxEntries: 1000 });
  assert.equal(baseline.strategy, 'baseline-full');
  assert.equal(baseline.coverage.snapshotComplete, true);
  assert.equal(baseline.totals.files, 2);
  assert.equal(baseline.totals.bytes, 15);

  const status = await registry.call('storage_growth_scan', { path: root, mode: 'status', top: 10, groupDepth: 3, maxEntries: 1000 });
  assert.equal(status.strategy, 'status-only');
  assert.equal(status.baselineAvailable, true);
  assert.equal(status.totals.scannedDirectoriesThisPass, 0);
  assert.match(status.coverage.limitation, /without traversing/i);

  const trackedBaseline = baseline.largestFiles.find((item) => item.file === 'a.txt');
  assert.ok(trackedBaseline);
  assert.ok(Math.abs(trackedBaseline.mtimeMs - knownMtime.getTime()) < 2_000, `baseline mtime mismatch: ${trackedBaseline.mtimeMs}`);

  fs.writeFileSync(path.join(root, 'a.txt'), 'x'.repeat(30));
  fs.writeFileSync(path.join(root, 'nested', 'c.dat'), '1234567');
  await new Promise((resolve) => setTimeout(resolve, 350));

  const update = await registry.call('storage_growth_scan', { path: root, mode: 'auto', top: 10, groupDepth: 3, maxEntries: 1000 });
  assert.equal(update.strategy, 'incremental-watcher');
  assert.equal(update.totals.bytes, 42);
  assert.equal(update.totals.deltaBytes, 27);
  assert.equal(update.coverage.snapshotComplete, true);
  assert.ok(update.coverage.dirtyPathsProcessed >= 1);
  assert.ok(update.growth.some((item) => item.path === 'a.txt' && item.deltaBytes === 20));
  assert.ok(update.growth.some((item) => item.path === 'nested/c.dat' && item.deltaBytes === 7));

  const unchanged = await registry.call('storage_growth_scan', { path: root, mode: 'auto', top: 10, groupDepth: 3, maxEntries: 1000 });
  assert.equal(unchanged.strategy, 'incremental-watcher');
  assert.equal(unchanged.totals.deltaBytes, 0);
  assert.equal(unchanged.totals.scannedDirectoriesThisPass, 0);

  const auditRoot = path.join(sandbox, 'audit-root');
  fs.mkdirSync(path.join(auditRoot, '.mssr', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(auditRoot, 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(auditRoot, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(auditRoot, '.mssr', 'runtime', 'ephemeral.bin'), 'x'.repeat(11));
  fs.writeFileSync(path.join(auditRoot, 'evidence', 'proof.png'), 'x'.repeat(13));
  fs.writeFileSync(path.join(auditRoot, 'logs', 'old.log'), 'x'.repeat(17));
  const audited = await registry.call('storage_growth_scan', { path: auditRoot, mode: 'baseline', top: 20, groupDepth: 3, maxEntries: 1000 });
  assert.equal(audited.audit.policy.automaticDeletion, false);
  assert.equal(audited.audit.hotspots.find((item) => item.directory === '.mssr/runtime')?.disposition, 'safe-regenerable');
  assert.equal(audited.audit.hotspots.find((item) => item.directory === 'evidence')?.disposition, 'preserve');
  assert.equal(audited.audit.hotspots.find((item) => item.directory === 'logs')?.disposition, 'review');

  let skewedFiles = null;
  if (process.platform === 'win32') {
    const skewedRoot = path.join(sandbox, 'skewed-root');
    for (let bucket = 0; bucket < 6; bucket += 1) {
      const dir = path.join(skewedRoot, `bucket-${bucket}`);
      fs.mkdirSync(dir, { recursive: true });
      const count = bucket === 0 ? 80 : 1;
      for (let index = 0; index < count; index += 1) {
        fs.writeFileSync(path.join(dir, `file-${String(index).padStart(3, '0')}.dat`), 'x');
      }
    }

    const customTarget = path.join(skewedRoot, 'bucket-1', 'target-f3-gate');
    const customTargetDeps = path.join(customTarget, 'debug', 'deps');
    fs.mkdirSync(customTargetDeps, { recursive: true });
    fs.writeFileSync(path.join(customTarget, 'probe.bin'), 'abc');
    fs.writeFileSync(path.join(customTargetDeps, 'probe-dep.bin'), '1234');

    const skewed = await registry.call('storage_growth_scan', { path: skewedRoot, mode: 'baseline', top: 10, groupDepth: 2, maxEntries: 100 });
    assert.equal(skewed.coverage.snapshotComplete, true, 'unused worker capacity should be redistributed to a larger partition');
    assert.equal(skewed.totals.files, 87);
    assert.equal(skewed.categories.find((item) => item.category === 'build-output')?.bytes, 7, 'target-* Cargo output, including nested deps, should classify as build-output');
    skewedFiles = skewed.totals.files;

    for (let index = 80; index < 120; index += 1) {
      fs.writeFileSync(path.join(skewedRoot, 'bucket-0', `file-${String(index).padStart(3, '0')}.dat`), 'x');
    }
    const capped = await registry.call('storage_growth_scan', { path: skewedRoot, mode: 'baseline', top: 10, groupDepth: 2, maxEntries: 100 });
    assert.equal(capped.coverage.snapshotComplete, false, 'a genuinely over-limit tree must remain incomplete');
    assert.equal(capped.totals.files, 100);
  }

  console.log(JSON.stringify({ ok: true, baselineBytes: baseline.totals.bytes, updatedBytes: update.totals.bytes, deltaBytes: update.totals.deltaBytes, dirtyPathsProcessed: update.coverage.dirtyPathsProcessed, skewedFiles }, null, 2));
} finally {
  closeStorageGrowthWatchersForTests();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
