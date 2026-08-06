import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-image-persistence-'));
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);
process.env.NODE_ENV = 'test';
const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8bQAAAABJRU5ErkJggg==';
const pngBytes = Buffer.from(pngBase64, 'base64');
const pngSha = crypto.createHash('sha256').update(pngBytes).digest('hex');

try {
  const outputPath = path.join(sandbox, 'saved.png');
  const manifestPath = path.join(sandbox, 'manifest.json');
  const saved = await registry.call('image_asset_save', {
    items: [{ outputPath, base64: `data:image/png;base64,${pngBase64}`, role: 'front' }],
    manifestPath,
    collectionName: 'base64-smoke',
  });
  assert.equal(saved.itemCount, 1);
  assert.equal(saved.saved[0].sha256, pngSha);
  assert.equal(saved.transaction.atomic, true);
  assert.equal(saved.transaction.verifiedReadback, true);
  assert.deepEqual(fs.readFileSync(outputPath), pngBytes);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.items[0].sha256, pngSha);

  await assert.rejects(
    () => registry.call('image_asset_save', {
      items: [{ outputPath: path.join(sandbox, 'invalid.png'), base64: 'not@@base64' }],
    }),
    /\[invalid-image-payload\]/,
  );

  const originalImage = Buffer.from(pngBytes);
  const rollbackImage = path.join(sandbox, 'rollback.png');
  const secondImage = path.join(sandbox, 'second.png');
  const rollbackManifest = path.join(sandbox, 'rollback-manifest.json');
  const originalManifest = Buffer.from('{"original":true}\n');
  fs.writeFileSync(rollbackImage, originalImage);
  fs.writeFileSync(rollbackManifest, originalManifest);
  process.env.BRIDGE_MCP_TEST_IMAGE_FAIL_AFTER_COMMITS = '1';
  await assert.rejects(
    () => registry.call('image_asset_save', {
      overwrite: true,
      items: [
        { outputPath: rollbackImage, base64: pngBase64 },
        { outputPath: secondImage, base64: pngBase64 },
      ],
      manifestPath: rollbackManifest,
      collectionName: 'rollback-regression',
    }),
    /Atomic image persistence rolled back/,
  );
  delete process.env.BRIDGE_MCP_TEST_IMAGE_FAIL_AFTER_COMMITS;
  assert.deepEqual(fs.readFileSync(rollbackImage), originalImage, 'overwritten image must be restored');
  assert.deepEqual(fs.readFileSync(rollbackManifest), originalManifest, 'existing manifest must be restored');
  assert.equal(fs.existsSync(secondImage), false, 'uncommitted image must not remain');
  assert.equal(fs.readdirSync(sandbox).some((name) => name.includes('.bridge-') && /\.(tmp|bak)$/.test(name)), false);

  console.log(JSON.stringify({ ok: true, cases: ['valid-base64-save', 'strict-invalid-base64', 'atomic-batch-manifest-rollback'] }, null, 2));
} finally {
  delete process.env.BRIDGE_MCP_TEST_IMAGE_FAIL_AFTER_COMMITS;
  fs.rmSync(sandbox, { recursive: true, force: true });
}
