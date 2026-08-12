import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function makeWav({ seconds = 1, sampleRate = 16000 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 2200);
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-media-review-'));
const projectRoot = path.join(sandbox, 'project');
fs.mkdirSync(projectRoot, { recursive: true });
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [projectRoot, process.cwd()].join(path.delimiter);

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();
const tool = registry.tools.find((candidate) => candidate.name === 'media_review_ingest');
assert(tool, 'media_review_ingest must be registered');
assert.deepEqual(tool._meta?.['openai/fileParams'], ['files']);
assert.equal(tool.annotations?.readOnlyHint, false);
assert.equal(tool.annotations?.destructiveHint, true);

const wavBytes = makeWav();
const expectedSha256 = crypto.createHash('sha256').update(wavBytes).digest('hex');
const server = http.createServer((request, response) => {
  if (request.url !== '/source.wav') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'audio/wav',
    'content-length': String(wavBytes.length),
  });
  response.end(wavBytes);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const outputDir = path.join(projectRoot, 'review');
  const result = await registry.call('media_review_ingest', {
    files: [{
      download_url: `http://127.0.0.1:${address.port}/source.wav`,
      file_id: 'file_fixture_wav',
      mime_type: 'audio/wav',
      file_name: 'source.wav',
    }],
    outputDir,
    transcribe: false,
    attachPreviewFrames: false,
    keepAudio: false,
    keepSource: false,
    timeoutMs: 120000,
  });

  assert.equal(result.source.fileId, 'file_fixture_wav');
  assert.equal(result.source.sha256, expectedSha256);
  assert.equal(result.source.detectedContainer, 'wav');
  assert.equal(result.source.originalBytesPreserved, true);
  assert.equal(result.source.persistedSourcePath, null);
  assert.equal(result.audio.hasAudio, true);
  assert.equal(result.video.hasVideo, false);
  assert.equal(result.durationSeconds, 1);
  assert.equal(result.transcription.enabled, false);
  assert.equal(result.externalProcessing.audioSentExternally, false);
  assert.equal(result.frames.length, 0);
  assert.equal(result.previewFramesAttached.length, 0);
  assert.equal(fs.existsSync(result.reviewPath), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'source.wav')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'audio_16k_mono.wav')), false);

  const manifest = JSON.parse(fs.readFileSync(result.reviewPath, 'utf8'));
  assert.equal(manifest.source.sha256, expectedSha256);
  assert.equal(manifest.sourcePath, null);
  assert.equal(manifest.externalProcessing.audioSentExternally, false);

  await assert.rejects(
    () => registry.call('media_review_ingest', {
      files: [{
        download_url: 'http://example.com/source.wav',
        file_id: 'file_insecure_media',
        mime_type: 'audio/wav',
        file_name: 'source.wav',
      }],
      outputDir: path.join(projectRoot, 'unsafe'),
      transcribe: false,
    }),
    /must use HTTPS/,
  );

  await assert.rejects(
    () => registry.call('media_review_ingest', {
      files: [{
        download_url: `http://127.0.0.1:${address.port}/source.wav`,
        file_id: 'file_mime_mismatch',
        mime_type: 'video/mp4',
        file_name: 'fake.mp4',
      }],
      outputDir: path.join(projectRoot, 'mismatch'),
      transcribe: false,
    }),
    /MIME mismatch/,
  );

  console.log(JSON.stringify({
    ok: true,
    tool: 'media_review_ingest',
    bytes: wavBytes.length,
    sha256: expectedSha256,
    durationSeconds: result.durationSeconds,
    externalAsrUsed: result.externalProcessing.audioSentExternally,
    reviewPath: result.reviewPath,
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
