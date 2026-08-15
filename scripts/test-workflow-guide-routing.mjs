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
  assert.equal(bootstrap.workflowGuide?.guide, 'narrated-media-review', `bootstrap did not auto-load narrated-media-review for: ${task}`);
  assert.equal(bootstrap.workflowGuide?.recommendedTools?.includes('media_review_ingest'), true, `canonical media tool missing from loaded guide for: ${task}`);
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
