import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mssr-lifecycle-host-'));
const metricsDir = path.join(sandbox, 'metrics');
const logDir = path.join(sandbox, 'logs');
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, 'bridge-metrics.sqlite');
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(logDir, 'mssr-events.jsonl');
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, 'mssr-observability-state.json');
process.env.BRIDGE_MCP_NOTICE_STATE_PATH = path.join(metricsDir, 'bridge-notices.json');
process.env.BRIDGE_MCP_NOTICE_PERSISTENCE_ENABLED = '0';
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

const [
  { Client },
  { InMemoryTransport },
  { createBridgeServer },
  { createDefaultToolRegistry },
  { evaluateBridgeMssrLifecyclePreflight },
  traceContext,
  metrics,
  observatory,
  notices,
] = await Promise.all([
  import('@modelcontextprotocol/sdk/client/index.js'),
  import('@modelcontextprotocol/sdk/inMemory.js'),
  import('../dist/bridge-server.js'),
  import('../dist/tool-registry.js'),
  import('../dist/mssr-lifecycle-coverage.js'),
  import('../dist/mssr-trace-context.js'),
  import('../dist/metrics.js'),
  import('../dist/mssr-observatory.js'),
  import('../dist/notices.js'),
]);

function payload(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text;
  assert.equal(typeof text, 'string', 'Expected text MCP result.');
  return JSON.parse(text);
}

async function createSession(name) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBridgeServer();
  const client = new Client({ name: `lifecycle-host-${name}`, version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    async call(toolName, args = {}) {
      console.error("CALL START " + toolName); const result = payload(await client.callTool({ name: toolName, arguments: args })); console.error("CALL END " + toolName); return result;
    },
    async close() {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

async function callFresh(name, args = {}) {
  const session = await createSession(name);
  try {
    return await session.call(name, args);
  } finally {
    await session.close();
  }
}

const registry = createDefaultToolRegistry();
const readTool = registry.tools.find((tool) => tool.name === 'read_text_file');
const writeTool = registry.tools.find((tool) => tool.name === 'write_text_file');
const routeTool = registry.tools.find((tool) => tool.name === 'skill_route_plan');
const actionTool = registry.tools.find((tool) => tool.name === 'bridge_tool_action');
const crossRepoTransactionTool = registry.tools.find((tool) => tool.name === 'bridge_cross_repo_transaction');
assert.ok(readTool && writeTool && routeTool, 'Expected lifecycle fixture tools in registry.');
assert.ok(actionTool?.inputSchema?.properties?.crossRepoOwnership, 'The generic write wrapper must expose the cross-repository ownership contract.');
assert.ok(crossRepoTransactionTool, 'The host must expose the dedicated journaled cross-repository transaction tool.');

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

// A lifecycle denial is an operation result, not an executed write. Start from a
// loaded but un-routed isolated project so owner and workflow are observable
// while the original tool schemas still omit traceId.
notices.clearBridgeNotices();
const panelRoot = path.join(sandbox, 'auro-3d-web');
const commercialRoot = path.join(sandbox, 'Auro-3D');
const healthyRoot = path.join(sandbox, 'healthy-project');
fs.mkdirSync(panelRoot, { recursive: true });
fs.mkdirSync(commercialRoot, { recursive: true });
fs.mkdirSync(healthyRoot, { recursive: true });
fs.mkdirSync(path.join(commercialRoot, 'commercial-data'), { recursive: true });
fs.writeFileSync(path.join(commercialRoot, 'owner.fixture'), 'Auro-3D owns commercial data.\n', 'utf8');
fs.writeFileSync(path.join(commercialRoot, 'commercial-data', 'offer.json'), '{"owner":"Auro-3D"}\n', 'utf8');
fs.writeFileSync(path.join(healthyRoot, 'healthy.txt'), 'healthy read\n', 'utf8');

const workflowKey = 'isolated-auro-lifecycle-friction';
const panelSession = await createSession('auro-panel');
const commercialSession = await createSession('auro-commercial');
try {
  const panelLoad = await panelSession.call('project_context_load', {
    projectRoot: panelRoot,
    workflowKey,
    task: 'Initialize the isolated AURO web panel fixture.',
    intent: {
      domains: ['filesystem', 'coding'],
      actions: ['create', 'verify'],
      artifacts: ['repository', 'project'],
      risk: 'write',
      ambiguity: 'low',
      signals: ['recovery-needed'],
      summary: 'Isolated AURO panel lifecycle reproduction.',
    },
  });
  assert.equal(panelLoad.projectRoot, panelRoot, 'The isolated panel owner must be observed before the rejection.');

  const initializationTarget = path.join(panelRoot, '.mssr');
  const blockedInitialize = await panelSession.call('project_context_initialize', { root: panelRoot });
  const repeatedBlockedInitialize = await panelSession.call('project_context_initialize', { root: panelRoot });
  assert.equal(blockedInitialize.status, 'mssr-lifecycle-preflight-required');
  assert.equal(blockedInitialize.executed, false);
  assert.equal(blockedInitialize.traceId, null, 'The isolated reproduction has no open compatible route.');
  assert.equal(blockedInitialize.routePresent, false);
  assert.equal(repeatedBlockedInitialize.executed, false);
  assert.equal(fs.existsSync(initializationTarget), false, 'Blocked project initialization must not create .mssr files.');

  const blockedFile = path.join(panelRoot, 'must-not-exist.txt');
  const blockedWrite = await panelSession.call('write_text_file', { path: blockedFile, content: 'must stay blocked\n' });
  assert.equal(blockedWrite.status, 'mssr-lifecycle-preflight-required');
  assert.equal(blockedWrite.executed, false, 'The blocked write is explicitly not executed.');
  assert.equal(fs.existsSync(blockedFile), false, 'The blocked write must not create its target.');

  const pendingHistory = await panelSession.call('bridge_notice_history', {
    source: 'mssr-lifecycle-preflight',
    code: 'mssr-lifecycle-preflight-required',
    deliveryState: 'pending',
    limit: 20,
  });
  const panelNotices = pendingHistory.items.filter((item) => item.details?.project === 'auro-3d-web'
    && item.details?.workflowKey === workflowKey);
  const initializationNotice = panelNotices.find((item) => item.details?.originalTool === 'project_context_initialize');
  const writeNotice = panelNotices.find((item) => item.details?.originalTool === 'write_text_file');
  assert.equal(panelNotices.length, 2, 'Repeated identical preflight denials must update history without creating duplicate notices.');
  assert.equal(initializationNotice?.occurrences, 2, 'The repeated initialization denial should increment its existing history row.');
  assert.equal(initializationNotice?.deliveryState, 'pending', 'The lifecycle notice must remain queued for the next compatible bootstrap.');
  assert.equal(initializationNotice?.details?.executed, false);
  assert.equal(initializationNotice?.details?.correlation?.mode, 'owner-workflow');
  assert.ok(writeNotice, 'The blocked text write should be retained as a distinct operation notice.');

  async function bootstrapOwner(session, root, suffix, ownerWorkflowKey = workflowKey) {
    return session.call('skill_bootstrap', {
      task: `Bootstrap isolated owner ${path.basename(root)} for lifecycle regression.`,
      taskKey: `isolated-lifecycle-${suffix}`,
      projectRoot: root,
      workflowKey: ownerWorkflowKey,
      caller: 'codex-local',
      stage: 'start',
      selectionMode: 'auto',
      intent: {
        domains: ['filesystem', 'coding'],
        actions: ['create', 'verify'],
        artifacts: ['repository', 'project'],
        risk: 'write',
        ambiguity: 'low',
        signals: ['recovery-needed'],
        summary: `Isolated lifecycle bootstrap for ${path.basename(root)}.`,
      },
    });
  }

  await commercialSession.call('project_context_load', {
    projectRoot: commercialRoot,
    workflowKey,
    task: 'Keep the commercial owner separate from the panel fixture.',
    intent: {
      domains: ['filesystem'],
      actions: ['review'],
      artifacts: ['repository', 'project'],
      risk: 'read-only',
      ambiguity: 'low',
      signals: ['nominal'],
      summary: 'Isolated commercial owner separation fixture.',
    },
  });
  const commercialBootstrap = await bootstrapOwner(commercialSession, commercialRoot, 'commercial');
  const deliveredToCommercial = commercialBootstrap.bridgeNotices?.items ?? [];
  assert.ok(!deliveredToCommercial.some((item) => item.id === initializationNotice?.id || item.id === writeNotice?.id),
    'A bootstrap for Auro-3D must not receive notices scoped to auro-3d-web even when workflow keys match.');
  assert.ok(commercialBootstrap.traceId, 'The commercial fixture should own its independent trace.');

  const panelBootstrap = await bootstrapOwner(panelSession, panelRoot, 'panel');
  const deliveredToPanel = panelBootstrap.bridgeNotices?.items ?? [];
  assert.ok(deliveredToPanel.some((item) => item.id === initializationNotice?.id),
    'The next bootstrap for the same owner+workflow must receive the retained lifecycle notice.');
  assert.ok(panelBootstrap.traceId && panelBootstrap.traceId !== commercialBootstrap.traceId,
    'Each repository must retain its own trace.');

  const followupBootstrap = await bootstrapOwner(panelSession, panelRoot, 'panel-followup');
  const deliveredToPanelFollowup = followupBootstrap.bridgeNotices?.items ?? [];
  assert.ok(deliveredToPanelFollowup.some((item) => item.id === writeNotice?.id),
    'A following compatible bootstrap must receive any same-owner notice left pending by the bounded first delivery.');

  const deliveredHistory = await panelSession.call('bridge_notice_history', {
    source: 'mssr-lifecycle-preflight',
    code: 'mssr-lifecycle-preflight-required',
    deliveryState: 'delivered',
    limit: 20,
  });
  const deliveredPanelRows = deliveredHistory.items.filter((item) => item.details?.project === 'auro-3d-web'
    && item.details?.workflowKey === workflowKey);
  assert.equal(deliveredPanelRows.length, 2, 'Delivered lifecycle notices must remain in 24-hour history.');
  assert.ok(deliveredPanelRows.every((item) => item.deliveryCount === 1 && item.deliveryState === 'delivered'));

  const transferPath = path.join(panelRoot, 'exports', 'offer-summary.json');
  const ownership = {
    transactionId: 'auro-offer-copy-2026-11-13',
    sourceProject: 'Auro-3D',
    targetProject: 'auro-3d-web',
    currentTraceId: panelBootstrap.traceId,
    relatedTraceId: commercialBootstrap.traceId,
    artifactKind: 'document',
    operation: 'copy',
    expectedOwnerProject: 'Auro-3D',
    ownerClaim: {
      ownerProject: 'Auro-3D',
      authoritySource: 'user',
      authorityRevision: 'cross-repo ownership handoff 2026-11-12',
      scope: 'commercial-work-asset',
      observedAt: new Date().toISOString(),
      confidenceKind: 'declared',
      conflicts: [],
    },
    explicitCopyReview: false,
    sourceRefs: ['commercial-data/offer.json'],
    targetRefs: ['exports/offer-summary.json'],
    destinationState: 'absent',
  };
  const unreviewedCopy = await panelSession.call('bridge_tool_action', {
    toolName: 'write_text_file',
    confirmToolName: 'write_text_file',
    traceId: panelBootstrap.traceId,
    projectRoot: panelRoot,
    arguments: { path: transferPath, content: '{"copied":true}\n' },
    crossRepoOwnership: ownership,
  });
  assert.equal(unreviewedCopy.status, 'mssr-cross-repo-write-preflight-required');
  assert.equal(unreviewedCopy.executed, false, 'MSSR review-required must stop before the underlying write handler.');
  assert.equal(unreviewedCopy.ownershipDecision.hostWriteGate, 'review-required');
  assert.equal(fs.existsSync(transferPath), false, 'An unreviewed cross-repo copy must not create its destination.');

  const reviewedCopy = await panelSession.call('bridge_tool_action', {
    toolName: 'write_text_file',
    confirmToolName: 'write_text_file',
    traceId: panelBootstrap.traceId,
    projectRoot: panelRoot,
    arguments: { path: transferPath, content: '{"copied":true}\n' },
    crossRepoOwnership: { ...ownership, explicitCopyReview: true },
  });
  assert.equal(reviewedCopy.executed, false, 'A reviewed declaration must not send caller-supplied bytes through the generic writer.');
  assert.ok(reviewedCopy.blockedReasons.includes('dedicated-bridge-cross-repo-transaction-required'));
  assert.equal(fs.existsSync(transferPath), false, 'Generic bridge_tool_action must not execute cross-repository writes.');

  const transferPointerRef = 'exports/INDEX.md';
  const transferOwnership = {
    ...ownership,
    explicitCopyReview: true,
    sourceHash: undefined,
    targetRefs: ['exports/offer-summary.json'],
  };
  const stagedTransfer = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'stage',
    ownership: transferOwnership,
    sourceRoot: commercialRoot,
    targetRoot: panelRoot,
    pointerRef: transferPointerRef,
    confirmTransactionId: transferOwnership.transactionId,
  });
  assert.equal(stagedTransfer.status, 'staged-and-verified-awaiting-pointer', JSON.stringify(stagedTransfer));
  assert.equal(stagedTransfer.executed, true);
  assert.equal(stagedTransfer.state, 'verified');
  assert.equal(stagedTransfer.sourceHash, stagedTransfer.destinationReadbackHash);
  assert.equal(fs.readFileSync(transferPath, 'utf8'), fs.readFileSync(path.join(commercialRoot, 'commercial-data', 'offer.json'), 'utf8'),
    'The transfer must copy source-owned bytes rather than caller-supplied replacement content.');
  assert.ok(fs.existsSync(stagedTransfer.journalPath), 'The host must persist a durable transaction journal.');
  const transferStatBeforeReplay = fs.statSync(transferPath);
  const replayedTransfer = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'stage',
    ownership: transferOwnership,
    sourceRoot: commercialRoot,
    targetRoot: panelRoot,
    pointerRef: transferPointerRef,
    confirmTransactionId: transferOwnership.transactionId,
  });
  assert.equal(replayedTransfer.status, 'idempotent-replay', JSON.stringify(replayedTransfer));
  assert.equal(fs.statSync(transferPath).mtimeMs, transferStatBeforeReplay.mtimeMs, 'An exact replay must not rewrite the destination.');

  // Simulate interruption after the destination link was created but before a
  // later lifecycle transition became durable, then exercise journal recovery.
  const interruptedJournal = JSON.parse(fs.readFileSync(stagedTransfer.journalPath, 'utf8'));
  delete interruptedJournal.integritySha256;
  interruptedJournal.state = 'rollback-needed';
  interruptedJournal.integritySha256 = createHash('sha256').update(JSON.stringify(interruptedJournal)).digest('hex');
  fs.writeFileSync(stagedTransfer.journalPath, `${JSON.stringify(interruptedJournal, null, 2)}\n`, 'utf8');
  const recoveredTransfer = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'recover', transactionId: transferOwnership.transactionId,
    confirmTransactionId: transferOwnership.transactionId, disposition: 'resume',
  });
  assert.equal(recoveredTransfer.status, 'recovered-verified-awaiting-pointer', JSON.stringify(recoveredTransfer));
  assert.equal(recoveredTransfer.destinationReadbackHash, stagedTransfer.sourceHash);

  const pointerPath = path.join(panelRoot, transferPointerRef);
  fs.writeFileSync(pointerPath, `# Export index\n\n- ${transferOwnership.targetRefs[0]} sha256:${stagedTransfer.sourceHash}\n`, 'utf8');
  const committedTransfer = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'commit',
    transactionId: transferOwnership.transactionId,
    pointerRef: transferPointerRef,
    confirmTransactionId: transferOwnership.transactionId,
  });
  assert.equal(committedTransfer.status, 'committed', JSON.stringify(committedTransfer));
  assert.equal(committedTransfer.state, 'committed');
  assert.ok(committedTransfer.receipt.pointerUpdateReceipt.startsWith('sha256:'));
  assert.match(fs.readFileSync(pointerPath, 'utf8'), new RegExp(stagedTransfer.sourceHash));
  const replayedCommit = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'commit',
    transactionId: transferOwnership.transactionId,
    pointerRef: transferPointerRef,
    confirmTransactionId: transferOwnership.transactionId,
  });
  assert.equal(replayedCommit.status, 'idempotent-replay');

  const rollbackOwnership = {
    ...transferOwnership,
    transactionId: 'auro-offer-copy-rollback-2026-11-13',
    targetRefs: ['exports/rollback-sample.json'],
  };
  const rollbackTarget = path.join(panelRoot, rollbackOwnership.targetRefs[0]);
  const rollbackStage = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'stage', ownership: rollbackOwnership, sourceRoot: commercialRoot, targetRoot: panelRoot,
    pointerRef: transferPointerRef, confirmTransactionId: rollbackOwnership.transactionId,
  });
  assert.equal(rollbackStage.status, 'staged-and-verified-awaiting-pointer');
  const rolledBack = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'rollback', transactionId: rollbackOwnership.transactionId,
    confirmTransactionId: rollbackOwnership.transactionId,
  });
  assert.equal(rolledBack.status, 'aborted', JSON.stringify(rolledBack));
  assert.equal(fs.existsSync(rollbackTarget), false, 'Rollback may remove only the matching destination created by its transaction.');

  const recoveredVerified = await panelSession.call('bridge_cross_repo_transaction', {
    action: 'recover', transactionId: transferOwnership.transactionId,
    confirmTransactionId: transferOwnership.transactionId, disposition: 'resume',
  });
  assert.equal(recoveredVerified.status, 'already-committed');
  assert.ok(panelBootstrap.traceId !== commercialBootstrap.traceId,
    'The source and target project traces must remain distinct across the transfer.');

  const historyBeforeHealthyRead = await panelSession.call('bridge_notice_history', {
    source: 'mssr-lifecycle-preflight',
    code: 'mssr-lifecycle-preflight-required',
    deliveryState: 'all',
    limit: 20,
  });
  const historyIdsBeforeHealthyRead = new Set(historyBeforeHealthyRead.items.map((item) => item.id));
  const healthyRead = await callFresh('read_text_file', { path: path.join(healthyRoot, 'healthy.txt') });
  assert.match(JSON.stringify(healthyRead), /healthy read/);
  const historyAfterHealthyRead = await panelSession.call('bridge_notice_history', {
    source: 'mssr-lifecycle-preflight',
    code: 'mssr-lifecycle-preflight-required',
    deliveryState: 'all',
    limit: 20,
  });
  const newLifecycleNotices = historyAfterHealthyRead.items.filter((item) => !historyIdsBeforeHealthyRead.has(item.id));
  assert.equal(newLifecycleNotices.length, 0,
    'A healthy operation must not add any lifecycle friction notice.');
  assert.equal(historyAfterHealthyRead.items.filter((item) => item.details?.project === 'auro-3d-web'
    && item.details?.workflowKey === workflowKey).length, 2,
  'A healthy read must not alter the unrelated panel lifecycle history.');

  // Simulate a Bridge coordinator restart: keep the observability ledger, drop
  // the in-memory trace registry, and let a fresh Bridge session recover the
  // one persisted compatible owner/workflow trace without an explicit traceId.
  const restartRoot = path.join(sandbox, 'auro-3d-web-after-restart');
  const restartWorkflowKey = 'isolated-auro-restart-recovery';
  const restartSession = await createSession('restart-before');
  const recoveredSessionHolder = { current: null };
  try {
    fs.mkdirSync(restartRoot, { recursive: true });
    await restartSession.call('project_context_load', {
      projectRoot: restartRoot,
      workflowKey: restartWorkflowKey,
      task: 'Create one persisted route for Bridge restart recovery.',
      intent: {
        domains: ['filesystem', 'coding'],
        actions: ['create', 'verify'],
        artifacts: ['repository', 'project'],
        risk: 'write',
        ambiguity: 'low',
        signals: ['recovery-needed'],
        summary: 'Isolated single-owner restart recovery probe.',
      },
    });
    const restartBootstrap = await bootstrapOwner(restartSession, restartRoot, 'restart-recovery', restartWorkflowKey);
    assert.ok(restartBootstrap.traceId, 'The restart fixture must first persist a real Bridge-observed trace.');
    assert.ok(observatory.readPersistedMssrTraceState(restartBootstrap.traceId),
      'The Bridge-observed route must have durable state before simulating process-memory loss.');

    await restartSession.close();
    traceContext.resetSharedMssrTraceRegistryForTests();

    recoveredSessionHolder.current = await createSession('restart-after');
    await recoveredSessionHolder.current.call('project_context_load', {
      projectRoot: restartRoot,
      workflowKey: restartWorkflowKey,
      task: 'Reestablish the same owner/workflow after Bridge coordinator restart.',
      intent: {
        domains: ['filesystem'],
        actions: ['review'],
        artifacts: ['repository', 'project'],
        risk: 'read-only',
        ambiguity: 'low',
        signals: ['nominal'],
        summary: 'Same-owner Bridge restart recovery.',
      },
    });
    const recoveredWritePath = path.join(restartRoot, 'recovered-after-restart.txt');
    const recoveredWrite = await recoveredSessionHolder.current.call('write_text_file', {
      path: recoveredWritePath,
      content: 'recovered from persisted owner/workflow trace\n',
    });
    assert.notEqual(recoveredWrite.status, 'mssr-lifecycle-preflight-required',
      `A fresh Bridge session should recover the unique persisted compatible trace: ${JSON.stringify(recoveredWrite)}`);
    assert.equal(fs.readFileSync(recoveredWritePath, 'utf8'), 'recovered from persisted owner/workflow trace\n',
      'A single compatible persisted trace should survive coordinator-memory loss and authorize the isolated write.');
  } finally {
    await restartSession.close();
    await recoveredSessionHolder.current?.close();
  }

  // Match the historic ambiguity: two open same-owner/workflow traces are
  // created close together, then a fresh session receives no trace identity.
  const ambiguousRoot = path.join(sandbox, 'auro-3d-web-ambiguous');
  const ambiguousWorkflowKey = 'isolated-ambiguous-trace-recovery';
  fs.mkdirSync(ambiguousRoot, { recursive: true });
  const ambiguousSessionA = await createSession('ambiguous-a');
  const ambiguousSessionB = await createSession('ambiguous-b');
  let ambiguousSessionC = null;
  try {
    const routeA = await bootstrapOwner(ambiguousSessionA, ambiguousRoot, 'ambiguous-a', ambiguousWorkflowKey);
    const routeB = await bootstrapOwner(ambiguousSessionB, ambiguousRoot, 'ambiguous-b', ambiguousWorkflowKey);
    assert.ok(routeA.traceId && routeB.traceId && routeA.traceId !== routeB.traceId,
      'Repeated start bootstraps must remain separate traces rather than merge task identity.');
    await ambiguousSessionA.close();
    await ambiguousSessionB.close();
    traceContext.ageSharedMssrTraceForTests(routeA.traceId, 5 * 60 * 1000);
    traceContext.ageSharedMssrTraceForTests(routeB.traceId, 5 * 60 * 1000);

    ambiguousSessionC = await createSession('ambiguous-after-expiry');
    await ambiguousSessionC.call('project_context_load', {
      projectRoot: ambiguousRoot,
      workflowKey: ambiguousWorkflowKey,
      task: 'Resume an owner with two equally compatible persisted routes.',
      intent: {
        domains: ['filesystem', 'coding'],
        actions: ['review', 'recover'],
        artifacts: ['repository', 'project'],
        risk: 'read-only',
        ambiguity: 'medium',
        signals: ['uncertainty', 'recovery-needed'],
        summary: 'Ambiguous owner/workflow trace recovery probe.',
      },
    });
    const ambiguousTarget = path.join(ambiguousRoot, 'must-remain-blocked.txt');
    const ambiguousWrite = await ambiguousSessionC.call('write_text_file', {
      path: ambiguousTarget,
      content: 'must remain blocked\n',
    });
    assert.equal(ambiguousWrite.status, 'mssr-lifecycle-preflight-required');
    assert.equal(ambiguousWrite.executed, false);
    assert.equal(ambiguousWrite.traceId, null);
    assert.equal(fs.existsSync(ambiguousTarget), false,
      'Bridge must abstain when multiple compatible persisted traces make attribution ambiguous.');
    const ambiguousNoticeHistory = await ambiguousSessionC.call('bridge_notice_history', {
      source: 'mssr-lifecycle-preflight',
      code: 'mssr-lifecycle-preflight-required',
      deliveryState: 'pending',
      limit: 20,
    });
    assert.ok(ambiguousNoticeHistory.items.some((item) => item.details?.project === path.basename(ambiguousRoot)
      && item.details?.workflowKey === ambiguousWorkflowKey
      && item.details?.correlation?.mode === 'owner-workflow'),
    'When multiple stale same-owner/workflow routes prevent safe attribution, the denial must remain visible and correlate only to the observed owner/workflow.');
  } finally {
    await ambiguousSessionA.close();
    await ambiguousSessionB.close();
    await ambiguousSessionC?.close();
  }
} finally {
  await panelSession.close();
  await commercialSession.close();
}

observatory.closeMssrObservatoryForTests();
metrics.closeMetricsForTests();
notices.clearBridgeNotices();
fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
console.log('MSSR lifecycle host adoption and friction notice test passed.');
