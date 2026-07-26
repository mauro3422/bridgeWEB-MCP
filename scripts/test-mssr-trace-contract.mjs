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

  const sessionMeta = { 'openai/session': 'web-session-fixture-001' };
  const fixtureProject = path.join(sandbox, 'fixture-project');
  fs.mkdirSync(fixtureProject, { recursive: true });
  await callFresh('project_context_load', {
    projectRoot: fixtureProject,
    task: 'Load bounded fixture project context.',
  }, sessionMeta, 'openai-mcp');
  const untracedWeb = await callFresh('search_files', {
    path: fixtureProject,
    pattern: 'nothing-to-find',
    maxResults: 5,
  }, sessionMeta, 'openai-mcp');
  assert.ok(
    untracedWeb.bridgeNotices?.items?.some((notice) => notice.code === 'mssr-unrouted-tool-call'),
    'An eligible Web tool without a compatible trace must emit an observable non-blocking warning.',
  );
  const expectedSessionKey = `session-${createHash('sha256').update('web-session-fixture-001').digest('hex').slice(0, 16)}`;
  const scopedProfiles = metrics.getMetricsOverview('active').agentProfiles;
  const fixtureProfile = scopedProfiles.find((profile) =>
    profile.caller === 'chatgpt-web'
    && profile.project === 'fixture-project'
    && profile.session_key === expectedSessionKey);
  assert.equal(fixtureProfile?.eligible_calls, 1);
  assert.equal(fixtureProfile?.traced_calls, 0);
  assert.equal(fixtureProfile?.untraced_calls, 1);
  assert.equal(fixtureProfile?.mssr_trace_coverage, 0);

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

  traceContext.resetSharedMssrTraceRegistryForTests();
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
  const replacement = negative.prepare('skill_route_plan', { task: 'different unfinished task', stage: 'start' });
  assert.ok(replacement.notices.some((item) => item.code === 'mssr-active-trace-replaced-before-outcome'));

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
    traceId: 'trace-watchdog-web-001', stage: 'implement', activeSkills: [],
  });
  const watchdogTool = watchdog.prepare('trace-domain-tool', { payload: 'fixture' });
  watchdog.observe('trace-domain-tool', watchdogTool.args, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'Web tool activity without outcome should emit one closure reminder.');
  assert.equal(reminders[0].notice.code, 'mssr-web-outcome-missing-after-idle');

  watchdog.observe('trace-domain-tool', watchdogTool.args, { ok: true });
  watchdog.observe('mssr_trace_record', {
    traceId: 'trace-watchdog-web-001',
    eventType: 'outcome',
    caller: 'chatgpt-web',
    stage: 'close',
  }, { traceId: 'trace-watchdog-web-001' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(reminders.length, 1, 'Outcome should cancel a pending closure reminder.');

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
      status: 'success',
      primarySkill: codexRoute.activeSkills[0].name,
      supportingSkills: [],
      verificationPassed: true,
      persisted: false,
      summary: 'Project attribution fixture closed.',
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
