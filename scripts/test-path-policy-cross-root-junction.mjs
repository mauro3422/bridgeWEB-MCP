import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-path-junction-'));
const lexicalRoot = path.join(sandbox, 'lexical-root');
const canonicalRoot = path.join(sandbox, 'canonical-root');
const outsideRoot = path.join(sandbox, 'outside-root');

fs.mkdirSync(lexicalRoot, { recursive: true });
fs.mkdirSync(canonicalRoot, { recursive: true });
fs.mkdirSync(outsideRoot, { recursive: true });

const allowedLink = path.join(lexicalRoot, 'allowed-link');
const escapeLink = path.join(lexicalRoot, 'escape-link');
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
fs.symlinkSync(canonicalRoot, allowedLink, linkType);
fs.symlinkSync(outsideRoot, escapeLink, linkType);

process.env.BRIDGE_MCP_ALLOWED_ROOTS = [lexicalRoot, canonicalRoot, process.cwd()].join(path.delimiter);

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

  console.log(JSON.stringify({
    ok: true,
    cases: [
      'cross-allowed-root-junction-accepted',
      'canonical-escape-remains-blocked',
    ],
  }, null, 2));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
