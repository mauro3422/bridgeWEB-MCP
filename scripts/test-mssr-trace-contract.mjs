import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mssr-trace-contract-'));
const codexHome = path.join(sandbox, 'codex');
const skillRoot = path.join(codexHome, 'skills');
const metricsDir = path.join(sandbox, 'metrics');
const logDir = path.join(sandbox, 'logs');

process.env.CODEX_HOME = codexHome;
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, 'mssr-observability-state.json');
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

function writeSkill(name, description) {
  const directory = path.join(skillRoot, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nFixture guidance.\n`, 'utf8');
}

writeSkill('mssr-agent-routing', 'Route substantial work through MSSR and preserve trace continuity.');
writeSkill('shared-skill-governance', 'Govern reusable skill changes and verification.');
writeSkill('skill-routing-maintainer', 'Maintain MSSR routing metadata and fixtures.');
writeSkill('mauroprime-bridge-tool-authoring', 'Author and verify Bridge MCP tools.');

const [{ Client }, { InMemoryTransport }, { createBridgeServer }, observatory, traceContext, metrics, robloxClient] = await Promise.all([
  import('@modelcontextprotocol/sdk/client/index.js'),
  import('@modelcontextprotocol/sdk/inMemory.js'),
  import('../dist/bridge-server.js'),
  import('../dist/mssr-observatory.js'),
  import('../dist/mssr-trace-context.js'),
  import('../dist/metrics.js'),
  import('../dist/integrations/roblox-mcp-client.js'),
]);

function payload(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text;
  assert.equal(typeof text, 'string', 'Expected a text tool result.');
  const parsed = JSON.parse(text);
  if (parsed?.error) throw new Error(parsed.error);
  return parsed;
}

async function call(client, name, args = {}) {
  return payload(await client.callTool({ name, arguments: args }));
}

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createBridgeServer();
const client = new Client({ name: 'trace-contract-test', version: '1.0.0' }, { capabilities: {} });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const task = 'Implement and verify automatic MSSR trace propagation in the Bridge adapter.';
const intent = {
  summary: 'Implement and verify trace continuity for MSSR.',
  domains: ['skill-system', 'agent-orchestration', 'coding'],
  actions: ['design', 'edit', 'test', 'verify', 'document'],
  artifacts: ['code', 'mcp', 'skill', 'repository'],
  needs: ['integrity-verification', 'unit-tests', 'version-control'],
  signals: ['error-observed', 'repeated-friction', 'reusable-pattern'],
  risk: 'write',
  ambiguity: 'low',
};

try {
  const route = await call(client, 'skill_route_plan', {
    task,
    context: 'The host must automatically carry one trace through route, load, verify, persist and outcome.',
    intent,
    caller: 'chatgpt-web',
    stage: 'implement',
    sources: ['codex-local'],
    maxSkills: 12,
  });
  assert.match(route.traceId, /^mssr-/);
  const traceId = route.traceId;
  const required = route.activeSkills.filter((skill) => skill.required).map((skill) => skill.name);
  assert.ok(required.length > 0, 'Fixture route must contain at least one required skill.');

  const loaded = new Set();
  for (const name of required) {
    const result = await call(client, 'skill_load', { name, source: 'codex' });
    assert.equal(result.traceId, traceId, `skill_load should inherit trace for ${name}`);
    loaded.add(name);
  }

  const replan = await call(client, 'skill_route_plan', {
    task,
    context: 'Implementation completed; enter verification without manually copying traceId.',
    intent: { ...intent, actions: ['test', 'verify'], risk: 'read-only' },
    caller: 'chatgpt-web',
    stage: 'verify',
    completedPhases: ['discovery', 'implementation'],
    sources: ['codex-local'],
    maxSkills: 12,
  });
  assert.equal(replan.traceId, traceId, 'Replan must reuse the active trace.');

  for (const skill of replan.activeSkills.filter((item) => item.required)) {
    if (loaded.has(skill.name)) continue;
    const result = await call(client, 'skill_load', { name: skill.name, source: 'codex' });
    assert.equal(result.traceId, traceId, `verification skill should inherit trace for ${skill.name}`);
    loaded.add(skill.name);
  }

  const verification = await call(client, 'mssr_trace_record', {
    eventType: 'verification',
    caller: 'chatgpt-web',
    stage: 'verify',
    status: 'success',
    verificationPassed: true,
    evidenceKind: 'tests',
    summary: 'End-to-end trace continuity assertions passed.',
  });
  assert.equal(verification.traceId, traceId);

  const persistence = await call(client, 'mssr_trace_record', {
    eventType: 'persistence',
    caller: 'chatgpt-web',
    stage: 'persist',
    status: 'success',
    persisted: true,
    evidenceKind: 'tests',
    summary: 'Fixture persistence checkpoint recorded.',
  });
  assert.equal(persistence.traceId, traceId);

  const outcome = await call(client, 'mssr_trace_record', {
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    primarySkill: required[0],
    supportingSkills: [...loaded].filter((name) => name !== required[0]),
    metricName: 'trace-contract-e2e',
    status: 'success',
    accepted: true,
    score: 1,
    evidenceKind: 'tests',
    verificationPassed: true,
    persisted: true,
    summary: 'One trace reached route, loads, verification, persistence and outcome.',
  });
  assert.equal(outcome.traceId, traceId);

  const summary = await call(client, 'mssr_observatory_query', { kind: 'summary', scope: 'active', days: 30 });
  assert.equal(summary.scope, 'active');
  assert.equal(summary.observability.contractVersion, 'trace-contract-v1');
  assert.match(summary.observability.activeEpoch, /^trace-contract-v1-/);
  assert.equal(summary.benchmark.correlatedRouteLoadCoverage, 100);
  assert.equal(summary.benchmark.requiredLoadCompliance, 100);
  assert.equal(summary.benchmark.orphanLoadEvents, 0);
  assert.equal(summary.benchmark.verificationCoverage, 100);
  assert.equal(summary.benchmark.persistenceCoverage, 100);
  assert.equal(summary.benchmark.outcomeCoverage, 100);
  assert.equal(summary.benchmark.outcomeSuccessRate, 100);

  const legacyDb = new DatabaseSync(path.join(metricsDir, 'bridge-metrics.sqlite'));
  try {
    legacyDb.prepare(`
      INSERT INTO mssr_events (
        id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
        skill_name, required, ok, task_hash, details_json, server_name,
        server_version, pid, hostname, platform
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-without-epoch', new Date().toISOString(), 'legacy-trace-001', 'route_planned',
      'other', 'start', 'lexical-fallback', null, null, 1, null, '{}',
      'bridge-mcp', 'legacy', process.pid, 'fixture-host', process.platform,
    );
  } finally {
    legacyDb.close();
  }
  const activeAfterLegacy = await call(client, 'mssr_observatory_query', { kind: 'summary', scope: 'active', days: 30 });
  const allAfterLegacy = await call(client, 'mssr_observatory_query', { kind: 'summary', scope: 'all', days: 30 });
  assert.equal(activeAfterLegacy.eventCount, summary.eventCount, 'Legacy telemetry must not enter the active epoch.');
  assert.equal(activeAfterLegacy.activeTotals.events, summary.eventCount, 'Active totals must use exact epoch membership, not timestamp alone.');
  assert.equal(allAfterLegacy.eventCount, summary.eventCount + 1, 'All-history scope must preserve legacy telemetry.');
  assert.equal(allAfterLegacy.benchmark.routeEvents, summary.benchmark.routeEvents + 1);

  const nextRoute = await call(client, 'skill_route_plan', {
    task: 'Start a separate MSSR task after the previous outcome closed.',
    context: 'This is intentionally a new task.',
    intent,
    caller: 'chatgpt-web',
    stage: 'start',
    sources: ['codex-local'],
    maxSkills: 12,
  });
  assert.notEqual(nextRoute.traceId, traceId, 'A new task after outcome must receive a new trace.');

  const schemas = [
    { name: 'skill_route_plan', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'skill_load', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'mssr_trace_record', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'trace-domain-tool', inputSchema: { type: 'object', properties: { traceId: { type: 'string' }, payload: { type: 'string' } }, additionalProperties: false } },
    { name: 'bridge_tool_query', inputSchema: { type: 'object', properties: { toolName: { type: 'string' }, arguments: { type: 'object' } } } },
  ];
  const isolated = traceContext.createMssrTraceSessionCoordinator(schemas);
  const orphan = isolated.prepare('skill_load', { name: 'mssr-agent-routing' });
  assert.ok(orphan.notices.some((item) => item.code === 'mssr-orphan-skill-load'));
  const noRouteOutcome = isolated.prepare('mssr_trace_record', { eventType: 'outcome', traceId: 'trace-no-route-001' });
  assert.ok(noRouteOutcome.notices.some((item) => item.code === 'mssr-outcome-without-route'));

  const negative = traceContext.createMssrTraceSessionCoordinator(schemas);
  negative.observe('skill_route_plan', { task: 'negative fixture', stage: 'implement' }, {
    traceId: 'trace-negative-001',
    stage: 'implement',
    activeSkills: [{ name: 'required-skill', required: true }],
  });
  const domainTool = negative.prepare('trace-domain-tool', { payload: 'fixture' });
  assert.equal(domainTool.args.traceId, 'trace-negative-001');
  assert.equal(Object.prototype.hasOwnProperty.call(domainTool.args, 'stage'), false, 'Do not inject fields absent from the target schema.');
  const boundary = negative.prepare('mssr_trace_record', { eventType: 'verification' });
  assert.ok(boundary.notices.some((item) => item.code === 'mssr-required-skill-not-loaded'));
  const mismatch = negative.prepare('skill_load', { name: 'required-skill', traceId: 'trace-negative-999' });
  assert.ok(mismatch.notices.some((item) => item.code === 'mssr-trace-mismatch'));
  const delegated = negative.prepare('bridge_tool_query', { toolName: 'skill_load', arguments: { name: 'required-skill' } });
  assert.equal(delegated.args.arguments.traceId, 'trace-negative-001');
  assert.equal(delegated.args.arguments.required, true);
  negative.observe('bridge_tool_query', delegated.args, {
    delegatedTool: 'skill_load',
    classification: 'read-only',
    result: { traceId: 'trace-negative-001' },
  });
  assert.deepEqual(negative.snapshot().missingRequiredSkills, []);
  const replacement = negative.prepare('skill_route_plan', { task: 'different unfinished task', stage: 'start' });
  assert.ok(replacement.notices.some((item) => item.code === 'mssr-active-trace-replaced-before-outcome'));

  console.log(JSON.stringify({
    ok: true,
    traceId,
    nextTraceId: nextRoute.traceId,
    requiredSkills: required,
    epoch: summary.observability.activeEpoch,
    benchmark: {
      correlatedRouteLoadCoverage: summary.benchmark.correlatedRouteLoadCoverage,
      requiredLoadCompliance: summary.benchmark.requiredLoadCompliance,
      orphanLoadEvents: summary.benchmark.orphanLoadEvents,
      outcomeSuccessRate: summary.benchmark.outcomeSuccessRate,
    },
  }, null, 2));
} finally {
  await client.close().catch(() => {});
  await robloxClient.closeRobloxMcpConnection().catch(() => {});
  await server.close().catch(() => {});
  observatory.closeMssrObservatoryForTests();
  metrics.closeMetricsForTests();
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
