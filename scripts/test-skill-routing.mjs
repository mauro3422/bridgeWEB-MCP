import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const fixturePath = path.join(root, 'config', 'skill-routing', 'skill-routing-fixtures.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  throw new Error(`Invalid routing fixture file: ${fixturePath}`);
}

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();
const failures = [];
const results = [];
const expandedCases = fixture.cases.flatMap((testCase) => {
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
  results.push({
    name: testCase.name,
    mode: route.classificationMode,
    contextUsed: route.contextUsed,
    active: route.loadOrder,
    deferred: route.deferredLoadOrder,
    warnings: route.warnings,
  });
}

const audit = await registry.call('skill_route_audit', { sources: ['codex-local', 'codex-system'] });
if (!audit.ok) failures.push(...audit.errors.map((error) => `audit error: ${error}`));
if (audit.maintenanceRequired) failures.push(...audit.maintenanceReasons.map((reason) => `audit maintenance: ${reason}`));

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, fixturePath, failures, results, audit }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  fixturePath,
  cases: results.length,
  results,
  audit: {
    ok: audit.ok,
    maintenanceRequired: audit.maintenanceRequired,
    counts: audit.counts,
    paths: audit.paths,
  },
}, null, 2));
