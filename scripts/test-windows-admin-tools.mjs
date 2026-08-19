import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDefaultToolRegistry } from '../dist/tool-registry.js';
import { assertCommandAllowed } from '../dist/tools/shared/process.js';

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-windows-admin-test-'));
process.env.LOCALAPPDATA = path.join(sandbox, 'AppData', 'Local');
process.env.WINDIR = path.join(sandbox, 'Windows');
process.env['ProgramFiles(x86)'] = path.join(sandbox, 'Program Files (x86)');
const cacheTargets = [
  path.join(process.env.LOCALAPPDATA, 'AMD', 'DxcCache'),
  path.join(process.env.WINDIR, 'SoftwareDistribution', 'Download'),
  path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'EdgeCore'),
];
for (const [index, target] of cacheTargets.entries()) {
  await fs.mkdir(path.join(target, 'nested'), { recursive: true });
  await fs.writeFile(path.join(target, 'nested', `fixture-${index}.bin`), Buffer.alloc(16 + index));
}
const registry = createDefaultToolRegistry();
assert.equal(registry.has('windows_admin_cache_status'), true);
assert.equal(registry.has('windows_admin_storage_audit'), true);
assert.equal(registry.has('windows_admin_cache_cleanup'), true);
assert.equal(registry.riskSummary.readOnly.includes('windows_admin_cache_status'), true);
assert.equal(registry.riskSummary.readOnly.includes('windows_admin_storage_audit'), true);
assert.equal(registry.riskSummary.destructive.includes('windows_admin_cache_cleanup'), true);

const status = await registry.call('windows_admin_cache_status', { profile: 'amd-dxc-cache' });
assert.equal(status.profile, 'amd-dxc-cache');
assert.equal(path.normalize(status.target).toLowerCase().endsWith(path.normalize('AppData\\Local\\AMD\\DxcCache').toLowerCase()), true);

const windowsUpdate = await registry.call('windows_admin_cache_status', { profile: 'windows-update-download' });
assert.equal(windowsUpdate.profile, 'windows-update-download');
assert.equal(path.normalize(windowsUpdate.target).toLowerCase().endsWith(path.normalize('Windows\\SoftwareDistribution\\Download').toLowerCase()), true);

const edgeCore = await registry.call('windows_admin_cache_status', { profile: 'edgecore-stale' });
assert.equal(edgeCore.profile, 'edgecore-stale');
assert.equal(path.normalize(edgeCore.target).toLowerCase().endsWith(path.normalize('Microsoft\\EdgeCore').toLowerCase()), true);

for (const profile of ['amd-dxc-cache', 'windows-update-download', 'edgecore-stale']) {
  const dryRun = await registry.call('windows_admin_cache_cleanup', { profile, dryRun: true });
  assert.equal(dryRun.profile, profile);
  assert.equal(dryRun.dryRun, true);
}

await assert.rejects(
  registry.call('windows_admin_cache_cleanup', { profile: 'arbitrary-path', dryRun: true }),
  /Invalid enum value|invalid_enum_value|Invalid option/i,
);

const blockedExecutable = ['take', 'own'].join('');
assert.throws(() => assertCommandAllowed(`${blockedExecutable}.exe /F C:\\`), /blocked by bridge-mcp policy/i);

await fs.rm(sandbox, { recursive: true, force: true });
console.log('windows admin tools regression: PASS');
