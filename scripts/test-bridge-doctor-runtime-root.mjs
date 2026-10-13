import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('bridge doctor runtime-root test skipped: Windows PowerShell is unavailable');
  process.exit(0);
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-doctor-runtime-root-'));
const codeRoot = path.join(testRoot, 'code');
const runtimeRoot = path.join(testRoot, 'runtime');
const doctorPath = path.resolve('scripts', 'bridge-doctor.ps1');

function writeRestartEvidence(root) {
  fs.writeFileSync(path.join(root, '.bridge-restart-request'), JSON.stringify({ action: 'restart' }));
  fs.writeFileSync(path.join(root, '.bridge-restart-ack'), JSON.stringify({
    action: 'restart',
    acknowledgedAt: '2026-10-13T04:10:19Z',
    watchdogPid: 1,
  }));
}

function runDoctor(runtimeDataRoot) {
  const args = [
    '-NoProfile',
    '-File', doctorPath,
    '-ProjectRoot', codeRoot,
    '-ExpectedServerVersion', '0.6.177',
    '-BridgePort', '65533',
    '-SkipTunnelChecks',
  ];
  if (runtimeDataRoot !== undefined) args.push('-RuntimeDataRoot', runtimeDataRoot);
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`bridge doctor terminated by ${result.signal}`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

try {
  fs.mkdirSync(codeRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(codeRoot, 'package.json'), JSON.stringify({ version: '0.6.177' }));
  writeRestartEvidence(runtimeRoot);

  const explicitRootOutput = runDoctor(runtimeRoot);
  assert.ok(
    explicitRootOutput.includes(`request exists: True path=${path.join(runtimeRoot, '.bridge-restart-request')}`),
    'explicit RuntimeDataRoot should report the request found in the runtime root',
  );
  assert.ok(
    explicitRootOutput.includes(`ack exists:     True path=${path.join(runtimeRoot, '.bridge-restart-ack')}`),
    'explicit RuntimeDataRoot should report the acknowledgement found in the runtime root',
  );

  writeRestartEvidence(codeRoot);
  const defaultRootOutput = runDoctor(undefined);
  assert.ok(
    defaultRootOutput.includes(`request exists: True path=${path.join(codeRoot, '.bridge-restart-request')}`),
    'omitting RuntimeDataRoot should find the restart request under the ProjectRoot default',
  );
  assert.ok(
    defaultRootOutput.includes(`ack exists:     True path=${path.join(codeRoot, '.bridge-restart-ack')}`),
    'omitting RuntimeDataRoot should find the acknowledgement under the ProjectRoot default',
  );

  console.log('bridge doctor runtime-root routing passed (explicit split roots and ProjectRoot default)');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
