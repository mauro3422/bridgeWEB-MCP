import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-path-junction-'));
const lexicalRoot = path.join(sandbox, 'lexical-root');
const canonicalRoot = path.join(sandbox, 'canonical-root');
const outsideRoot = path.join(sandbox, 'outside-root');
const readOnlyRoot = path.join(sandbox, 'read-only-root');
const readOnlyFile = path.join(sandbox, 'history.jsonl');

fs.mkdirSync(lexicalRoot, { recursive: true });
fs.mkdirSync(canonicalRoot, { recursive: true });
fs.mkdirSync(outsideRoot, { recursive: true });
fs.mkdirSync(readOnlyRoot, { recursive: true });
fs.writeFileSync(path.join(readOnlyRoot, 'session.jsonl'), '{}\n');
fs.writeFileSync(readOnlyFile, '{}\n');

const allowedLink = path.join(lexicalRoot, 'allowed-link');
const escapeLink = path.join(lexicalRoot, 'escape-link');
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
fs.symlinkSync(canonicalRoot, allowedLink, linkType);
fs.symlinkSync(outsideRoot, escapeLink, linkType);

process.env.BRIDGE_MCP_ALLOWED_ROOTS = [lexicalRoot, canonicalRoot, process.cwd()].join(path.delimiter);
process.env.BRIDGE_MCP_READONLY_ROOTS = [readOnlyRoot, readOnlyFile].join(path.delimiter);

try {
  const { assertPathAllowed } = await import('../dist/tools/shared/path.js');

  const allowedTarget = path.join(allowedLink, 'nested', 'file.txt');
  assert.equal(
    assertPathAllowed(allowedTarget, 'write'),
    path.resolve(allowedTarget),
    'a path lexically inside one allowed root and canonically inside another allowed root must be accepted',
  );

  const escapedTarget = path.join(escapeLink, 'secret.txt');
  assert.throws(
    () => assertPathAllowed(escapedTarget, 'read'),
    /Path is outside bridge-mcp allowed roots/,
    'a junction from an allowed lexical root to an unallowed canonical target must remain blocked',
  );

  const readOnlyTarget = path.join(readOnlyRoot, 'session.jsonl');
  assert.equal(
    assertPathAllowed(readOnlyTarget, 'read'),
    path.resolve(readOnlyTarget),
    'read-only roots must permit explicit reads',
  );
  assert.throws(
    () => assertPathAllowed(readOnlyTarget, 'write'),
    /allowed roots for write/,
    'read-only roots must not permit writes',
  );
  assert.throws(
    () => assertPathAllowed(readOnlyRoot, 'cwd'),
    /allowed roots for cwd/,
    'read-only roots must not become trusted shell working directories',
  );
  assert.equal(
    assertPathAllowed(readOnlyFile, 'read'),
    path.resolve(readOnlyFile),
    'an exact file may be exposed read-only without exposing its parent directory',
  );
  assert.throws(
    () => assertPathAllowed(readOnlyFile, 'write'),
    /allowed roots for write/,
    'exact read-only files must remain unwritable',
  );

  console.log(JSON.stringify({
    ok: true,
    cases: [
      'cross-allowed-root-junction-accepted',
      'canonical-escape-remains-blocked',
      'read-only-directory-allows-read-only',
      'read-only-directory-denies-write-and-cwd',
      'read-only-file-allows-exact-read-only',
    ],
  }, null, 2));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
