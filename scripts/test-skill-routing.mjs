import fs from 'node:fs';
import path from 'node:path';
import { routingFixturesPath } from '@mauroprime/mssr';

const root = path.resolve(process.cwd());
const fixturePath = routingFixturesPath();
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  throw new Error(`Invalid routing fixture file: ${fixturePath}`);
}

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const { closeRobloxMcpConnection } = await import('../dist/integrations/roblox-mcp-client.js');
const registry = createDefaultToolRegistry();
const failures = [];
const results = [];
const fullIntegration = process.argv.includes('--full-integration') || process.env.BRIDGE_SKILL_ROUTING_FULL === '1';
const integrationCaseNames = new Set([
  'skill-created-or-updated',
  'git-change-publication-push-race',
  'visual-reference-replication-negative-text-only',
  'bridge-tool-authoring-positive',
  'bridge-tool-authoring-verification',
  'bridge-tool-authoring-continuation',
  'bridge-tool-authoring-negative-existing-tool-use',
  'bridge-tool-authoring-negative-one-off-command',
]);
const selectedCases = fullIntegration
  ? fixture.cases
  : fixture.cases.filter((testCase) => integrationCaseNames.has(testCase.name));
if (!fullIntegration && selectedCases.length !== integrationCaseNames.size) {
  const found = new Set(selectedCases.map((testCase) => testCase.name));
  const missing = [...integrationCaseNames].filter((name) => !found.has(name));
  throw new Error(`Bridge routing integration fixtures missing: ${missing.join(', ')}`);
}
const expandedCases = selectedCases.flatMap((testCase) => {
  const tasks = [testCase.task, ...(testCase.taskVariants ?? [])];
  return tasks.map((task, index) => ({
    ...testCase,
    task,
    name: index === 0 ? testCase.name : `${testCase.name}:${task}`,
  }));
});

const requireMembers = (caseName, label, actual, expected = []) => {
  for (const name of expected) {
    if (!actual.includes(name)) failures.push(`${caseName}: ${label} missing '${name}' (actual: ${actual.join(', ') || 'none'})`);
  }
};

const rejectMembers = (caseName, label, actual, expected = []) => {
  for (const name of expected) {
    if (actual.includes(name)) failures.push(`${caseName}: ${label} unexpectedly contains '${name}'`);
  }
};

for (const testCase of expandedCases) {
  const route = await registry.call('skill_route_plan', {
    task: testCase.task,
    context: testCase.context,
    intent: testCase.intent,
    caller: testCase.caller,
    stage: testCase.stage,
    completedPhases: testCase.completedPhases ?? [],
    sources: testCase.sources,
    maxSkills: 12,
  });
  const expected = testCase.expect ?? {};
  if (expected.classificationMode && route.classificationMode !== expected.classificationMode) {
    failures.push(`${testCase.name}: expected classificationMode=${expected.classificationMode}, got ${route.classificationMode}`);
  }
  if (typeof expected.contextUsed === 'boolean' && route.contextUsed !== expected.contextUsed) {
    failures.push(`${testCase.name}: expected contextUsed=${expected.contextUsed}, got ${route.contextUsed}`);
  }
  requireMembers(testCase.name, 'active', route.loadOrder, expected.activeIncludes);
  rejectMembers(testCase.name, 'active', route.loadOrder, expected.activeExcludes);
  requireMembers(testCase.name, 'deferred', route.deferredLoadOrder, expected.deferredIncludes);
  rejectMembers(testCase.name, 'deferred', route.deferredLoadOrder, expected.deferredExcludes);
  if (Array.isArray(expected.missingRequiredPhases)) {
    const actualMissing = [...(route.coverage?.missingRequiredPhases ?? [])].sort();
    const expectedMissing = [...expected.missingRequiredPhases].sort();
    if (JSON.stringify(actualMissing) !== JSON.stringify(expectedMissing)) {
      failures.push(`${testCase.name}: expected missingRequiredPhases=${expectedMissing.join(', ') || 'none'}, got ${actualMissing.join(', ') || 'none'}`);
    }
  }
  if (Array.isArray(expected.agentFallbackPhases)) {
    const actualFallback = [...(route.coverage?.agentFallbackPhases ?? [])].sort();
    const expectedFallback = [...expected.agentFallbackPhases].sort();
    if (JSON.stringify(actualFallback) !== JSON.stringify(expectedFallback)) {
      failures.push(`${testCase.name}: expected agentFallbackPhases=${expectedFallback.join(', ') || 'none'}, got ${actualFallback.join(', ') || 'none'}`);
    }
  }
  results.push({
    name: testCase.name,
    mode: route.classificationMode,
    contextUsed: route.contextUsed,
    active: route.loadOrder,
    deferred: route.deferredLoadOrder,
    missingRequiredPhases: route.coverage?.missingRequiredPhases ?? [],
    agentFallbackPhases: route.coverage?.agentFallbackPhases ?? [],
    warnings: route.warnings,
  });
}

const audit = await registry.call('skill_route_audit', { sources: ['codex-local', 'codex-system'] });
if (!audit.ok) failures.push(...audit.errors.map((error) => `audit error: ${error}`));
if (audit.maintenanceRequired) failures.push(...audit.maintenanceReasons.map((reason) => `audit maintenance: ${reason}`));

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, fixturePath, failures, results, audit }, null, 2));
  await closeRobloxMcpConnection();
  process.exit(1);
}

const verbose = process.argv.includes('--verbose') || process.env.BRIDGE_SKILL_ROUTING_VERBOSE === '1';
console.log(JSON.stringify({
  ok: true,
  fixturePath,
  canonicalBaseCases: fixture.cases.length,
  canonicalEffectiveCases: fixture.cases.reduce((total, testCase) => total + 1 + (testCase.taskVariants?.length ?? 0), 0),
  integrationCases: results.length,
  fullIntegration,
  ...(verbose ? { results } : {}),
  audit: {
    ok: audit.ok,
    maintenanceRequired: audit.maintenanceRequired,
    counts: audit.counts,
    paths: audit.paths,
  },
}, null, 2));
await closeRobloxMcpConnection();








