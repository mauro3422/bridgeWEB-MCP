import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-storage-auditor-'));
const root = path.join(sandbox, 'root');
const state = path.join(sandbox, 'state');
const port = 31479;
fs.mkdirSync(path.join(root, 'target-test', 'debug'), { recursive: true });
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'target-test', 'debug', 'artifact.bin'), 'x'.repeat(20));
fs.writeFileSync(path.join(root, 'evidence', 'proof.png'), 'x'.repeat(10));

const child = spawn(process.execPath, ['scripts/storage-auditor-app.mjs', `--port=${port}`], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    STORAGE_AUDITOR_DEV_ROOT: root,
    STORAGE_AUDITOR_DRIVE_ROOT: root,
    BRIDGE_MCP_ALLOWED_ROOTS: [sandbox, process.cwd()].join(path.delimiter),
    BRIDGE_MCP_STORAGE_GROWTH_DIR: state,
  },
});
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return await response.text();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Storage Auditor did not start. stdout=${stdout} stderr=${stderr}`);
}

try {
  const html = await waitForReady();
  assert.match(html, /Storage Auditor/);
  assert.match(html, /nunca borra archivos/i);

  const baselineResponse = await fetch(`http://127.0.0.1:${port}/api/scan?scope=dev&mode=baseline`);
  assert.equal(baselineResponse.ok, true);
  const baseline = await baselineResponse.json();
  assert.equal(baseline.strategy, 'baseline-full');
  assert.equal(baseline.audit.policy.automaticDeletion, false);
  assert.equal(baseline.audit.hotspots.find((item) => item.directory === 'target-test')?.disposition, 'safe-regenerable');
  assert.equal(baseline.audit.hotspots.find((item) => item.directory === 'evidence')?.disposition, 'preserve');
  assert.equal(typeof baseline.system.driveSpace.freeBytes, 'number');

  fs.writeFileSync(path.join(root, 'target-test', 'debug', 'artifact.bin'), 'x'.repeat(44));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/scan?scope=dev&mode=auto`);
  assert.equal(updateResponse.ok, true);
  const update = await updateResponse.json();
  assert.equal(update.strategy, 'incremental-watcher');
  assert.ok(update.growth.some((item) => item.path.endsWith('artifact.bin') && item.deltaBytes === 24 && item.disposition === 'safe-regenerable'));

  console.log(JSON.stringify({ ok: true, strategy: update.strategy, deltaBytes: update.totals.deltaBytes, hotspotCount: update.audit.hotspots.length }, null, 2));
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
