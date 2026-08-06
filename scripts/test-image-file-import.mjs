import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-image-file-import-'));
const projectRoot = path.join(sandbox, 'project');
fs.mkdirSync(projectRoot, { recursive: true });
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [projectRoot, process.cwd()].join(path.delimiter);

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8bQAAAABJRU5ErkJggg==',
  'base64',
);
const expectedSha256 = crypto.createHash('sha256').update(pngBytes).digest('hex');

const server = http.createServer((request, response) => {
  if (request.url !== '/source.png') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'image/png',
    'content-length': String(pngBytes.length),
  });
  response.end(pngBytes);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const outputPath = path.join(projectRoot, 'imported.png');
  const manifestPath = path.join(projectRoot, 'manifest.json');

  const result = await registry.call('image_asset_import_files', {
    files: [{
      download_url: `http://127.0.0.1:${address.port}/source.png`,
      file_id: 'file_fixture_png',
      mime_type: 'image/png',
      file_name: 'source.png',
    }],
    targets: [{
      outputPath,
      role: 'front',
      source: 'fixture-authorized-file-param',
      metadata: { test: true },
    }],
    manifestPath,
    collectionName: 'fixture-authorized-file-import',
  });

  assert.equal(result.itemCount, 1);
  assert.equal(result.saved[0].sha256, expectedSha256);
  assert.equal(result.saved[0].mime, 'image/png');
  assert.equal(result.saved[0].width, 1);
  assert.equal(result.saved[0].height, 1);
  assert.deepEqual(fs.readFileSync(outputPath), pngBytes);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.items[0].sha256, expectedSha256);
  assert.equal(manifest.items[0].metadata.authorizedFile.fileId, 'file_fixture_png');
  assert.equal(manifest.items[0].metadata.authorizedFile.originalBytesPreserved, true);

  await assert.rejects(
    () => registry.call('image_asset_import_files', {
      files: [{
        download_url: 'http://example.com/source.png',
        file_id: 'file_insecure_url',
        mime_type: 'image/png',
        file_name: 'source.png',
      }],
      targets: [{ outputPath: path.join(projectRoot, 'insecure.png') }],
    }),
    /must use HTTPS/,
  );

  console.log(JSON.stringify({
    ok: true,
    outputPath,
    bytes: pngBytes.length,
    sha256: expectedSha256,
    dimensions: [1, 1],
    originalBytesPreserved: true,
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
