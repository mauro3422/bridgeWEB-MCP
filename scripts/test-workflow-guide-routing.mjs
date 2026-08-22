import assert from 'node:assert/strict';

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();

const mediaCases = [
  'escuchá este audio y decime qué dice',
  'transcribime este audio',
  'mirá este video, escuchá el audio y entendé este meme',
  'usa el sistema de transcripción para escuchar este video',
];

for (const task of mediaCases) {
  const recommendation = await registry.call('workflow_guide_recommend', { task, maxResults: 5 });
  assert.equal(recommendation.recommendation.action, 'load_existing', `guide recommendation missing for: ${task}`);
  assert.equal(recommendation.recommendation.guide, 'narrated-media-review', `wrong guide for: ${task}`);

  const bootstrap = await registry.call('skill_bootstrap', {
    task,
    context: '',
    intent: {
      summary: 'Inspect or transcribe one user-provided audio/video source through the canonical media workflow.',
      domains: ['other'],
      actions: ['analyze', 'review'],
      artifacts: ['document'],
      needs: [],
      signals: ['nominal'],
      risk: 'read-only',
      ambiguity: 'low',
    },
    caller: 'chatgpt-web',
    model: 'fixture-model',
    reasoningEffort: 'unknown',
    stage: 'start',
    maxSkills: 4,
    selectionMode: 'host-gated',
    workflowKey: 'workflow-guide-media-routing-fixture',
  });

  assert.equal(bootstrap.workflowGuideRecommendation.recommendation.action, 'load_existing', `bootstrap did not surface guide recommendation for: ${task}`);
  assert.equal(bootstrap.workflowGuideRecommendation.recommendation.guide, 'narrated-media-review', `bootstrap surfaced wrong guide for: ${task}`);
  assert.equal(bootstrap.workflowGuide, null, `oversized narrated-media guide must not consume the compact bootstrap envelope for: ${task}`);
  assert.equal(bootstrap.workflowGuideDelivery?.status, 'deferred-explicit-load', `oversized narrated-media guide must be split into an explicit call for: ${task}`);
  assert.equal(bootstrap.workflowGuideDelivery?.nextAction?.toolName, 'workflow_guide_load', `deferred guide action missing for: ${task}`);
  assert.equal(bootstrap.lifecycleGate?.postContextAction?.toolName, 'workflow_guide_load', `completed context must retain the deferred guide action for: ${task}`);
  const loadedGuide = await registry.call('workflow_guide_load', bootstrap.workflowGuideDelivery.nextAction.arguments);
  assert.equal(loadedGuide.guide, 'narrated-media-review', `deferred narrated-media guide did not load for: ${task}`);
  assert.equal(loadedGuide.recommendedTools?.includes('media_review_ingest'), true, `canonical media tool missing from deferred guide for: ${task}`);
}

const plan = await registry.call('skill_route_plan', {
  task: 'escuchá este audio',
  context: '',
  intent: {
    summary: 'Listen to one attached audio source.',
    domains: ['other'],
    actions: ['analyze'],
    artifacts: ['document'],
    needs: [],
    signals: ['nominal'],
    risk: 'read-only',
    ambiguity: 'low',
  },
  caller: 'chatgpt-web',
  model: 'fixture-model',
  reasoningEffort: 'unknown',
  stage: 'start',
  responseMode: 'compact',
  workflowKey: 'workflow-guide-media-routing-plan-fixture',
});
assert.equal(plan.workflowGuideRecommendation.recommendation.action, 'load_existing');
assert.equal(plan.workflowGuideRecommendation.recommendation.guide, 'narrated-media-review');
assert.equal(plan.workflowGuide, null, 'route plan should recommend but not load the guide; bootstrap performs the load');

const modularTask = 'Review and design the gradual modularization of this workspace using Functional Core / Imperative Shell and fixture-earned ownership boundaries; do not implement yet.';
const modularRecommendation = await registry.call('workflow_guide_recommend', { task: modularTask, maxResults: 5 });
assert.equal(modularRecommendation.recommendation.action, 'load_existing', 'modular architecture should load an existing workflow guide');
assert.equal(modularRecommendation.recommendation.guide, 'safe-modular-refactoring', 'modular architecture should select safe-modular-refactoring');
assert.equal(modularRecommendation.existingSkillCoverage.matches.some((item) => item.name.startsWith('figma-')), false, 'modular architecture must not claim Figma skill coverage from generic design/code tokens');

const coverageDiagnosticTask = 'Fix generic existingSkillCoverage false positives: roblox-save-backup-recovery and roblox-placement-system-authoring must not cover Godot project-context maintenance; visual-evidence-cataloging must not cover panorama context verification.';
const coverageDiagnostic = await registry.call('workflow_guide_recommend', { task: coverageDiagnosticTask, maxResults: 5 });
assert.equal(coverageDiagnostic.existingSkillCoverage.covered, false, 'routing/coverage diagnostics must not treat named example skills as procedure ownership');
assert.equal(coverageDiagnostic.recommendation.action, 'none', 'routing/coverage diagnostics must not auto-load a guide or propose another workflow from example capability names');
for (const name of ['roblox-save-backup-recovery', 'roblox-placement-system-authoring', 'visual-evidence-cataloging']) {
  assert.equal(coverageDiagnostic.existingSkillCoverage.matches.some((item) => item.name === name), false, `${name} must remain diagnostic evidence, not existing coverage`);
}

const positiveCoverageCases = [
  ['In Roblox Studio, implement a placement system with a ghost preview, rotation and snapping.', 'roblox-placement-system-authoring'],
  ['Save and back up my Roblox Studio place so I can recover it after risky edits.', 'roblox-save-backup-recovery'],
  ['Implement this Figma design as code.', 'figma-design-to-code'],
];
for (const [task, expectedSkill] of positiveCoverageCases) {
  const result = await registry.call('workflow_guide_recommend', { task, maxResults: 5 });
  assert.equal(result.existingSkillCoverage.matches.some((item) => item.name === expectedSkill), true, `true specialist coverage regressed for ${expectedSkill}`);
}

const unrelated = await registry.call('skill_bootstrap', {
  task: 'revisa la función foo en src/index.ts',
  context: '',
  intent: {
    summary: 'Review one code function.',
    domains: ['coding'],
    actions: ['review'],
    artifacts: ['code'],
    needs: [],
    signals: ['nominal'],
    risk: 'read-only',
    ambiguity: 'low',
  },
  caller: 'chatgpt-web',
  model: 'fixture-model',
  reasoningEffort: 'unknown',
  stage: 'start',
  maxSkills: 4,
  selectionMode: 'host-gated',
  workflowKey: 'workflow-guide-unrelated-routing-fixture',
});
assert.equal(unrelated.workflowGuide, null, 'unrelated code review should not auto-load a workflow guide');

console.log('Workflow guide media routing: PASS');
