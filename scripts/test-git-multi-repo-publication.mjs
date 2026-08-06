import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-git-multi-publish-'));
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);
const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(name) {
  const cwd = path.join(sandbox, name);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init');
  git(cwd, 'config', 'user.email', 'bridge-test@example.invalid');
  git(cwd, 'config', 'user.name', 'Bridge Test');
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'v1\n');
  git(cwd, 'add', 'tracked.txt');
  git(cwd, 'commit', '-m', 'initial');
  return cwd;
}

function manifestFor(cwd, overrides = {}) {
  return {
    schemaVersion: 1,
    repositories: [{
      cwd,
      message: 'test publication',
      pathPolicy: { mode: 'explicit', includePaths: ['tracked.txt'], excludePaths: [] },
      validations: [{ command: 'git diff --check' }],
      remote: { name: 'origin', policy: 'local-only', push: false },
      ...overrides,
    }],
  };
}

try {
  const localRepo = initRepo('local');
  fs.writeFileSync(path.join(localRepo, 'tracked.txt'), 'v2\n');
  const before = git(localRepo, 'rev-parse', 'HEAD');
  const dry = await registry.call('git_multi_repo_publish', { mode: 'preflight', manifest: manifestFor(localRepo) });
  assert.equal(dry.overallStatus, 'success');
  assert.equal(dry.outcomes[0].status, 'ready');
  assert.equal(git(localRepo, 'rev-parse', 'HEAD'), before, 'preflight must not mutate HEAD');
  assert.match(git(localRepo, 'status', '--short'), /tracked\.txt/);

  const localApplied = await registry.call('git_multi_repo_publish', {
    mode: 'apply',
    manifest: manifestFor(localRepo, { expectedHead: before }),
    confirmApply: 'apply-listed-repositories',
  });
  assert.equal(localApplied.outcomes[0].status, 'committed-local-only');
  assert.notEqual(localApplied.outcomes[0].headAfter, before);
  assert.equal(git(localRepo, 'status', '--short'), '');

  const unclassifiedRepo = initRepo('unclassified');
  fs.writeFileSync(path.join(unclassifiedRepo, 'tracked.txt'), 'v2\n');
  fs.writeFileSync(path.join(unclassifiedRepo, 'surprise.txt'), 'unclassified\n');
  const rejected = await registry.call('git_multi_repo_publish', {
    mode: 'preflight',
    manifest: manifestFor(unclassifiedRepo),
  });
  assert.equal(rejected.overallStatus, 'failed');
  assert.equal(rejected.outcomes[0].errorCategory, 'safety-guard');
  assert.match(rejected.outcomes[0].error, /Unclassified repository paths/);

  const remoteRepo = initRepo('remote-work');
  const bare = path.join(sandbox, 'remote.git');
  fs.mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--bare');
  git(remoteRepo, 'remote', 'add', 'origin', bare);
  git(remoteRepo, 'push', '-u', 'origin', 'HEAD');
  fs.writeFileSync(path.join(remoteRepo, 'tracked.txt'), 'v2\n');
  const remoteBefore = git(remoteRepo, 'rev-parse', 'HEAD');
  const remoteManifest = manifestFor(remoteRepo, {
    expectedHead: remoteBefore,
    remote: { name: 'origin', policy: 'required', push: true },
  });
  const remoteApplied = await registry.call('git_multi_repo_publish', {
    mode: 'apply',
    manifest: remoteManifest,
    confirmApply: 'apply-listed-repositories',
    confirmPush: 'push-listed-repositories',
  });
  assert.equal(remoteApplied.outcomes[0].status, 'published');
  assert.equal(remoteApplied.outcomes[0].headAfter, remoteApplied.outcomes[0].trackingHead);
  assert.equal(remoteApplied.outcomes[0].headAfter, remoteApplied.outcomes[0].remoteHead);

  console.log(JSON.stringify({ ok: true, cases: ['dry-run', 'local-only', 'unclassified-rejection', 'bare-remote-push'] }, null, 2));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
