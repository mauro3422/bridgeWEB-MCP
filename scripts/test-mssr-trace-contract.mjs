import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, 'bridge-metrics.sqlite');
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(logDir, 'mssr-events.jsonl');
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
writeSkill('skill-maintenance-loop', 'Close routed work after the latest persistence and convert reusable friction into durable maintenance.');
writeSkill('mauroprime-bridge-tool-authoring', 'Author and verify Bridge MCP tools.');

const [{ Client }, { InMemoryTransport }, { createBridgeServer }, observatory, traceContext, metrics, robloxClient, runtimeIdentity] = await Promise.all([
  import('@modelcontextprotocol/sdk/client/index.js'),
  import('@modelcontextprotocol/sdk/inMemory.js'),
  import('../dist/bridge-server.js'),
  import('../dist/mssr-observatory.js'),
  import('../dist/mssr-trace-context.js'),
  import('../dist/metrics.js'),
  import('../dist/integrations/roblox-mcp-client.js'),
  import('../dist/runtime-identity.js'),
]);

function payload(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text;
  assert.equal(typeof text, 'string', 'Expected a text tool result.');
  const parsed = JSON.parse(text);
  if (parsed?.error) throw new Error(parsed.error);
  return parsed;
}

assert.equal(runtimeIdentity.normalizeModelIdentifier('GPT-5.6 Thinking'), 'gpt-5.6-thinking');
assert.equal(runtimeIdentity.normalizeModelIdentifier('gpt-5.6 thinking'), 'gpt-5.6-thinking');
assert.equal(runtimeIdentity.normalizeModelIdentifier('gpt-5.6_thinking'), 'gpt-5.6-thinking');

traceContext.resetSharedMssrTraceRegistryForTests();
let sessionCounter = 0;
async function callFresh(name, args = {}, requestMeta, clientName) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBridgeServer();
  const client = new Client({ name: clientName || `trace-contract-test-${++sessionCounter}`, version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return payload(await client.callTool({
      name,
      arguments: args,
      ...(requestMeta ? { _meta: requestMeta } : {}),
    }));
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

async function withClientSession(clientName, callback) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBridgeServer();
  const client = new Client({ name: clientName, version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await callback(async (name, args = {}, requestMeta) => payload(await client.callTool({
      name,
      arguments: args,
      ...(requestMeta ? { _meta: requestMeta } : {}),
    })));
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

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
  const route = await callFresh('skill_route_plan', {
    task,
    context: 'The host must automatically carry one trace through route, load, verify, persist and outcome.',
    intent,
    caller: 'chatgpt-web',
    stage: 'implement',
    sources: ['codex-local'],
    maxSkills: 12,
  }, {
    'x-codex-turn-metadata': {
      model: 'gpt-5.6-terra',
      reasoning_effort: 'high',
    },
  });
  assert.match(route.traceId, /^mssr-/);
  const traceId = route.traceId;
  const required = route.activeSkills.filter((skill) => skill.required).map((skill) => skill.name);
  assert.ok(required.length > 0, 'Fixture route must contain at least one required skill.');

  const loaded = new Set();
  for (const [index, name] of required.entries()) {
    const result = index === 0
      ? (await callFresh('bridge_tool_query', { toolName: 'skill_load', arguments: { name, source: 'codex' } })).result
      : await callFresh('skill_load', { name, source: 'codex' });
    assert.equal(result.traceId, traceId, `skill_load should inherit trace for ${name}`);
    loaded.add(name);
  }

  const replan = await callFresh('skill_route_plan', {
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
    const result = await callFresh('skill_load', { name: skill.name, source: 'codex' });
    assert.equal(result.traceId, traceId, `verification skill should inherit trace for ${skill.name}`);
    loaded.add(skill.name);
  }

  const verification = await callFresh('mssr_trace_record', {
    eventType: 'verification',
    caller: 'chatgpt-web',
    stage: 'verify',
    status: 'success',
    verificationPassed: true,
    evidenceKind: 'tests',
    summary: 'End-to-end trace continuity assertions passed.',
  });
  assert.equal(verification.traceId, traceId);

  const persistence = await callFresh('mssr_trace_record', {
    eventType: 'persistence',
    caller: 'chatgpt-web',
    stage: 'persist',
    status: 'success',
    persisted: true,
    evidenceKind: 'tests',
    summary: 'Fixture persistence checkpoint recorded.',
  });
  assert.equal(persistence.traceId, traceId);

  const close = await callFresh('skill_route_plan', {
    task,
    context: 'Verification and persistence are complete; close after the latest persisted state and run maintenance if required.',
    intent: { ...intent, actions: ['review', 'verify', 'maintain', 'document'], risk: 'read-only' },
    caller: 'chatgpt-web',
    stage: 'close',
    completedPhases: ['discovery', 'implementation', 'verification', 'persistence'],
    sources: ['codex-local'],
    maxSkills: 12,
  });
  assert.equal(close.traceId, traceId, 'Close replan must reuse the active trace after persistence.');
  for (const skill of close.activeSkills.filter((item) => item.required)) {
    if (loaded.has(skill.name)) continue;
    const result = await callFresh('skill_load', { name: skill.name, source: 'codex', stage: 'close' });
    assert.equal(result.traceId, traceId, `close skill should inherit trace for ${skill.name}`);
    loaded.add(skill.name);
  }
  const maintenance = await callFresh('mssr_trace_record', {
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    completedPhases: ['discovery', 'safety', 'implementation', 'verification', 'persistence', 'maintenance'],
    primarySkill: close.activeSkills.find((item) => item.required)?.name ?? required[0],
    verificationPassed: true,
    persisted: true,
    evidenceKind: 'tests',
    summary: 'Close-stage maintenance completed after the latest persistence.',
  });
  assert.equal(maintenance.traceId, traceId);

  const outcome = await callFresh('mssr_trace_record', {
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

  observatory.recordMssrEvent({
    traceId,
    eventType: 'closure_reminder',
    caller: 'chatgpt-web',
    stage: 'close',
    ok: false,
    details: { idleMs: 25, surface: 'chatgpt-web', fixture: true },
  });
  const summary = await callFresh('mssr_observatory_query', { kind: 'summary', scope: 'active', days: 30 });
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
  assert.equal(summary.benchmark.closureReminderEvents, 1);
  const webSurface = summary.surfaces.find((surface) => surface.caller === 'chatgpt-web');
  assert.equal(webSurface?.closureReminderEvents, 1);
  assert.equal(webSurface?.outcomeCoverage, 100);
  const terraProfile = summary.agentProfiles.find((profile) =>
    profile.caller === 'chatgpt-web'
    && profile.model === 'gpt-5.6-terra'
    && profile.reasoningEffort === 'high');
  assert.equal(terraProfile?.routedTraces, 1);
  assert.equal(terraProfile?.outcomeCoverage, 100);
  assert.equal(terraProfile?.structuredRouteRate, 100);
  assert.equal(terraProfile?.routeLoadCoverage, 100);
  assert.equal(terraProfile?.requiredLoadCompliance, 100);
  assert.equal(terraProfile?.verificationCoverage, 100);
  assert.equal(terraProfile?.persistenceCoverage, 100);
  assert.equal(terraProfile?.outcomeSuccessRate, 100);
  assert.equal(terraProfile?.outcomeAcceptanceRate, 100);
  assert.equal(terraProfile?.averageOutcomeScore, 1);
  assert.ok(Number(terraProfile?.averageCompletionMs) >= 0);
  assert.equal(terraProfile?.userCorrections, 0);

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
  const activeAfterLegacy = await callFresh('mssr_observatory_query', { kind: 'summary', scope: 'active', days: 30 });
  const allAfterLegacy = await callFresh('mssr_observatory_query', { kind: 'summary', scope: 'all', days: 30 });
  assert.equal(activeAfterLegacy.eventCount, summary.eventCount, 'Legacy telemetry must not enter the active epoch.');
  assert.equal(activeAfterLegacy.activeTotals.events, summary.eventCount, 'Active totals must use exact epoch membership, not timestamp alone.');
  assert.equal(allAfterLegacy.eventCount, summary.eventCount + 1, 'All-history scope must preserve legacy telemetry.');
  assert.equal(allAfterLegacy.benchmark.routeEvents, summary.benchmark.routeEvents + 1);

  const epochChange = await callFresh('mssr_observatory_epoch_start', {
    confirm: 'start-new-active-epoch',
    reason: 'trace-contract regression boundary',
  });
  assert.equal(epochChange.historyDeleted, false);
  assert.notEqual(epochChange.current.activeEpoch, epochChange.previous.activeEpoch);
  const cleanBridgeMetrics = metrics.getMetricsOverview('active');
  const preservedBridgeMetrics = metrics.getMetricsOverview('all');
  assert.equal(cleanBridgeMetrics.scope, 'active');
  assert.equal(cleanBridgeMetrics.totals.calls, 0, 'The shared epoch must also reset active Bridge tool metrics.');
  assert.ok(Number(preservedBridgeMetrics.totals.calls) > 0, 'All-history Bridge metrics must preserve prior calls.');
  const cleanActive = await callFresh('mssr_observatory_query', { kind: 'summary', scope: 'active', days: 30 });
  const preservedAll = await callFresh('mssr_observatory_query', { kind: 'summary', scope: 'all', days: 30 });
  assert.equal(cleanActive.eventCount, 0, 'A new active epoch must start with no current events.');
  assert.equal(preservedAll.eventCount, allAfterLegacy.eventCount, 'Starting an epoch must not delete historical telemetry.');

  const nextRoute = await callFresh('skill_route_plan', {
    task: 'Start a separate MSSR task after the previous outcome closed.',
    context: 'This is intentionally a new task.',
    intent,
    caller: 'chatgpt-web',
    stage: 'start',
    sources: ['codex-local'],
    maxSkills: 12,
  }, undefined, 'ChatGPT Web');
  assert.notEqual(nextRoute.traceId, traceId, 'A new task after outcome must receive a new trace.');
  await callFresh('system_info', {}, undefined, 'ChatGPT Web');
  await callFresh('work_once', {
    cwd: sandbox,
    command: 'node --version',
    timeoutMs: 10_000,
    traceId: nextRoute.traceId,
  }, undefined, 'ChatGPT Web');
  const activeBridgeSummary = metrics.getMetricsSummary(50, 'active');
  const routedMetric = activeBridgeSummary.summary.find((row) => row.tool === 'skill_route_plan');
  assert.equal(routedMetric?.calls, 1);
  const webBridgeProfile = activeBridgeSummary.agentProfiles.find((profile) =>
    profile.caller === 'chatgpt-web'
    && profile.model === 'unknown'
    && profile.reasoning_effort === 'unknown');
  assert.equal(webBridgeProfile?.calls, 2, 'Client handshake identity must attribute route and generic Web calls to the Web profile.');
  const activeRecent = metrics.getRecentMetrics(20, 'active').recent;
  const recentRouteMetric = activeRecent.find((row) => row.tool === 'skill_route_plan');
  assert.equal(recentRouteMetric?.trace_id, nextRoute.traceId, 'Tool metrics must correlate route calls with the emitted trace.');
  const genericWebMetric = activeRecent.find((row) => row.tool === 'system_info');
  assert.equal(genericWebMetric?.caller, 'chatgpt-web');
  assert.equal(genericWebMetric?.client_name, 'ChatGPT Web');
  assert.equal(genericWebMetric?.trace_id, nextRoute.traceId, 'Stateless generic tools must inherit the unique Web MSSR trace for metrics.');
  const explicitlyTracedWork = activeRecent.find((row) => row.tool === 'work_once');
  assert.equal(explicitlyTracedWork?.trace_id, nextRoute.traceId, 'work_once must accept explicit traceId metadata for cross-project/process correlation.');
  assert.equal(explicitlyTracedWork?.routing_status, 'traced');

  const genericTextPath = path.join(sandbox, 'generic-traced-write.txt');
  const genericTextWrite = await callFresh('write_text_file', {
    path: genericTextPath,
    content: 'generic traced write fixture\n',
  }, undefined, 'ChatGPT Web');
  assert.equal(
    genericTextWrite.bridgeNotices?.items?.some((notice) => notice.code === 'mssr-unrouted-tool-call') ?? false,
    false,
    'write_text_file must inherit the unique Web trace without an unrouted warning.',
  );
  assert.equal(fs.readFileSync(genericTextPath, 'utf8'), 'generic traced write fixture\n');

  const genericBinaryBytes = Buffer.from('generic traced binary fixture', 'utf8');
  const genericBinaryPath = path.join(sandbox, 'generic-traced-write.bin');
  const genericBinaryWrite = await callFresh('binary_file_write', {
    outputPath: genericBinaryPath,
    data: genericBinaryBytes.toString('base64'),
    encoding: 'base64',
    expectedBytes: genericBinaryBytes.length,
    expectedSha256: createHash('sha256').update(genericBinaryBytes).digest('hex'),
  }, undefined, 'ChatGPT Web');
  assert.equal(
    genericBinaryWrite.bridgeNotices?.items?.some((notice) => notice.code === 'mssr-unrouted-tool-call') ?? false,
    false,
    'binary_file_write must inherit the unique Web trace without an unrouted warning.',
  );
  assert.deepEqual(fs.readFileSync(genericBinaryPath), genericBinaryBytes);

  const postWriteRecent = metrics.getRecentMetrics(30, 'active').recent;
  const tracedTextWrite = postWriteRecent.find((row) => row.tool === 'write_text_file');
  const tracedBinaryWrite = postWriteRecent.find((row) => row.tool === 'binary_file_write');
  assert.equal(tracedTextWrite?.trace_id, nextRoute.traceId, 'write_text_file metrics must retain the active Web trace.');
  assert.equal(tracedTextWrite?.routing_status, 'traced');
  assert.equal(tracedBinaryWrite?.trace_id, nextRoute.traceId, 'binary_file_write metrics must retain the active Web trace.');
  assert.equal(tracedBinaryWrite?.routing_status, 'traced');

  const sessionMeta = { 'openai/session': 'web-session-fixture-001' };
  const fixtureProject = path.join(sandbox, 'fixture-project');
  fs.mkdirSync(fixtureProject, { recursive: true });
  await callFresh('project_context_load', {
    projectRoot: fixtureProject,
    task: 'Load bounded fixture project context.',
  }, sessionMeta, 'openai-mcp');
  const rotatedWeb = await callFresh('search_files', {
    path: fixtureProject,
    pattern: 'nothing-to-find',
    maxResults: 5,
  }, sessionMeta, 'openai-mcp');
  assert.equal(
    rotatedWeb.bridgeNotices?.items?.some((notice) => notice.code === 'mssr-unrouted-tool-call') ?? false,
    false,
    'A unique open Web trace must survive connector session/project rotation without an unrouted warning.',
  );
  const expectedSessionKey = `session-${createHash('sha256').update('web-session-fixture-001').digest('hex').slice(0, 16)}`;
  const expectedContextTaskKey = `task_${createHash('sha256').update('load bounded fixture project context.').digest('hex').slice(0, 16)}`;
  const expectedActiveTraceTaskKey = `task_${createHash('sha256').update('start a separate mssr task after the previous outcome closed.').digest('hex').slice(0, 16)}`;
  const scopedProfiles = metrics.getMetricsOverview('active').agentProfiles;
  const fixtureProfile = scopedProfiles.find((profile) =>
    profile.caller === 'chatgpt-web'
    && profile.project === 'fixture-project'
    && profile.session_key === expectedSessionKey);
  assert.equal(fixtureProfile?.task_key, expectedActiveTraceTaskKey, 'Rotated project/session context must not replace the active trace task identity.');
  assert.notEqual(fixtureProfile?.task_key, expectedContextTaskKey, 'Project context task metadata must remain pending evidence, not overwrite an active trace.');
  assert.equal(fixtureProfile?.related_project, 'none');
  assert.equal(fixtureProfile?.eligible_calls, 1);
  assert.equal(fixtureProfile?.traced_calls, 1);
  assert.equal(fixtureProfile?.untraced_calls, 0);
  assert.equal(fixtureProfile?.mssr_trace_coverage, 100);

  const concurrentProjects = [
    path.join(sandbox, 'web-concurrent-primary-a'),
    path.join(sandbox, 'web-concurrent-primary-b'),
  ];
  const concurrentSupporting = [
    path.join(sandbox, 'web-concurrent-support-a'),
    path.join(sandbox, 'web-concurrent-support-b'),
  ];
  for (const target of [...concurrentProjects, ...concurrentSupporting]) fs.mkdirSync(target, { recursive: true });
  await Promise.all(concurrentProjects.map((projectRoot, index) =>
    withClientSession('openai-mcp', async (call) => {
      const requestMeta = { 'openai/session': `web-concurrent-session-${index + 1}` };
      await call('project_context_load', {
        projectRoot,
        task: `Concurrent Web benchmark task ${index + 1}.`,
      }, requestMeta);
      await call('work_once', {
        cwd: concurrentSupporting[index],
        command: 'node --version',
        timeoutMs: 10_000,
      }, requestMeta);
    })));
  const concurrentProfiles = metrics.getMetricsOverview('active').agentProfiles
    .filter((profile) => String(profile.project).startsWith('web-concurrent-primary-'));
  assert.equal(new Set(concurrentProfiles.map((profile) => profile.session_key)).size, 2);
  assert.equal(new Set(concurrentProfiles.map((profile) => profile.task_key)).size, 1, 'Concurrent project contexts attached to one active trace must preserve that trace task identity.');
  assert.ok(concurrentProfiles.every((profile) => profile.task_key === expectedActiveTraceTaskKey));
  assert.deepEqual(
    new Set(concurrentProfiles.map((profile) => profile.related_project)),
    new Set(['web-concurrent-support-a', 'web-concurrent-support-b']),
    'Concurrent Web tasks must preserve primary projects while exposing their auxiliary repositories.',
  );

  const nextRequired = nextRoute.activeSkills.filter((skill) => skill.required).map((skill) => skill.name);
  for (const name of nextRequired) {
    await callFresh('skill_load', {
      name,
      source: 'codex',
      traceId: nextRoute.traceId,
      required: true,
      stage: 'start',
    });
  }
  traceContext.resetSharedMssrTraceRegistryForTests();
  const restartSchemas = [
    { name: 'skill_route_plan', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'skill_load', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'mssr_trace_record', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
  ];
  const afterRestart = traceContext.createMssrTraceSessionCoordinator(restartSchemas);
  const resumedAfterRestart = afterRestart.prepare('skill_route_plan', {
    task: 'Start a separate MSSR task after the previous outcome closed.',
    caller: 'chatgpt-web',
    stage: 'verify',
    traceId: nextRoute.traceId,
  });
  assert.equal(
    resumedAfterRestart.notices.some((notice) => notice.code === 'mssr-required-skill-not-loaded'),
    false,
    'Explicit resume after a process restart must restore successful persisted skill loads.',
  );
  assert.deepEqual(afterRestart.snapshot().missingRequiredSkills, []);
  const restartClose = await callFresh('skill_route_plan', {
    task: 'Start a separate MSSR task after the previous outcome closed.',
    context: 'The trace survived process-memory loss; perform a fresh close over the recovered state before final outcome.',
    intent: { ...intent, actions: ['review', 'verify', 'maintain'], risk: 'read-only' },
    caller: 'chatgpt-web',
    stage: 'close',
    traceId: nextRoute.traceId,
    completedPhases: ['discovery', 'implementation', 'verification', 'persistence'],
    sources: ['codex-local'],
    maxSkills: 12,
  });
  assert.equal(restartClose.traceId, nextRoute.traceId);
  for (const skill of restartClose.activeSkills.filter((item) => item.required)) {
    await callFresh('skill_load', {
      name: skill.name,
      source: 'codex',
      traceId: nextRoute.traceId,
      required: true,
      stage: 'close',
    });
  }
  await callFresh('mssr_trace_record', {
    traceId: nextRoute.traceId,
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    completedPhases: ['discovery', 'safety', 'implementation', 'verification', 'persistence', 'maintenance'],
    primarySkill: restartClose.activeSkills.find((item) => item.required)?.name ?? nextRoute.activeSkills[0]?.name,
    verificationPassed: true,
    persisted: true,
    summary: 'Recovered trace completed fresh close-stage maintenance.',
  });
  await callFresh('mssr_trace_record', {
    traceId: nextRoute.traceId,
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    verificationPassed: true,
    persisted: true,
    primarySkill: restartClose.activeSkills.find((item) => item.required)?.name ?? nextRoute.activeSkills[0]?.name,
    summary: 'Close the explicit restart fixture before testing rotated-session fallback.',
  });

  const closeRecoveryMeta = { 'openai/session': 'web-close-recovery-session-001' };
  const closeRecoveryRotatedMeta = { 'openai/session': 'web-close-recovery-session-rotated-002' };
  const closeRoute = (await callFresh('bridge_tool_query', {
    toolName: 'skill_route_plan',
    arguments: {
      task: 'Close a routed maintenance task and load its required close-phase skill after session memory is lost.',
      context: 'Verification completed; enter close and preserve the trace across a stateless dedicated skill_load.',
      intent,
      caller: 'chatgpt-web',
      stage: 'close',
      completedPhases: ['discovery', 'implementation', 'verification'],
      sources: ['codex-local'],
      maxSkills: 12,
    },
  }, closeRecoveryMeta, 'openai-mcp')).result;
  const closeSelectedSkill = closeRoute.activeSkills[0]?.name;
  assert.equal(typeof closeSelectedSkill, 'string', 'Close-stage fixture must select at least one skill.');
  traceContext.resetSharedMssrTraceRegistryForTests();
  const recoveredGenericTool = await callFresh('search_files', {
    path: sandbox,
    pattern: 'rotated-session-generic-metric-fixture',
    maxResults: 3,
  }, closeRecoveryRotatedMeta, 'openai-mcp');
  assert.equal(
    recoveredGenericTool.bridgeNotices?.items?.some((notice) => notice.code === 'mssr-unrouted-tool-call') ?? false,
    false,
    'A generic eligible tool must recover the unique persisted trace after memory and session/project rotation.',
  );
  const recoveredGenericMetric = metrics.getRecentMetrics(20, 'active').recent.find((row) => row.tool === 'search_files');
  assert.equal(
    recoveredGenericMetric?.trace_id,
    closeRoute.traceId,
    'Generic tool metrics must keep the persisted routed trace after coordinator-memory loss.',
  );
  traceContext.resetSharedMssrTraceRegistryForTests();
  const recoveredCloseLoad = await callFresh('skill_load', {
    name: closeSelectedSkill,
    source: 'codex',
  }, closeRecoveryRotatedMeta, 'openai-mcp');
  assert.equal(
    recoveredCloseLoad.traceId,
    closeRoute.traceId,
    'A dedicated skill_load must recover the unique persisted close-stage trace after in-memory state is lost.',
  );
  assert.equal(
    recoveredCloseLoad.bridgeNotices?.items?.some((notice) => notice.code === 'mssr-orphan-skill-load') ?? false,
    false,
    'Persisted close-stage recovery must not emit an orphan load warning.',
  );
  traceContext.resetSharedMssrTraceRegistryForTests();
  const recoveredCloseCheckpoint = await callFresh('mssr_trace_record', {
    eventType: 'friction',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'partial',
    summary: 'Persisted close-stage checkpoint recovery fixture.',
  }, closeRecoveryRotatedMeta, 'openai-mcp');
  assert.equal(
    recoveredCloseCheckpoint.traceId,
    closeRoute.traceId,
    'A trace-aware checkpoint must recover the same unique persisted Web trace after memory loss.',
  );
  for (const skill of closeRoute.activeSkills.filter((item) => item.required)) {
    await callFresh('skill_load', {
      name: skill.name,
      source: 'codex',
      traceId: closeRoute.traceId,
      required: true,
      stage: 'close',
    }, closeRecoveryRotatedMeta, 'openai-mcp');
  }
  await callFresh('mssr_trace_record', {
    traceId: closeRoute.traceId,
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    completedPhases: ['discovery', 'safety', 'implementation', 'verification', 'persistence', 'maintenance'],
    primarySkill: closeRoute.activeSkills.find((item) => item.required)?.name ?? closeRoute.activeSkills[0]?.name,
    verificationPassed: true,
    persisted: true,
    summary: 'Rotated-session close-stage maintenance completed after recovered required loads.',
  }, closeRecoveryRotatedMeta, 'openai-mcp');
  await callFresh('mssr_trace_record', {
    traceId: closeRoute.traceId,
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    verificationPassed: true,
    persisted: true,
    primarySkill: closeRoute.activeSkills[0]?.name,
    summary: 'Close the rotated-session recovery fixture after continuity is proven.',
  }, closeRecoveryRotatedMeta, 'openai-mcp');

  traceContext.resetSharedMssrTraceRegistryForTests();
  const schemas = [
    { name: 'skill_route_plan', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'skill_load', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'mssr_trace_record', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
    { name: 'trace-domain-tool', inputSchema: { type: 'object', properties: { traceId: { type: 'string' }, payload: { type: 'string' } }, additionalProperties: false } },
    { name: 'apply_patch', inputSchema: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } } }, annotations: { destructiveHint: true } },
    { name: 'project_context_health', inputSchema: { type: 'object', properties: { projectRoot: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'bridge_tool_query', inputSchema: { type: 'object', properties: { toolName: { type: 'string' }, arguments: { type: 'object' } } } },
  ];
  const isolated = traceContext.createMssrTraceSessionCoordinator(schemas);
  const orphan = isolated.prepare('skill_load', { name: 'mssr-agent-routing' });
  assert.ok(orphan.notices.some((item) => item.code === 'mssr-orphan-skill-load'));
  const noRouteOutcome = isolated.prepare('mssr_trace_record', { eventType: 'outcome', traceId: 'trace-no-route-001' });
  assert.ok(noRouteOutcome.notices.some((item) => item.code === 'mssr-outcome-without-route'));
  traceContext.resetSharedMssrTraceRegistryForTests();
  const projectMaintenance = traceContext.createMssrTraceSessionCoordinator(schemas);
  projectMaintenance.observe('skill_route_plan', {
    task: 'Change the portable host adapter contract.',
    caller: 'chatgpt-web',
    projectRoot: 'D:\\Dev\\bridge-mcp',
    stage: 'implement',
    intent: {
      summary: 'Change the portable host adapter contract.',
      domains: ['agent-orchestration', 'skill-system'],
      actions: ['design', 'edit', 'maintain'],
      artifacts: ['mcp', 'repository'],
      needs: ['integrity-verification'],
      signals: ['reusable-pattern'],
      risk: 'write',
      ambiguity: 'low',
    },
  }, {
    traceId: 'trace-project-maintenance-001',
    stage: 'implement',
    activeSkills: [],
  });
  const projectReviewNotice = projectMaintenance.observe('apply_patch', {
    path: 'D:\\Dev\\bridge-mcp\\src\\host-adapter-contract.ts',
    oldText: 'old',
    newText: 'new',
  }, { changed: true });
  assert.ok(projectReviewNotice.some((item) => item.code === 'mssr-project-knowledge-review-due'));
  const projectMaintenanceSnapshot = projectMaintenance.snapshot();
  assert.equal(projectMaintenanceSnapshot.projectMaintenance?.due, true);
  assert.equal(projectMaintenanceSnapshot.maintenanceRequired, true);
  assert.ok(projectMaintenanceSnapshot.projectMaintenance?.changedPathHints.includes('src/host-adapter-contract.ts'));
  assert.ok(projectMaintenanceSnapshot.projectMaintenance?.targets.some((item) => item.target === 'agents'));
  assert.equal(projectMaintenanceSnapshot.projectMaintenance?.projectRootKnown, true);
  assert.equal(JSON.stringify(projectMaintenanceSnapshot).includes('old'), false, 'Project-maintenance metadata must not retain edited source content.');
  const duplicateProjectReview = projectMaintenance.observe('apply_patch', {
    path: 'D:\\Dev\\bridge-mcp\\src\\host-adapter-contract.ts',
    oldText: 'old-2',
    newText: 'new-2',
  }, { changed: true });
  assert.equal(duplicateProjectReview.some((item) => item.code === 'mssr-project-knowledge-review-due'), false, 'Same owner-level advisory should be deduplicated.');
  const changedProjectReview = projectMaintenance.observe('apply_patch', {
    path: 'D:\\Dev\\bridge-mcp\\changelogs\\0.6.100.md',
    oldText: 'before',
    newText: 'after',
  }, { changed: true });
  const changedProjectReviewNotice = changedProjectReview.find((item) => item.code === 'mssr-project-knowledge-review-due');
  assert.ok(changedProjectReviewNotice, 'Meaningfully changed maintenance evidence should reopen the same subject.');
  assert.equal(changedProjectReviewNotice.details?.event, 'changed');

  projectMaintenance.observe('skill_route_plan', {
    task: 'Close the maintenance review.',
    caller: 'chatgpt-web',
    stage: 'close',
  }, {
    traceId: 'trace-project-maintenance-001',
    stage: 'close',
    activeSkills: [],
    requiredPhases: ['maintenance'],
  });
  const maintenanceResolved = projectMaintenance.observe('mssr_trace_record', {
    traceId: 'trace-project-maintenance-001',
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    completedPhases: ['maintenance'],
  }, { traceId: 'trace-project-maintenance-001' });
  const maintenanceResolvedNotice = maintenanceResolved.find((item) => item.code === 'mssr-project-knowledge-review-resolved');
  assert.ok(maintenanceResolvedNotice, 'Fresh close+maintenance for the current lifecycle revision must resolve project-knowledge attention.');
  assert.equal(maintenanceResolvedNotice.details?.event, 'resolved');
  assert.equal(projectMaintenance.snapshot().maintenanceCloseFresh, true);


  traceContext.resetSharedMssrTraceRegistryForTests();
  const ordinaryWrite = traceContext.createMssrTraceSessionCoordinator(schemas);
  ordinaryWrite.observe('skill_route_plan', {
    task: 'Implement one ordinary stable feature.',
    caller: 'chatgpt-web',
    projectRoot: 'D:\\Dev\\bridge-mcp',
    stage: 'implement',
    intent: {
      summary: 'Implement one ordinary stable feature.',
      domains: ['coding'],
      actions: ['edit'],
      artifacts: ['code'],
      needs: [],
      signals: ['nominal'],
      risk: 'write',
      ambiguity: 'low',
    },
  }, {
    traceId: 'trace-project-maintenance-watch-001',
    stage: 'implement',
    activeSkills: [],
  });
  const ordinaryNotice = ordinaryWrite.observe('apply_patch', {
    path: 'D:\\Dev\\bridge-mcp\\src\\ordinary-feature.ts',
    oldText: 'a',
    newText: 'b',
  }, { changed: true });
  assert.equal(ordinaryNotice.some((item) => item.code.startsWith('mssr-project-knowledge-review')), false);
  assert.equal(ordinaryWrite.snapshot().maintenanceRequired, false, 'Ordinary one-file writes must not force project-knowledge maintenance.');

  traceContext.resetSharedMssrTraceRegistryForTests();
  const healthFixtureSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const healthReview = traceContext.createMssrTraceSessionCoordinator(schemas);
  healthReview.observe('skill_route_plan', {
    task: 'Review an ordinary initialized project.',
    caller: 'chatgpt-web',
    projectRoot: 'D:\\Dev\\bridge-mcp',
    stage: 'implement',
    intent: {
      summary: 'Review an ordinary initialized project.',
      domains: ['coding'],
      actions: ['review'],
      artifacts: ['repository'],
      needs: [],
      signals: ['nominal'],
      risk: 'read-only',
      ambiguity: 'low',
    },
  }, {
    traceId: `trace-project-health-review-${healthFixtureSuffix}`,
    stage: 'implement',
    activeSkills: [],
  });
  const healthReviewNotices = healthReview.observe('project_context_load', {
    projectRoot: 'D:\\Dev\\bridge-mcp',
  }, {
    projectRoot: 'D:\\Dev\\bridge-mcp',
    projectContextHealth: {
      projectRoot: 'D:\\Dev\\bridge-mcp',
      level: 'review',
      manifestStatus: 'valid',
      findings: [{ code: 'oversized-authority', target: '.mssr/PROJECT_STATE.md' }],
      advisoryOnly: true,
    },
  });
  const healthReviewNotice = healthReviewNotices.find((item) => item.code === 'mssr-project-knowledge-review-due');
  assert.ok(healthReviewNotice, 'REVIEW Project Context Health must surface maintenance due.');
  assert.equal(healthReviewNotice.details?.projectInitialized, true);
  assert.equal(healthReviewNotice.details?.projectContextHealth, 'review');
  const healthReviewSnapshot = healthReview.snapshot();
  assert.equal(healthReviewSnapshot.projectMaintenance?.projectInitialized, true);
  assert.equal(healthReviewSnapshot.projectMaintenance?.projectContextHealth, 'review');
  assert.equal(healthReviewSnapshot.maintenanceRequired, true);
  assert.equal(JSON.stringify(healthReviewSnapshot).includes('legacy-mssr-artifact'), false, 'Trace maintenance metadata must not retain Project Context Health finding payloads.');

  traceContext.resetSharedMssrTraceRegistryForTests();
  const healthOk = traceContext.createMssrTraceSessionCoordinator(schemas);
  healthOk.observe('skill_route_plan', {
    task: 'Inspect a healthy project.',
    caller: 'chatgpt-web',
    projectRoot: 'D:\\Dev\\bridge-mcp',
    stage: 'implement',
    intent: {
      summary: 'Inspect a healthy project.',
      domains: ['coding'],
      actions: ['review'],
      artifacts: ['repository'],
      needs: [],
      signals: ['nominal'],
      risk: 'read-only',
      ambiguity: 'low',
    },
  }, {
    traceId: `trace-project-health-ok-${healthFixtureSuffix}`,
    stage: 'implement',
    activeSkills: [],
  });
  const healthOkNotices = healthOk.observe('project_context_health', { projectRoot: 'D:\\Dev\\bridge-mcp' }, {
    projectRoot: 'D:\\Dev\\bridge-mcp',
    level: 'ok',
    manifestStatus: 'valid',
    findings: [],
    advisoryOnly: true,
  });
  assert.equal(healthOkNotices.some((item) => item.code.startsWith('mssr-project-knowledge-review')), false);
  assert.equal(healthOk.snapshot().maintenanceRequired, false, 'Healthy initialized project context must not force maintenance by itself.');
  assert.equal(healthOk.snapshot().projectMaintenance?.projectContextHealth, 'ok');

  traceContext.resetSharedMssrTraceRegistryForTests();
  const unknownFreshness = traceContext.createMssrTraceSessionCoordinator(schemas);
  unknownFreshness.observe('skill_route_plan', { task: 'Observe unknown Context Plane freshness.', caller: 'chatgpt-web', stage: 'implement' }, {
    traceId: 'trace-context-freshness-unknown-001', stage: 'implement', activeSkills: [],
  });
  const unknownFreshnessNotices = unknownFreshness.observe('trace-domain-tool', { payload: 'unknown-freshness' }, {
    contextPlane: { projectContext: { receipts: [{ freshness: 'unknown' }] } },
  });
  assert.equal(unknownFreshnessNotices.some((item) => item.code.startsWith('mssr-context-plane-freshness-')), false, 'Unknown-only freshness is WATCH and must stay below the notification threshold.');
  assert.equal(unknownFreshness.snapshot().projectMaintenance?.contextFreshnessIssues, 0, 'WATCH freshness must not force durable maintenance.');
  assert.equal(unknownFreshness.snapshot().maintenanceRequired, false);

  traceContext.resetSharedMssrTraceRegistryForTests();
  const contextFreshness = traceContext.createMssrTraceSessionCoordinator(schemas);
  contextFreshness.observe('skill_route_plan', { task: 'Track current Context Plane freshness.', caller: 'chatgpt-web', stage: 'implement' }, {
    traceId: 'trace-context-freshness-001', stage: 'implement', activeSkills: [],
  });
  const staleFreshness = contextFreshness.observe('trace-domain-tool', { payload: 'stale-freshness' }, {
    contextPlane: { projectContext: { receipts: [{ freshness: 'stale' }] } },
  });
  const staleFreshnessNotice = staleFreshness.find((item) => item.code === 'mssr-context-plane-freshness-review');
  assert.ok(staleFreshnessNotice, 'Stale Context Plane evidence must open a freshness review.');
  assert.equal(staleFreshnessNotice.details?.event, 'opened');
  assert.equal(contextFreshness.snapshot().projectMaintenance?.contextFreshnessIssues, 1);
  assert.equal(contextFreshness.snapshot().maintenanceRequired, true);

  const duplicateStaleFreshness = contextFreshness.observe('trace-domain-tool', { payload: 'stale-freshness-again' }, {
    contextPlane: { projectContext: { receipts: [{ freshness: 'stale' }] } },
  });
  assert.equal(duplicateStaleFreshness.some((item) => item.code === 'mssr-context-plane-freshness-review'), false, 'Stable stale evidence must stay quiet.');
  contextFreshness.observe('trace-domain-tool', { payload: 'no-context-plane' }, { ok: true });
  assert.equal(contextFreshness.snapshot().projectMaintenance?.contextFreshnessIssues, 1, 'A result without Context Plane evidence must not erase the last observed freshness state.');

  const freshAgain = contextFreshness.observe('trace-domain-tool', { payload: 'fresh-again' }, {
    contextPlane: { projectContext: { receipts: [{ freshness: 'fresh' }] } },
  });
  const freshnessResolved = freshAgain.find((item) => item.code === 'mssr-context-plane-freshness-resolved');
  assert.ok(freshnessResolved, 'Fresh evidence must resolve the current freshness warning.');
  assert.equal(freshnessResolved.details?.event, 'resolved');
  assert.equal(contextFreshness.snapshot().projectMaintenance?.contextFreshnessIssues, 0, 'Freshness must be current state, not a monotonic historical maximum.');
  assert.equal(contextFreshness.snapshot().maintenanceRequired, true, 'Accrued durable maintenance debt remains until an explicit maintenance close even after freshness resolves.');

  traceContext.resetSharedMssrTraceRegistryForTests();
  const conflictingFreshness = traceContext.createMssrTraceSessionCoordinator(schemas);
  conflictingFreshness.observe('skill_route_plan', { task: 'Detect conflicting Context Plane evidence.', caller: 'chatgpt-web', stage: 'implement' }, {
    traceId: 'trace-context-freshness-conflict-001', stage: 'implement', activeSkills: [],
  });
  const conflictNotices = conflictingFreshness.observe('trace-domain-tool', { payload: 'conflicting-freshness' }, {
    contextPlane: { contextMessages: { selected: [{ freshness: 'conflicting' }] } },
  });
  const conflictNotice = conflictNotices.find((item) => item.code === 'mssr-context-plane-freshness-conflict');
  assert.ok(conflictNotice);
  assert.equal(conflictNotice.severity, 'error');

  traceContext.resetSharedMssrTraceRegistryForTests();



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
  const prematureSuccess = negative.prepare('mssr_trace_record', {
    eventType: 'outcome',
    status: 'success',
    caller: 'chatgpt-web',
    stage: 'close',
  });
  assert.equal(prematureSuccess.blocked?.code, 'mssr-success-outcome-blocked-required-skills');
  assert.ok(
    prematureSuccess.notices.some((item) => item.code === 'mssr-success-outcome-blocked-required-skills'),
    'A successful outcome must be rejected until every required skill is loaded.',
  );
  assert.equal(negative.snapshot().closed, false, 'A rejected outcome must leave the trace open for recovery.');
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
  const recoveredSuccess = negative.prepare('mssr_trace_record', {
    eventType: 'outcome',
    status: 'success',
    caller: 'chatgpt-web',
    stage: 'close',
  });
  assert.equal(recoveredSuccess.blocked, undefined, 'The same trace may close after the missing load is repaired.');

  const staleClose = traceContext.createMssrTraceSessionCoordinator(schemas);
  staleClose.observe('skill_route_plan', { task: 'stale close lifecycle fixture', caller: 'chatgpt-web', stage: 'close' }, {
    traceId: 'trace-stale-close-001',
    stage: 'close',
    activeSkills: [{ name: 'skill-maintenance-loop', required: true }],
    coverage: { requiredPhases: ['discovery', 'verification', 'persistence', 'maintenance'] },
  });
  staleClose.observe('skill_load', {
    name: 'skill-maintenance-loop',
    traceId: 'trace-stale-close-001',
    required: true,
    stage: 'close',
  }, { traceId: 'trace-stale-close-001' });
  staleClose.observe('mssr_trace_record', {
    traceId: 'trace-stale-close-001',
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    completedPhases: ['discovery', 'safety', 'implementation', 'verification', 'persistence', 'maintenance'],
    primarySkill: 'skill-maintenance-loop',
  }, { traceId: 'trace-stale-close-001' });
  staleClose.observe('skill_route_plan', {
    task: 'stale close lifecycle fixture',
    caller: 'chatgpt-web',
    stage: 'resume',
    traceId: 'trace-stale-close-001',
  }, {
    traceId: 'trace-stale-close-001',
    stage: 'resume',
    activeSkills: [],
  });
  staleClose.observe('mssr_trace_record', {
    traceId: 'trace-stale-close-001',
    eventType: 'persistence',
    caller: 'chatgpt-web',
    stage: 'persist',
    status: 'success',
    persisted: true,
  }, { traceId: 'trace-stale-close-001' });
  const staleOutcome = staleClose.prepare('mssr_trace_record', {
    traceId: 'trace-stale-close-001',
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    verificationPassed: true,
    persisted: true,
  });
  assert.equal(
    staleOutcome.blocked?.code,
    'mssr-success-outcome-blocked-stale-close',
    'A resume/persistence after close maintenance must require a fresh close+maintenance pass before success outcome.',
  );
  assert.equal(staleClose.snapshot().maintenanceCloseFresh, false);

  staleClose.observe('skill_route_plan', {
    task: 'stale close lifecycle fixture',
    caller: 'chatgpt-web',
    stage: 'close',
    traceId: 'trace-stale-close-001',
  }, {
    traceId: 'trace-stale-close-001',
    stage: 'close',
    activeSkills: [{ name: 'skill-maintenance-loop', required: true }],
    coverage: { requiredPhases: ['discovery', 'verification', 'persistence', 'maintenance'] },
  });
  staleClose.observe('mssr_trace_record', {
    traceId: 'trace-stale-close-001',
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    completedPhases: ['discovery', 'safety', 'implementation', 'verification', 'persistence', 'maintenance'],
    primarySkill: 'skill-maintenance-loop',
  }, { traceId: 'trace-stale-close-001' });
  const refreshedOutcome = staleClose.prepare('mssr_trace_record', {
    traceId: 'trace-stale-close-001',
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    verificationPassed: true,
    persisted: true,
  });
  assert.equal(refreshedOutcome.blocked, undefined, 'A fresh close+maintenance pass after the latest persistence must permit success outcome.');
  assert.equal(staleClose.snapshot().maintenanceCloseFresh, true);

  const replacement = negative.prepare('skill_route_plan', { task: 'different unfinished task', stage: 'start' });
  assert.ok(replacement.notices.some((item) => item.code === 'mssr-active-trace-replaced-before-outcome'));

  const persistedStaleTraceId = 'trace-stale-close-persisted-001';
  observatory.recordMssrEvent({
    traceId: persistedStaleTraceId,
    eventType: 'route_planned',
    caller: 'chatgpt-web',
    stage: 'close',
    ok: true,
    taskHash: createHash('sha256').update('persisted stale close lifecycle fixture').digest('hex'),
    details: {
      workflowKey: 'persisted-stale-close-fixture',
      requiredPhases: ['discovery', 'verification', 'persistence', 'maintenance'],
      activeSkills: [{ name: 'skill-maintenance-loop', required: true }],
      agentProfile: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  });
  observatory.recordMssrEvent({
    traceId: persistedStaleTraceId,
    eventType: 'skill_loaded',
    caller: 'chatgpt-web',
    stage: 'close',
    skillName: 'skill-maintenance-loop',
    required: true,
    ok: true,
    details: {},
  });
  observatory.recordMssrEvent({
    traceId: persistedStaleTraceId,
    eventType: 'phase_completed',
    caller: 'chatgpt-web',
    stage: 'close',
    ok: true,
    details: { status: 'success', completedPhases: ['discovery', 'verification', 'persistence', 'maintenance'] },
  });
  observatory.recordMssrEvent({
    traceId: persistedStaleTraceId,
    eventType: 'route_planned',
    caller: 'chatgpt-web',
    stage: 'resume',
    ok: true,
    taskHash: createHash('sha256').update('persisted stale close lifecycle fixture').digest('hex'),
    details: {
      workflowKey: 'persisted-stale-close-fixture',
      requiredPhases: ['discovery', 'verification', 'persistence', 'maintenance'],
      activeSkills: [],
      agentProfile: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  });
  observatory.recordMssrEvent({
    traceId: persistedStaleTraceId,
    eventType: 'persistence',
    caller: 'chatgpt-web',
    stage: 'persist',
    ok: true,
    details: { status: 'success', persisted: true },
  });
  const persistedStaleState = observatory.readPersistedMssrTraceState(persistedStaleTraceId);
  assert.equal(persistedStaleState?.maintenanceRequired, true);
  assert.ok((persistedStaleState?.lifecycleRevision ?? 0) > (persistedStaleState?.closeRevision ?? 0));
  assert.notEqual(persistedStaleState?.maintenanceRevision, persistedStaleState?.lifecycleRevision);
  traceContext.resetSharedMssrTraceRegistryForTests();
  const restoredStaleClose = traceContext.createMssrTraceSessionCoordinator(schemas);
  const restoredStaleOutcome = restoredStaleClose.prepare('mssr_trace_record', {
    traceId: persistedStaleTraceId,
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    status: 'success',
    verificationPassed: true,
    persisted: true,
  });
  assert.equal(
    restoredStaleOutcome.blocked?.code,
    'mssr-success-outcome-blocked-stale-close',
    'A stale close reconstructed from persisted observatory events must remain blocked after coordinator-memory loss.',
  );
  observatory.recordMssrEvent({
    traceId: persistedStaleTraceId,
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
    ok: true,
    details: { status: 'partial', persisted: true, fixtureCleanup: true },
  });
  traceContext.resetSharedMssrTraceRegistryForTests();

  const rotatedOwner = traceContext.createMssrTraceSessionCoordinator(schemas);
  rotatedOwner.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-before-rotation',
    project: 'bridge-mcp',
  });
  rotatedOwner.observe('skill_route_plan', {
    task: 'rotated connector session fixture',
    caller: 'chatgpt-web',
    stage: 'implement',
  }, {
    traceId: 'trace-rotated-session-001',
    stage: 'implement',
    activeSkills: [{ name: 'required-skill', required: true }],
  });
  const rotatedResolver = traceContext.createMssrTraceSessionCoordinator(schemas);
  const rotatedSnapshot = rotatedResolver.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-after-rotation',
    project: 'bridge-mcp',
  });
  assert.equal(
    rotatedSnapshot.traceId,
    'trace-rotated-session-001',
    'A rotated connector session must recover the only open trace when the known project owner remains the same.',
  );
  const rotatedCrossProjectResolver = traceContext.createMssrTraceSessionCoordinator(schemas);
  const rotatedCrossProjectSnapshot = rotatedCrossProjectResolver.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-after-rotation',
    project: 'mauroprime-skills',
  });
  assert.equal(
    rotatedCrossProjectSnapshot.traceId,
    null,
    'A rotated connector session must not inherit a trace whose known project owner is different.',
  );
  const secondRotatedOwner = traceContext.createMssrTraceSessionCoordinator(schemas);
  secondRotatedOwner.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-second-task',
    project: 'mssr',
  });
  secondRotatedOwner.observe('skill_route_plan', {
    task: 'second concurrent rotated session fixture',
    caller: 'chatgpt-web',
    stage: 'implement',
  }, {
    traceId: 'trace-rotated-session-002',
    stage: 'implement',
    activeSkills: [{ name: 'required-skill', required: true }],
  });
  const ambiguousRotatedResolver = traceContext.createMssrTraceSessionCoordinator(schemas);
  const ambiguousRotatedSnapshot = ambiguousRotatedResolver.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-third-unknown',
    project: 'another-repository',
  });
  assert.equal(ambiguousRotatedSnapshot.traceId, null);
  assert.equal(
    ambiguousRotatedSnapshot.sharedOpenTraces,
    2,
    'Session rotation must not guess when two open traces remain compatible with the same caller.',
  );

  traceContext.resetSharedMssrTraceRegistryForTests();
  const staleSameSessionOwner = traceContext.createMssrTraceSessionCoordinator(schemas);
  staleSameSessionOwner.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-cross-project-continuity',
    project: 'older-project',
  });
  staleSameSessionOwner.observe('skill_route_plan', {
    task: 'older cross-project task',
    caller: 'chatgpt-web',
    stage: 'implement',
  }, {
    traceId: 'trace-cross-project-stale-001',
    stage: 'implement',
    activeSkills: [],
  });
  traceContext.ageSharedMssrTraceForTests('trace-cross-project-stale-001', 31 * 60_000);

  const freshSameSessionOwner = traceContext.createMssrTraceSessionCoordinator(schemas);
  freshSameSessionOwner.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-cross-project-continuity',
    project: 'newer-project',
  });
  freshSameSessionOwner.observe('skill_route_plan', {
    task: 'newer cross-project task',
    caller: 'chatgpt-web',
    stage: 'implement',
  }, {
    traceId: 'trace-cross-project-fresh-001',
    stage: 'implement',
    activeSkills: [],
  });

  const crossProjectResolver = traceContext.createMssrTraceSessionCoordinator(schemas);
  const staleWindowSnapshot = crossProjectResolver.snapshot();
  assert.equal(staleWindowSnapshot.sharedOpenTraces, 2, 'A stale trace must remain open and explicitly resumable until its normal lease/outcome closes it.');
  assert.equal(staleWindowSnapshot.autoRecoveryOpenTraces, 1, 'A trace older than the auto-recovery window must stop competing with the fresh trace.');
  const crossProjectTool = crossProjectResolver.prepare('trace-domain-tool', { payload: 'fixture' }, {
    caller: 'chatgpt-web',
    sessionKey: 'session-cross-project-continuity',
    project: 'third-project-without-exact-trace',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(crossProjectTool.args, 'traceId'),
    false,
    'A stateless call from another known project must not inherit the only fresh trace merely because the session matches.',
  );
  const sameProjectTool = crossProjectResolver.prepare('trace-domain-tool', { payload: 'fixture' }, {
    caller: 'chatgpt-web',
    sessionKey: 'session-cross-project-continuity',
    project: 'newer-project',
  });
  assert.equal(
    sameProjectTool.args.traceId,
    'trace-cross-project-fresh-001',
    'The same known project may still recover its fresh trace within the same session.',
  );

  traceContext.resetSharedMssrTraceRegistryForTests();
  const workflowOwner = traceContext.createMssrTraceSessionCoordinator(schemas);
  workflowOwner.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-workflow-owner',
    project: 'workflow-project',
    workflowKey: 'workflow-alpha',
  });
  workflowOwner.observe('skill_route_plan', {
    task: 'workflow owner fixture',
    caller: 'chatgpt-web',
    stage: 'implement',
    workflowKey: 'workflow-alpha',
  }, {
    traceId: 'trace-workflow-owner-001',
    stage: 'implement',
    workflowKey: 'workflow-alpha',
    activeSkills: [],
  });
  const sameWorkflowResolver = traceContext.createMssrTraceSessionCoordinator(schemas);
  const sameWorkflowSnapshot = sameWorkflowResolver.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-workflow-owner-rotated',
    project: 'workflow-project',
    workflowKey: 'workflow-alpha',
  });
  assert.equal(sameWorkflowSnapshot.traceId, 'trace-workflow-owner-001');
  const differentWorkflowResolver = traceContext.createMssrTraceSessionCoordinator(schemas);
  const differentWorkflowSnapshot = differentWorkflowResolver.resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'session-workflow-owner',
    project: 'workflow-project',
    workflowKey: 'workflow-beta',
  });
  assert.equal(
    differentWorkflowSnapshot.traceId,
    null,
    'A known workflow owner must not inherit a trace from another known workflow even inside the same project/session.',
  );

  traceContext.resetSharedMssrTraceRegistryForTests();
  const persistedOwnerTraceId = 'trace-persisted-owner-integrity-001';
  observatory.recordMssrEvent({
    traceId: persistedOwnerTraceId,
    eventType: 'route_planned',
    caller: 'chatgpt-web',
    stage: 'implement',
    ok: true,
    details: {
      workflowKey: 'persisted-workflow-alpha',
      activeSkills: [],
      requiredPhases: [],
      completedPhases: [],
      agentProfile: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    },
  });
  const persistedMetric = metrics.beginToolMetric('trace-domain-tool', { payload: 'persisted-owner-fixture' }, {
    traceId: persistedOwnerTraceId,
    caller: 'chatgpt-web',
    sessionKey: 'persisted-shared-session',
    project: 'persisted-project-alpha',
    workflowKey: 'persisted-workflow-alpha',
  });
  metrics.finishToolMetric(persistedMetric, true, 0);
  traceContext.resetSharedMssrTraceRegistryForTests();
  const persistedSameOwner = traceContext.createMssrTraceSessionCoordinator(schemas).resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'persisted-shared-session',
    project: 'persisted-project-alpha',
    workflowKey: 'persisted-workflow-alpha',
  });
  assert.equal(persistedSameOwner.traceId, persistedOwnerTraceId, 'Persisted recovery must still work for the exact project/workflow owner.');
  traceContext.resetSharedMssrTraceRegistryForTests();
  const persistedDifferentOwner = traceContext.createMssrTraceSessionCoordinator(schemas).resolveMetricContext({
    caller: 'chatgpt-web',
    sessionKey: 'persisted-shared-session',
    project: 'persisted-project-beta',
    workflowKey: 'persisted-workflow-beta',
  });
  assert.equal(
    persistedDifferentOwner.traceId,
    null,
    'Persisted recovery must not let a matching sessionKey override a different known project/workflow owner.',
  );

  traceContext.resetSharedMssrTraceRegistryForTests();
  const agentA = traceContext.createMssrTraceSessionCoordinator(schemas);
  const agentB = traceContext.createMssrTraceSessionCoordinator(schemas);
  const statelessCaller = traceContext.createMssrTraceSessionCoordinator(schemas);
  agentA.observe('skill_route_plan', { task: 'agent A', caller: 'chatgpt-web', stage: 'implement' }, {
    traceId: 'trace-agent-a-001', stage: 'implement', activeSkills: [{ name: 'required-skill', required: true }],
  });
  agentB.observe('skill_route_plan', { task: 'agent B', caller: 'chatgpt-web', stage: 'implement' }, {
    traceId: 'trace-agent-b-001', stage: 'implement', activeSkills: [{ name: 'required-skill', required: true }],
  });
  const ambiguous = statelessCaller.prepare('skill_load', { name: 'required-skill' });
  assert.equal(Object.prototype.hasOwnProperty.call(ambiguous.args, 'traceId'), false);
  assert.ok(ambiguous.notices.some((item) => item.code === 'mssr-trace-ambiguous'));

  traceContext.resetSharedMssrTraceRegistryForTests();
  const reminders = [];
  const watchdog = traceContext.createMssrTraceSessionCoordinator(schemas, {
    closureIdleMs: 20,
    onClosureReminder: (reminder) => reminders.push(reminder),
  });
  watchdog.observe('skill_route_plan', { task: 'web closure watchdog', caller: 'chatgpt-web', stage: 'implement' }, {
    traceId: 'trace-watchdog-web-001',
    stage: 'implement',
    activeSkills: [{ name: 'watchdog-skill', required: false }],
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 0, 'Route planning alone must not imply unfinished execution.');
  const watchdogLoad = watchdog.prepare('skill_load', { name: 'watchdog-skill' });
  watchdog.observe('skill_load', watchdogLoad.args, { traceId: 'trace-watchdog-web-001' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 0, 'Loading routed guidance alone must not trigger a closure reminder.');
  const watchdogTool = watchdog.prepare('trace-domain-tool', { payload: 'fixture' });
  watchdog.observe('trace-domain-tool', watchdogTool.args, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'Substantive Web tool activity without outcome should emit one closure reminder.');
  assert.equal(reminders[0].notice.code, 'mssr-web-outcome-missing-after-idle');
  assert.equal(reminders[0].notice.actions?.[0]?.toolName, 'mssr_trace_evidence');
  assert.equal(reminders[0].notice.actions?.[0]?.arguments?.traceId, 'trace-watchdog-web-001');
  assert.deepEqual(reminders[0].notice.details.closePreflight.missingRequiredSkills, []);

  watchdog.observe('trace-domain-tool', watchdogTool.args, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'Equivalent idle debt after later activity must stay quiet while the lifecycle fingerprint is unchanged.');
  const progressNotices = watchdog.observe('mssr_trace_record', {
    traceId: 'trace-watchdog-web-001',
    eventType: 'progress',
    caller: 'chatgpt-web',
    stage: 'implement',
    leaseMs: 30_000,
  }, { traceId: 'trace-watchdog-web-001' });
  const idleResolvedNotice = progressNotices.find((item) => item.code === 'mssr-web-outcome-idle-resolved');
  assert.ok(idleResolvedNotice, 'Explicit progress must resolve the current idle-attention state.');
  assert.equal(idleResolvedNotice.details?.event, 'resolved');
  const heartbeatSnapshot = watchdog.snapshot();
  assert.ok(heartbeatSnapshot.progressLeaseRemainingMs > 29_000, 'Progress must renew a bounded liveness lease.');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'A live progress lease must suppress another premature reminder.');
  watchdog.observe('mssr_trace_record', {
    traceId: 'trace-watchdog-web-001',
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
  }, { traceId: 'trace-watchdog-web-001' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'Outcome should cancel the progress-leased closure reminder.');
  assert.equal(watchdog.snapshot().progressLeaseRemainingMs, 0);

  const codexWatchdog = traceContext.createMssrTraceSessionCoordinator(schemas, {
    closureIdleMs: 20,
    onClosureReminder: (reminder) => reminders.push(reminder),
  });
  codexWatchdog.observe('skill_route_plan', { task: 'codex closure watchdog', caller: 'codex-local', stage: 'implement' }, {
    traceId: 'trace-watchdog-codex-001', stage: 'implement', activeSkills: [],
  });
  const codexTool = codexWatchdog.prepare('trace-domain-tool', { payload: 'fixture' });
  codexWatchdog.observe('trace-domain-tool', codexTool.args, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'Codex activity must not emit the ChatGPT Web reminder.');

  traceContext.resetSharedMssrTraceRegistryForTests();
  await withClientSession('Codex', async (call) => {
    const codexProject = path.join(sandbox, 'codex-project-attribution');
    const laterProject = path.join(sandbox, 'later-project-context');
    const supportingProject = path.join(sandbox, 'supporting-repository');
    fs.mkdirSync(codexProject, { recursive: true });
    fs.mkdirSync(laterProject, { recursive: true });
    fs.mkdirSync(supportingProject, { recursive: true });
    await call('project_context_load', {
      projectRoot: codexProject,
      task: 'Load the project before opening its routed task.',
    });
    const codexRoute = await call('skill_route_plan', {
      task: 'Verify project attribution for a Codex session without exposed session metadata.',
      context: 'The project context was loaded immediately before this route in the same MCP session.',
      intent,
      caller: 'codex-local',
      stage: 'start',
      sources: ['codex-local'],
      maxSkills: 12,
    });
    for (const skill of codexRoute.activeSkills.filter((item) => item.required)) {
      await call('skill_load', {
        name: skill.name,
        source: 'codex',
        traceId: codexRoute.traceId,
        required: true,
        stage: 'start',
      });
    }
    await call('work_once', {
      cwd: supportingProject,
      command: 'node --version',
      timeoutMs: 10_000,
    });
    await call('mssr_trace_record', {
      traceId: codexRoute.traceId,
      eventType: 'outcome',
      caller: 'codex-local',
      stage: 'close',
      status: 'partial',
      primarySkill: codexRoute.activeSkills[0].name,
      supportingSkills: [],
      verificationPassed: true,
      persisted: false,
      summary: 'Project attribution fixture closed as partial because it intentionally does not exercise persistence/maintenance.',
    });
    await call('project_context_load', {
      projectRoot: laterProject,
      task: 'Load another project after the previous trace closed.',
    });

    const recentProjectMetrics = metrics.getRecentMetrics(20, 'active').recent;
    const attributedRoute = recentProjectMetrics.find((row) =>
      row.tool === 'skill_route_plan' && row.trace_id === codexRoute.traceId);
    assert.equal(attributedRoute?.project, 'codex-project-attribution');
    const attributedLoad = recentProjectMetrics.find((row) =>
      row.tool === 'skill_load' && row.trace_id === codexRoute.traceId);
    assert.equal(attributedLoad?.project, 'codex-project-attribution');
    const supportingCall = recentProjectMetrics.find((row) =>
      row.tool === 'work_once' && row.trace_id === codexRoute.traceId);
    assert.equal(
      supportingCall?.project,
      'codex-project-attribution',
      'An auxiliary cwd must not replace the primary project loaded for the session.',
    );
    assert.ok(
      codexRoute.activeSkills.some((skill) => skill.name === attributedLoad?.operation_subject),
      'Recent metrics must expose the privacy-safe skill name loaded by skill_load.',
    );
    const laterContextMetric = recentProjectMetrics.find((row) =>
      row.tool === 'project_context_load' && row.project === 'later-project-context');
    assert.equal(laterContextMetric?.trace_id, null, 'A closed trace must not leak into later context-load metrics.');
  });

  traceContext.resetSharedMssrTraceRegistryForTests();
  await withClientSession('Codex', async (call) => {
    const previousProject = path.join(sandbox, 'previous-open-trace-project');
    const freshProject = path.join(sandbox, 'fresh-route-project');
    fs.mkdirSync(previousProject, { recursive: true });
    fs.mkdirSync(freshProject, { recursive: true });

    await call('project_context_load', {
      projectRoot: previousProject,
      task: 'Load the project for the trace that will remain open.',
      workflowKey: 'previous-open-trace-workflow',
    });
    const previousRoute = await call('skill_route_plan', {
      task: 'Open a routed task that remains active while another project is loaded.',
      context: 'This route intentionally remains open to reproduce cross-task project contamination.',
      workflowKey: 'previous-open-trace-workflow',
      intent,
      caller: 'codex-local',
      stage: 'start',
      sources: ['codex-local'],
      maxSkills: 12,
    });

    await call('project_context_load', {
      projectRoot: freshProject,
      task: 'Load the project that must own the next independent route.',
      workflowKey: 'fresh-route-project-isolation',
    });
    const freshRoute = await call('skill_route_plan', {
      task: 'Open an independent route after loading a different project.',
      context: 'The previous trace remains open, but this new route must use the freshly loaded project.',
      workflowKey: 'fresh-route-project-isolation',
      intent,
      caller: 'codex-local',
      stage: 'start',
      sources: ['codex-local'],
      maxSkills: 12,
    });

    assert.notEqual(freshRoute.traceId, previousRoute.traceId);
    const recentProjectMetrics = metrics.getRecentMetrics(40, 'active').recent;
    const freshContextMetric = recentProjectMetrics.find((row) =>
      row.tool === 'project_context_load' && row.project === 'fresh-route-project');
    assert.equal(
      freshContextMetric?.trace_id,
      null,
      'Switching to a different explicit project/workflow owner must detach project_context_load from the previous open trace.',
    );
    const freshRouteMetric = recentProjectMetrics.find((row) =>
      row.tool === 'skill_route_plan' && row.trace_id === freshRoute.traceId);
    assert.equal(
      freshRouteMetric?.project,
      'fresh-route-project',
      'A new route must prefer freshly loaded project context over the project of another open trace.',
    );
    assert.equal(freshRouteMetric?.workflow_key, 'fresh-route-project-isolation');

    const previousEvidence = observatory.getMssrTraceEvidence(previousRoute.traceId, 100);
    const freshEvidence = observatory.getMssrTraceEvidence(freshRoute.traceId, 100);
    assert.deepEqual(previousEvidence.identity.projects, ['previous-open-trace-project']);
    assert.deepEqual(previousEvidence.workflowKeys, ['previous-open-trace-workflow']);
    assert.deepEqual(freshEvidence.identity.projects, ['fresh-route-project']);
    assert.deepEqual(freshEvidence.workflowKeys, ['fresh-route-project-isolation']);
  });

  observatory.recordMssrSkillLoad({
    traceId: 'fixture-context-required-overflow',
    skillName: 'required-context-fixture',
    required: true,
    loaded: true,
    via: 'skill_bootstrap',
    contentMode: 'selective',
    totalCharsLoaded: 120,
    fullSkillChars: 200,
    budgetExceeded: true,
  });
  observatory.recordMssrSkillLoad({
    traceId: 'fixture-context-optional-overflow',
    skillName: 'optional-context-fixture',
    required: false,
    loaded: true,
    via: 'skill_bootstrap',
    contentMode: 'selective',
    totalCharsLoaded: 80,
    fullSkillChars: 180,
    budgetExceeded: true,
  });
  observatory.recordMssrSkillLoad({
    traceId: 'fixture-context-budget-skip',
    skillName: 'skipped-context-fixture',
    required: false,
    loaded: false,
    via: 'skill_bootstrap',
    contentMode: 'selective',
    totalCharsLoaded: 0,
    fullSkillChars: 160,
    budgetExceeded: true,
    skipped: true,
    skippedReason: 'optional-context-exceeds-budget',
  });
  const pressureSummary = observatory.queryMssrObservatory({ kind: 'summary', scope: 'all', days: 30 });
  assert.ok(pressureSummary.contextAssembly.requiredOverflowLoads >= 1);
  assert.ok(pressureSummary.contextAssembly.optionalOverflowLoads >= 1);
  assert.ok(pressureSummary.contextAssembly.skippedForBudgetLoads >= 1);
  assert.equal(
    pressureSummary.contextAssembly.skillPressure.find((row) => row.name === 'required-context-fixture')?.recommendation,
    'review-required-context',
  );
  assert.equal(
    pressureSummary.contextAssembly.skillPressure.find((row) => row.name === 'optional-context-fixture')?.recommendation,
    'review-optional-context',
  );
  assert.equal(
    pressureSummary.contextAssembly.skillPressure.find((row) => row.name === 'skipped-context-fixture')?.recommendation,
    'review-budget',
  );

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
  traceContext.resetSharedMssrTraceRegistryForTests();
  await robloxClient.closeRobloxMcpConnection().catch(() => {});
  observatory.closeMssrObservatoryForTests();
  metrics.closeMetricsForTests();
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
