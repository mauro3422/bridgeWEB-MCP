import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-system-hardening-'));
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);
const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const { classifyToolAuditError } = await import('../dist/metrics.js');
const registry = createDefaultToolRegistry();

try {
  const target = path.join(sandbox, 'edit.txt');
  fs.writeFileSync(target, 'alpha\nbeta\ngamma\n');

  await assert.rejects(
    () => registry.call('apply_patch', { path: target, oldText: 'delta', newText: 'epsilon' }),
    (error) => {
      assert.match(error.message, /^\[patch-conflict\]/);
      assert.match(error.message, /currentSha256/);
      assert.match(error.message, /currentLineCount/);
      assert.match(error.message, /recommendedNextAction/);
      assert.match(error.message, /"fuzzyMutationApplied":false/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'alpha\nbeta\ngamma\n');

  await registry.call('edit_lines', { path: target, startLine: 2, endLine: 2, newContent: 'BETA', mode: 'replace' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'alpha\nBETA\ngamma\n', 'edit_lines must preserve exactly one existing LF terminator');
  const targetLines = await registry.call('read_file_lines', { path: target });
  assert.equal(targetLines.totalLines, 3, 'line tools must not expose the terminal newline as a phantom blank line');

  await registry.call('edit_lines', { path: target, startLine: 2, endLine: 2, newContent: 'beta\n', mode: 'replace' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'alpha\nbeta\ngamma\n', 'a trailing terminator in replacement content must not add a blank logical line');

  const noFinalNewline = path.join(sandbox, 'edit-no-final-newline.txt');
  fs.writeFileSync(noFinalNewline, 'one\ntwo');
  await registry.call('edit_lines', { path: noFinalNewline, startLine: 2, endLine: 2, newContent: 'TWO', mode: 'replace' });
  assert.equal(fs.readFileSync(noFinalNewline, 'utf8'), 'one\nTWO', 'edit_lines must preserve absence of a final newline');

  const crlfTarget = path.join(sandbox, 'edit-crlf.txt');
  fs.writeFileSync(crlfTarget, 'one\r\ntwo\r\n');
  await registry.call('edit_lines', { path: crlfTarget, startLine: 1, endLine: 1, newContent: 'ONE\r\n', mode: 'replace' });
  assert.equal(fs.readFileSync(crlfTarget, 'utf8'), 'ONE\r\ntwo\r\n', 'edit_lines must preserve CRLF and one final terminator');

  const intentionalBlank = path.join(sandbox, 'edit-intentional-blank.txt');
  fs.writeFileSync(intentionalBlank, 'one\n\nthree\n');
  await registry.call('edit_lines', { path: intentionalBlank, startLine: 3, endLine: 3, newContent: 'THREE', mode: 'replace' });
  assert.equal(fs.readFileSync(intentionalBlank, 'utf8'), 'one\n\nTHREE\n', 'edit_lines must preserve intentional blank lines');

  await assert.rejects(
    () => registry.call('edit_lines', { path: target, startLine: 99, mode: 'delete' }),
    (error) => {
      assert.match(error.message, /^\[stale-file-state\]/);
      assert.match(error.message, /"validLineRange":\{"start":1,"end":3\}/);
      assert.match(error.message, /nearbyContext/);
      return true;
    },
  );

  await assert.rejects(
    () => registry.call('work_feed', { sessionId: 'missing-session', input: 'echo no' }),
    (error) => {
      assert.match(error.message, /^\[target-not-found\]/);
      assert.match(error.message, /Active sessions/);
      assert.match(error.message, /terminal_list or work_show/);
      return true;
    },
  );

  const catalog = await registry.call('bridge_connector_catalog_compare', { exposedToolNames: ['bridge_health'] });
  const gitFallback = catalog.absentDirectDetails.find((item) => item.name === 'git_multi_repo_publish');
  assert.ok(gitFallback, 'The new runtime tool must appear in detailed missing-direct guidance when omitted by the host list.');
  assert.equal(gitFallback.risk, 'destructive');
  assert.equal(gitFallback.wrapper, 'bridge_tool_action');
  assert.equal(gitFallback.directExposure, false);
  assert.equal(gitFallback.schemaLookupRequired, true);
  assert.equal(gitFallback.fallback.arguments.confirmToolName, 'git_multi_repo_publish');

  assert.equal(classifyToolAuditError('[invalid-image-payload] invalid base64'), 'invalid-image-payload');
  assert.equal(classifyToolAuditError('[source-file-unavailable] fetch failed'), 'source-file-unavailable');
  assert.equal(classifyToolAuditError('[expected-integrity-mismatch] hash mismatch'), 'expected-integrity-mismatch');
  assert.equal(classifyToolAuditError('[stale-file-state] HEAD changed'), 'stale-file-state');
  assert.equal(classifyToolAuditError('[no-remote-configured] origin missing'), 'no-remote-configured');
  assert.equal(classifyToolAuditError('[missing-upstream] branch has no upstream'), 'missing-upstream');
  assert.equal(classifyToolAuditError('[safety-guard] refused'), 'safety-guard');

  const traceTool = registry.tools.find((tool) => tool.name === 'mssr_trace_record');
  assert.ok(traceTool);
  assert.ok(traceTool.inputSchema.properties.leaseMs);
  assert.ok(traceTool.inputSchema.properties.dimensions);
  assert.ok(traceTool.inputSchema.properties.eventType.enum.includes('progress'));

  console.log(JSON.stringify({
    ok: true,
    cases: [
      'patch-conflict-diagnostics',
      'stale-line-range-diagnostics',
      'edit-lines-eof-preservation',
      'terminal-alias-preflight',
      'catalog-fallback-details',
      'error-taxonomy',
      'mssr-progress-and-dimensions-schema',
    ],
  }, null, 2));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
