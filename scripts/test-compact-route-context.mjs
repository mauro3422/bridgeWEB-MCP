import assert from 'node:assert/strict';
import { compactRouteContextPlane, compactRouteNearMatches } from '../dist/compact-route-context.js';
const evidence={id:'required-source',content:'preserved',provenance:{owner:'repository'}};
const input={projectContext:{selected:[evidence],core:[evidence],decisions:Array.from({length:100},()=>({reason:'intent-mismatch',id:'unselected'})),requiredBudgetExceeded:true,requiredOverflow:['required-source']},contextMessages:{selected:[evidence]},repository:{observations:Array(100).fill(evidence),messages:Array(100).fill(evidence),diagnostics:['stale-source'],overflow:true},inbox:{pending:1},advisoryOnly:true};
const before=JSON.stringify(input);
const output=compactRouteContextPlane(input);
assert.deepEqual(output.projectContext.selected,[evidence]);
assert.deepEqual(output.projectContext.core,[evidence]);
assert.equal(output.projectContext.requiredBudgetExceeded,true);
assert.deepEqual(output.projectContext.requiredOverflow,['required-source']);
assert.equal(output.projectContext.decisionCount,100);
assert.deepEqual(output.repository.diagnostics,['stale-source']);
assert.equal(output.repository.overflow,true);
assert.equal(output.contextMessages.selectionRef,'contextMessages');
assert.equal(JSON.stringify(input),before);
assert.ok(JSON.stringify(output).length < before.length/4);
assert.equal(compactRouteContextPlane(null),null);

const nearMatches=compactRouteNearMatches([
  {name:'jev-decision-systems',source:'codex-local',candidateScore:114,explicitNameMatched:false,matchedDimensions:['domain','action','artifact','need','signal','extra'],missingGates:[
    {dimension:'signal',reason:'explicit signal gate failed',acceptedValues:['tool-chain-needed','capability-discovery-needed','overflow-1','overflow-2','overflow-3','overflow-4','overflow-5','overflow-6','overflow-7'],missingValues:['tool-chain-needed'],privateReasoning:'drop-me'},
    {dimension:'artifact',reason:'explicit artifact gate failed',acceptedValues:['code','project'],missingValues:['project']},
    {dimension:'need',reason:'explicit need gate failed',acceptedValues:['performance'],missingValues:['performance']},
    {dimension:'domain',reason:'domain gate failed',acceptedValues:['coding'],missingValues:['coding']},
  ],advisoryOnly:true,privateReasoning:'drop-me'},
  null,
]);
assert.equal(nearMatches.length,1);
assert.deepEqual(nearMatches[0],{
  name:'jev-decision-systems',source:'codex-local',candidateScore:114,explicitNameMatched:false,
  matchedDimensions:['domain','action','artifact','need','signal'],
  missingGates:[
    {dimension:'signal',reason:'explicit signal gate failed',acceptedValues:['tool-chain-needed','capability-discovery-needed','overflow-1','overflow-2','overflow-3','overflow-4','overflow-5','overflow-6'],missingValues:['tool-chain-needed']},
    {dimension:'artifact',reason:'explicit artifact gate failed',acceptedValues:['code','project'],missingValues:['project']},
    {dimension:'need',reason:'explicit need gate failed',acceptedValues:['performance'],missingValues:['performance']},
  ],
  advisoryOnly:true,
});
assert.deepEqual(compactRouteNearMatches(null),[]);
console.log('compact route context: PASS; evidence, overflow, diagnostics and bounded near-matches preserved');
