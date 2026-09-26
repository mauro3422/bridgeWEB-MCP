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

const { createDefaultToolRegistry, createToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();
const actionTool = registry.tools.find((tool) => tool.name === 'bridge_tool_action');
assert(actionTool, 'bridge_tool_action schema missing');
assert.deepEqual(actionTool._meta?.['openai/fileParams'], ['files']);
assert(actionTool.inputSchema?.properties?.files, 'bridge_tool_action top-level files schema missing');

const genericFileRegistry = createToolRegistry([{
  name: 'fixture-file-param-module',
  tools: [{
    name: 'fixture_file_param_action',
    description: 'Fixture action proving generic authorized file passthrough.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array' },
        marker: { type: 'string' },
      },
      required: ['files'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    _meta: { 'openai/fileParams': ['files'] },
  }],
  handlers: {
    fixture_file_param_action: async (args) => ({
      fileCount: Array.isArray(args.files) ? args.files.length : 0,
      marker: args.marker,
      firstFileId: Array.isArray(args.files) ? args.files[0]?.file_id : undefined,
    }),
  },
}]);
const genericWrapperResult = await genericFileRegistry.call('bridge_tool_action', {
  toolName: 'fixture_file_param_action',
  confirmToolName: 'fixture_file_param_action',
  files: [{ download_url: 'https://example.invalid/file.bin', file_id: 'file_fixture_generic' }],
  arguments: { marker: 'generic-pass' },
});
assert.equal(genericWrapperResult.delegatedTool, 'fixture_file_param_action');
assert.equal(genericWrapperResult.classification, 'destructive');
assert.equal(genericWrapperResult.result.fileCount, 1);
assert.equal(genericWrapperResult.result.firstFileId, 'file_fixture_generic');
assert.equal(genericWrapperResult.result.marker, 'generic-pass');

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

  const wrapperOutputPath = path.join(projectRoot, 'imported-via-wrapper.png');
  const wrapperManifestPath = path.join(projectRoot, 'wrapper-manifest.json');
  const wrapperResult = await registry.call('bridge_tool_action', {
    toolName: 'image_asset_import_files',
    confirmToolName: 'image_asset_import_files',
    files: [{
      download_url: `http://127.0.0.1:${address.port}/source.png`,
      file_id: 'file_fixture_wrapper_png',
      mime_type: 'image/png',
      file_name: 'source.png',
    }],
    arguments: {
      targets: [{
        outputPath: wrapperOutputPath,
        role: 'reference-board',
        source: 'fixture-wrapper-authorized-file-param',
      }],
      manifestPath: wrapperManifestPath,
      collectionName: 'fixture-wrapper-authorized-file-import',
    },
  });
  assert.equal(wrapperResult.delegatedTool, 'image_asset_import_files');
  assert.equal(wrapperResult.classification, 'destructive');
  assert.equal(wrapperResult.result.itemCount, 1);
  assert.equal(wrapperResult.result.saved[0].sha256, expectedSha256);
  assert.deepEqual(fs.readFileSync(wrapperOutputPath), pngBytes);

  await assert.rejects(
    () => registry.call('bridge_tool_action', {
      toolName: 'write_text_file',
      confirmToolName: 'write_text_file',
      files: [{
        download_url: `http://127.0.0.1:${address.port}/source.png`,
        file_id: 'file_wrong_delegate',
      }],
      arguments: { path: path.join(projectRoot, 'should-not-write.txt'), content: 'x' },
    }),
    /does not declare an authorized top-level files parameter/,
  );

  await assert.rejects(
    () => registry.call('bridge_tool_action', {
      toolName: 'image_asset_import_files',
      confirmToolName: 'image_asset_import_files',
      files: [{
        download_url: `http://127.0.0.1:${address.port}/source.png`,
        file_id: 'file_duplicate_top_level',
      }],
      arguments: {
        files: [{
          download_url: `http://127.0.0.1:${address.port}/source.png`,
          file_id: 'file_duplicate_nested',
        }],
        targets: [{ outputPath: path.join(projectRoot, 'duplicate.png') }],
      },
    }),
    /either through top-level files or arguments\.files, not both/,
  );

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
