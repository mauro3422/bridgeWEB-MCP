import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mssr-lifecycle-host-'));
const metricsDir = path.join(sandbox, 'metrics');
const logDir = path.join(sandbox, 'logs');
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, 'bridge-metrics.sqlite');
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(logDir, 'mssr-events.jsonl');
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, 'mssr-observability-state.json');
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

const [
  { Client },
  { InMemoryTransport },
  { createBridgeServer },
  { createDefaultToolRegistry },
  { evaluateBridgeMssrLifecyclePreflight },
  metrics,
  observatory,
] = await Promise.all([
  import('@modelcontextprotocol/sdk/client/index.js'),
  import('@modelcontextprotocol/sdk/inMemory.js'),
  import('../dist/bridge-server.js'),
  import('../dist/tool-registry.js'),
  import('../dist/mssr-lifecycle-coverage.js'),
  import('../dist/metrics.js'),
  import('../dist/mssr-observatory.js'),
]);

function payload(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text;
  assert.equal(typeof text, 'string', 'Expected text MCP result.');
  return JSON.parse(text);
}

async function callFresh(name, args = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBridgeServer();
  const client = new Client({ name: `lifecycle-host-${name}`, version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return payload(await client.callTool({ name, arguments: args }));
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const registry = createDefaultToolRegistry();
const readTool = registry.tools.find((tool) => tool.name === 'read_text_file');
const writeTool = registry.tools.find((tool) => tool.name === 'write_text_file');
const routeTool = registry.tools.find((tool) => tool.name === 'skill_route_plan');
assert.ok(readTool && writeTool && routeTool, 'Expected lifecycle fixture tools in registry.');

assert.deepEqual(readTool.metadata?.mssrLifecycle, { effect: 'read', scale: 'trivial' });
assert.deepEqual(writeTool.metadata?.mssrLifecycle, { effect: 'mutate', scale: 'unknown' });
assert.deepEqual(routeTool.metadata?.mssrLifecycle, { effect: 'control-plane', scale: 'trivial' });

const noTrace = { active: false, closed: false, traceId: null, routeCount: 0, missingRequiredSkills: [] };
const readyTrace = { active: true, closed: false, traceId: 'trace-ready-001', routeCount: 1, missingRequiredSkills: [] };
const incompleteTrace = { active: true, closed: false, traceId: 'trace-incomplete-001', routeCount: 1, missingRequiredSkills: ['required-skill'] };

const trivialRead = evaluateBridgeMssrLifecyclePreflight({ tool: readTool, trace: noTrace, projectScoped: true });
assert.equal(trivialRead.intercepted, false, 'Trivial reads must remain lightweight without MSSR bootstrap.');

const controlPlane = evaluateBridgeMssrLifecyclePreflight({ tool: routeTool, trace: noTrace, projectScoped: true });
assert.equal(controlPlane.intercepted, false, 'MSSR control-plane tools must never recursively bootstrap themselves.');

const missingLifecycle = evaluateBridgeMssrLifecyclePreflight({ tool: writeTool, trace: noTrace, projectScoped: true });
assert.equal(missingLifecycle.intercepted, true, 'A mutation without lifecycle must be intercepted.');
assert.equal(missingLifecycle.nextTool, 'skill_bootstrap');
assert.equal(missingLifecycle.decision.action, 'ensure-trace-and-route');

const reusableRoute = evaluateBridgeMssrLifecyclePreflight({ tool: writeTool, trace: readyTrace, projectScoped: true });
assert.equal(reusableRoute.intercepted, false, 'A compatible ready route must be reused without ceremony.');
assert.equal(reusableRoute.decision.action, 'continue-managed-route');

const incompleteRoute = evaluateBridgeMssrLifecyclePreflight({ tool: writeTool, trace: incompleteTrace, projectScoped: true });
assert.equal(incompleteRoute.intercepted, true, 'A route with required skills still missing must not authorize mutation.');
assert.equal(incompleteRoute.nextTool, 'skill_bootstrap');

const sourcePath = path.join(sandbox, 'source.txt');
const targetPath = path.join(sandbox, 'blocked-write.txt');
fs.writeFileSync(sourcePath, 'lightweight read fixture\n', 'utf8');

const readResult = await callFresh('read_text_file', { path: sourcePath });
assert.match(JSON.stringify(readResult), /lightweight read fixture/, 'A trivial read must actually execute.');
assert.notEqual(readResult.status, 'mssr-lifecycle-preflight-required');

const writeResult = await callFresh('write_text_file', { path: targetPath, content: 'must not be written\n' });
assert.equal(writeResult.executed, false, 'Dispatcher must report that intercepted mutation did not execute.');
assert.equal(writeResult.status, 'mssr-lifecycle-preflight-required');
assert.equal(writeResult.effect, 'mutate');
assert.equal(writeResult.nextAction?.toolName, 'skill_bootstrap');
assert.equal(fs.existsSync(targetPath), false, 'Intercepted mutation must not touch disk.');
assert.equal(JSON.stringify(writeResult).includes('mssr-unrouted-tool-call'), false, 'Correctly intercepted work must not be reported by C2b as an executed unrouted call.');

observatory.closeMssrObservatoryForTests();
metrics.closeMetricsForTests();
fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
console.log('MSSR automatic lifecycle host adoption test passed.');
