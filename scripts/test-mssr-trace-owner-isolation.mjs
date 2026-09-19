import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mssr-owner-isolation-'));
const metricsDir = path.join(sandbox, 'metrics');
const logDir = path.join(sandbox, 'logs');
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, 'bridge-metrics.sqlite');
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(logDir, 'mssr-events.jsonl');
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, 'mssr-observability-state.json');

const [traceContext, observatory, metrics] = await Promise.all([
  import('../dist/mssr-trace-context.js'),
  import('../dist/mssr-observatory.js'),
  import('../dist/metrics.js'),
]);
const schemas = [
  { name: 'skill_route_plan', inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } } },
  { name: 'trace-domain-tool', inputSchema: { type: 'object', properties: { traceId: { type: 'string' }, payload: { type: 'string' } }, additionalProperties: false } },
];
const traceId = 'trace-owner-isolation-001';

function openRoute(project, workflowKey) {
  const coordinator = traceContext.createMssrTraceSessionCoordinator(schemas);
  const routeArgs = { task: 'Trace owner isolation fixture', caller: 'chatgpt-web', stage: 'implement', workflowKey };
  coordinator.prepare('skill_route_plan', routeArgs, { caller: 'chatgpt-web', project, workflowKey });
  coordinator.observe('skill_route_plan', routeArgs, { traceId, stage: 'implement', activeSkills: [] });
  observatory.recordMssrEvent({
    traceId,
    eventType: 'route_planned',
    caller: 'chatgpt-web',
    stage: 'implement',
    taskHash: 'owner-isolation-fixture',
    details: { workflowKey, activeSkills: [], requiredPhases: [], completedPhases: [] },
  });
  const metric = metrics.beginToolMetric('skill_route_plan', routeArgs, {
    caller: 'chatgpt-web',
    traceId,
    project,
    workflowKey,
    sessionKey: 'owner-isolation-session',
  });
  metrics.finishToolMetric(metric, true, 0);
  return coordinator;
}
const owner = openRoute('project-a', 'workflow-a');
assert.equal(owner.snapshot().project, 'project-a');
assert.equal(owner.snapshot().workflowKey, 'workflow-a');

const sameOwner = traceContext.createMssrTraceSessionCoordinator(schemas);
const same = sameOwner.prepare('trace-domain-tool', { traceId, payload: 'same-owner' }, {
  caller: 'chatgpt-web', project: 'project-a', workflowKey: 'workflow-a',
});
assert.equal(same.blocked, undefined, 'A→A explicit trace reuse must remain valid.');
assert.equal(sameOwner.snapshot().traceId, traceId);

const wrongProject = traceContext.createMssrTraceSessionCoordinator(schemas);
const projectMismatch = wrongProject.prepare('trace-domain-tool', { traceId, payload: 'wrong-project' }, {
  caller: 'chatgpt-web', project: 'project-b', workflowKey: 'workflow-a',
});
assert.equal(projectMismatch.blocked?.code, 'mssr-trace-owner-mismatch', 'A→B explicit adoption must be blocked before adopt().');
assert.deepEqual(projectMismatch.blocked?.details?.mismatchFields, ['project']);
assert.equal(wrongProject.snapshot().traceId, null, 'A blocked mismatch must not become the coordinator local trace.');

const wrongWorkflow = traceContext.createMssrTraceSessionCoordinator(schemas);
const workflowMismatch = wrongWorkflow.prepare('trace-domain-tool', { traceId, payload: 'wrong-workflow' }, {
  caller: 'chatgpt-web', project: 'project-a', workflowKey: 'workflow-b',
});
assert.equal(workflowMismatch.blocked?.code, 'mssr-trace-owner-mismatch', 'Workflow owner mismatch must be blocked.');
assert.deepEqual(workflowMismatch.blocked?.details?.mismatchFields, ['workflowKey']);
assert.equal(wrongWorkflow.snapshot().traceId, null);

traceContext.resetSharedMssrTraceRegistryForTests();
const afterRestart = traceContext.createMssrTraceSessionCoordinator(schemas);
const restartSame = afterRestart.prepare('trace-domain-tool', { traceId, payload: 'restart-same' }, {
  caller: 'chatgpt-web', project: 'project-a', workflowKey: 'workflow-a',
});
assert.equal(restartSame.blocked, undefined, 'Restart + explicit trace + same owner must restore and reuse the trace.');
assert.equal(afterRestart.snapshot().traceId, traceId);

traceContext.resetSharedMssrTraceRegistryForTests();
const restartWrong = traceContext.createMssrTraceSessionCoordinator(schemas);
const restartMismatch = restartWrong.prepare('trace-domain-tool', { traceId, payload: 'restart-wrong' }, {
  caller: 'chatgpt-web', project: 'project-b', workflowKey: 'workflow-a',
});
assert.equal(restartMismatch.blocked?.code, 'mssr-trace-owner-mismatch', 'Restart + wrong root must remain blocked after persisted restore.');
assert.equal(restartWrong.snapshot().traceId, null);
traceContext.resetSharedMssrTraceRegistryForTests();
observatory.closeMssrObservatoryForTests();
metrics.closeMetricsForTests();
fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
console.log('MSSR trace owner isolation test passed.');
