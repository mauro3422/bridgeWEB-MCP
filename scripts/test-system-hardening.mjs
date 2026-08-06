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

  await assert.rejects(
    () => registry.call('edit_lines', { path: target, startLine: 99, mode: 'delete' }),
    (error) => {
      assert.match(error.message, /^\[stale-file-state\]/);
      assert.match(error.message, /"validLineRange":\{"start":1,"end":4\}/);
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
      'terminal-alias-preflight',
      'catalog-fallback-details',
      'error-taxonomy',
      'mssr-progress-and-dimensions-schema',
    ],
  }, null, 2));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
