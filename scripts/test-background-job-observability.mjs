import assert from 'node:assert/strict';

const { processToolModule } = await import('../dist/tools/process-tools.js');
const { bridgeWorkflowToolModule } = await import('../dist/tools/bridge-workflow.js');
const { classifyBackgroundActivity } = await import('../dist/tools/shared/process.js');
const { clearBridgeNotices, drainBridgeNotices } = await import('../dist/notices.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const callProcess = async (name, args = {}) => await processToolModule.handlers[name](args);
const sessions = [];

try {
  const now = Date.now();
  assert.equal(classifyBackgroundActivity({running:true,timeoutExpired:false,now,lastProgressAt:now-1000}).state, 'progressing');
  assert.equal(classifyBackgroundActivity({running:true,timeoutExpired:false,now,lastProgressAt:now-60_000}).state, 'idle');
  assert.equal(classifyBackgroundActivity({running:true,timeoutExpired:false,now,lastProgressAt:now-180_000}).state, 'stalled');
  assert.equal(classifyBackgroundActivity({running:true,timeoutExpired:true,now,lastProgressAt:now-1000}).state, 'timed-out-alive');
  assert.equal(classifyBackgroundActivity({running:false,timeoutExpired:true,now,lastProgressAt:now-1000}).state, 'completed');

  const terminalStartSchema = processToolModule.tools.find((tool) => tool.name === 'terminal_start');
  const workBeginSchema = processToolModule.tools.find((tool) => tool.name === 'work_begin');
  const verifyStartSchema = bridgeWorkflowToolModule.tools.find((tool) => tool.name === 'bridge_verify_all');
  assert.equal(terminalStartSchema?.inputSchema?.properties?.timeoutAction?.default, 'terminate');
  assert.equal(workBeginSchema?.inputSchema?.properties?.timeoutAction?.default, 'observe');
  assert.equal(verifyStartSchema?.inputSchema?.properties?.timeoutAction?.default, 'observe');

  clearBridgeNotices();
  const observe = await callProcess('work_begin', {
    command: 'node -e "setTimeout(()=>console.log(\'OBSERVE_DONE\'),5000)"',
    cwd: process.cwd(),
    name: 'fixture-observe-timeout',
    timeoutMs: 1000,
    cleanupAfterMs: 5000,
    traceId: 'mssr-fixture-observe',
  });
  sessions.push(observe.id);
  assert.equal(observe.timeoutAction, 'observe');
  await sleep(1150);
  const observeMid = await callProcess('work_peek', {sessionId: observe.id, maxChars: 4000, traceId:'mssr-fixture-observe'});
  assert.equal(observeMid.running, true);
  assert.equal(observeMid.timedOut, true);
  assert.equal(observeMid.state, 'timed-out-alive');
  assert.equal(observeMid.timeoutAction, 'observe');
  assert.equal(observeMid.processTree?.alive, true);
  assert.ok(observeMid.processTree?.processCount >= 1);
  assert.ok(observeMid.processTree?.leaf);
  assert.equal(Object.hasOwn(observeMid.processTree?.leaf ?? {}, 'commandLine'), false);
  assert.equal(JSON.stringify(observeMid.processTree).includes('OBSERVE_DONE'), false, 'sanitized process tree leaked raw command text');
  const observeTimeoutNotices = drainBridgeNotices().filter((item) => item.code === 'terminal-session-timeout-alive');
  assert.equal(observeTimeoutNotices.length, 1);
  assert.equal(observeTimeoutNotices[0]?.actions?.[0]?.toolName, 'work_peek');

  await sleep(4000);
  const observeDone = await callProcess('work_peek', {sessionId: observe.id, maxChars: 4000, traceId:'mssr-fixture-observe'});
  assert.equal(observeDone.running, false);
  assert.equal(observeDone.exitCode, 0);
  assert.equal(observeDone.timedOut, true);
  assert.ok(observeDone.stdout.includes('OBSERVE_DONE'));
  assert.ok(observeDone.output.stdoutBytes > 0);
  assert.ok(observeDone.output.stdoutLines >= 1);
  const observeCompletion = drainBridgeNotices().filter((item) => item.code === 'terminal-session-completed');
  assert.equal(observeCompletion.length, 1);
  assert.equal(observeCompletion[0]?.severity, 'info', 'observe timeout must not convert a later exit 0 into failure');
  await callProcess('work_finish', {sessionId: observe.id, traceId:'mssr-fixture-observe'});
  sessions.splice(sessions.indexOf(observe.id), 1);

  clearBridgeNotices();
  const hard = await callProcess('terminal_start', {
    command: 'node -e "setTimeout(()=>console.log(\'SHOULD_NOT_PRINT\'),10000)"',
    cwd: process.cwd(),
    name: 'fixture-hard-timeout',
    timeoutMs: 1000,
    timeoutAction: 'terminate',
    cleanupAfterMs: 5000,
    traceId: 'mssr-fixture-hard',
  });
  sessions.push(hard.id);
  assert.equal(hard.timeoutAction, 'terminate');
  await sleep(1600);
  const hardDone = await callProcess('terminal_read', {sessionId: hard.id, maxChars: 4000, traceId:'mssr-fixture-hard'});
  assert.equal(hardDone.running, false);
  assert.equal(hardDone.timedOut, true);
  assert.equal(hardDone.timeoutAction, 'terminate');
  assert.equal(hardDone.stdout.includes('SHOULD_NOT_PRINT'), false);
  const hardNotices = drainBridgeNotices();
  assert.ok(hardNotices.some((item) => item.code === 'terminal-session-timeout-terminating'));
  assert.ok(hardNotices.some((item) => item.code === 'terminal-session-completed' && item.severity === 'warning'));
  await callProcess('terminal_stop', {sessionId: hard.id, traceId:'mssr-fixture-hard'});
  sessions.splice(sessions.indexOf(hard.id), 1);

  console.log('background job observability regression: PASS');
} finally {
  for (const sessionId of sessions) {
    try { await callProcess('terminal_stop', {sessionId}); } catch {}
  }
  clearBridgeNotices();
}
