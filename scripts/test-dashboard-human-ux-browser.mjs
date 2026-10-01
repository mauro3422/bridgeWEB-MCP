#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:3002/dashboard';
const evidenceRoot = process.argv[3] || 'data/dashboard-visual-qa/activity-interaction';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge not found');
  return found;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => resolve(port));
    });
  });
}

async function fetchJson(target, attempts = 80) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(target);
      if (response.ok) return await response.json();
      last = new Error(`${response.status} ${response.statusText}`);
    } catch (error) { last = error; }
    await sleep(100);
  }
  throw last || new Error(`Could not fetch ${target}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('CDP websocket open timeout')), 8000);
        this.ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
        this.ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP websocket error')); }, { once: true });
      });
    }
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP error'));
      else pending.resolve(message.result || {});
    });
  }
  call(method, params = {}, timeoutMs = 10000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(cdp, expression)) return true; } catch {}
    await sleep(100);
  }
  return false;
}

async function screenshot(cdp, file) {
  const result = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(result.data, 'base64'));
}

const chrome = findChrome();
const port = await freePort();
const profileDir = path.join(os.tmpdir(), `bridge-dashboard-h2-${process.pid}-${Date.now()}`);
const runDir = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(runDir, { recursive: true });
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });

let cdp;
try {
  await fetchJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find((entry) => entry.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'headless page target must exist');
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.navigate', { url });
  assert.equal(await waitFor(cdp, `document.readyState === 'complete' && document.getElementById('updated-at')?.textContent?.trim() !== 'sin actualizar'`), true, 'dashboard must load live data');
  assert.equal(await waitFor(cdp, `document.getElementById('home-status-sentence')?.innerText?.trim().length > 0 && document.getElementById('home-pulse-activity')?.innerText?.trim() !== '—'`), true, 'V2-A Inicio must render from the live bounded snapshot');
  const homeInitial = await evaluate(cdp, `(() => {
    const legacy = document.getElementById('legacy-dashboard');
    const home = document.getElementById('panel-home-v2');
    return {
      contract: document.querySelector('main.shell-v2')?.dataset.uxContract || null,
      selected: document.querySelector('[data-v2-tab="home"]')?.getAttribute('aria-selected'),
      v2Tabs: Array.from(document.querySelectorAll('[data-v2-tab]')).map((node) => node.dataset.v2Tab),
      legacyOpen: legacy?.open === true,
      legacyVisiblePanels: Array.from(document.querySelectorAll('[data-panel]')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
      statusSentence: document.getElementById('home-status-sentence')?.innerText.trim() || '',
      continueTitle: document.getElementById('home-continue-title')?.innerText.trim() || '',
      attentionText: document.getElementById('home-attention-list')?.innerText.trim() || '',
      activity: document.getElementById('home-pulse-activity')?.innerText.trim() || '',
      errors: document.getElementById('home-pulse-errors')?.innerText.trim() || '',
      sessions: document.getElementById('home-pulse-sessions')?.innerText.trim() || '',
      persistence: document.getElementById('home-pulse-persistence')?.innerText.trim() || '',
      changeRows: document.querySelectorAll('#home-changes .home-change-row').length,
      headerHeight: Math.round(document.querySelector('.topbar-v2')?.getBoundingClientRect().height || 0),
      navHeight: Math.round(document.querySelector('.v2-tabs')?.getBoundingClientRect().height || 0),
      snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
      homeVisible: home?.hidden === false && home?.getClientRects().length > 0,
    };
  })()`);
  assert.equal(homeInitial.contract, 'human-v2-b');
  assert.deepEqual(homeInitial.v2Tabs, ['home', 'work', 'health', 'explore']);
  assert.equal(homeInitial.selected, 'true');
  assert.equal(homeInitial.legacyOpen, false, 'V1 comparison must be collapsed on first load');
  assert.equal(homeInitial.legacyVisiblePanels, 0, 'Legacy technical panels must not compete with V2 Inicio by default');
  assert.equal(homeInitial.homeVisible, true);
  assert.ok(homeInitial.statusSentence.length > 20, 'Inicio must explain system/work state in human language');
  assert.ok(homeInitial.continueTitle.length > 0, 'Inicio must identify the current human work item or explicit empty state');
  assert.ok(homeInitial.attentionText.length > 0, 'Inicio must expose actionable attention or an explicit clear state');
  assert.match(homeInitial.activity, /5 min/);
  assert.match(homeInitial.sessions, /\d/);
  assert.ok(homeInitial.persistence.length > 0);
  assert.ok(homeInitial.changeRows >= 1, 'Inicio must expose semantic recent changes');
  await screenshot(cdp, path.join(runDir, '00-v2-home-desktop.png'));

  await evaluate(cdp, `document.getElementById('inspector-open').click()`);
  await sleep(60);
  const inspectorOpen = await evaluate(cdp, `(() => ({
    hidden: document.getElementById('v2-inspector').hidden,
    ariaHidden: document.getElementById('v2-inspector').getAttribute('aria-hidden'),
    boot: document.getElementById('inspector-boot')?.innerText.trim() || '',
    pid: document.getElementById('inspector-pid')?.innerText.trim() || '',
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(inspectorOpen.hidden, false);
  assert.equal(inspectorOpen.ariaHidden, 'false');
  assert.ok(inspectorOpen.boot.length > 10 && inspectorOpen.pid.length > 0, 'Inspector must expose exact technical evidence');
  assert.equal(inspectorOpen.snapshotResources, homeInitial.snapshotResources, 'Opening Inspector must not refetch the dashboard snapshot');
  await screenshot(cdp, path.join(runDir, '00-v2-inspector-open.png'));
  await evaluate(cdp, `document.getElementById('inspector-close').click()`);
  await sleep(40);
  assert.equal(await evaluate(cdp, `document.getElementById('v2-inspector').hidden`), true);

  await evaluate(cdp, `document.querySelector('[data-v2-tab="home"]').focus()`);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(40);
  const v2Keyboard = await evaluate(cdp, `(() => ({
    selected: document.querySelector('[data-v2-tab="work"]')?.getAttribute('aria-selected'),
    focused: document.activeElement?.dataset?.v2Tab || null,
    workVisible: document.getElementById('panel-work-v2')?.hidden === false,
  }))()`);
  assert.equal(v2Keyboard.selected, 'true');
  assert.equal(v2Keyboard.focused, 'work');
  assert.equal(v2Keyboard.workVisible, true, 'V2 keyboard navigation must activate the corresponding human-intent surface');
  assert.equal(await waitFor(cdp, `document.getElementById('work-status-sentence')?.innerText?.trim().length > 20 && document.querySelector('[data-work-range="now"]')?.getAttribute('aria-pressed') === 'true'`), true, 'V2-B Trabajo must render current continuity from the same bounded snapshot');
  const workInitial = await evaluate(cdp, `(() => ({
    status: document.getElementById('work-status-sentence')?.innerText.trim() || '',
    taskCards: document.querySelectorAll('#work-active-list [data-work-task]').length,
    activeText: document.getElementById('work-active-list')?.innerText.trim() || '',
    projectStates: Array.from(document.querySelectorAll('#work-project-list [data-work-project]')).map((node) => node.dataset.workState),
    projectFilterHidden: document.getElementById('work-project-filter-group')?.hidden === true,
    timelineEvents: document.querySelectorAll('#work-timeline [data-work-event]').length,
    rangeNote: document.getElementById('work-range-note')?.innerText.trim() || '',
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.ok(workInitial.status.length > 20, 'Trabajo must explain current continuity in human language');
  assert.ok(workInitial.taskCards > 0 || /Sin trabajo activo/.test(workInitial.activeText), 'Trabajo must expose active work or an explicit empty current state');
  assert.equal(workInitial.projectFilterHidden, false, 'Current Project Map filters must be available on Ahora');
  assert.equal(workInitial.projectStates.every((state) => state === 'active' || state === 'review-needed'), true, 'Default current Project Map must not mix paused/history projects');
  assert.match(workInitial.rangeNote, /estado actual/i);
  await screenshot(cdp, path.join(runDir, '00-v2-work-now-desktop.png'));

  await evaluate(cdp, `document.querySelector('[data-work-project-filter="all"]').click()`);
  await sleep(40);
  const workAll = await evaluate(cdp, `(() => ({
    pressed: document.querySelector('[data-work-project-filter="all"]')?.getAttribute('aria-pressed'),
    projectCount: document.querySelectorAll('#work-project-list [data-work-project]').length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(workAll.pressed, 'true');
  assert.ok(workAll.projectCount >= workInitial.projectStates.length, 'Todos must preserve or expand the current project map');
  assert.equal(workAll.snapshotResources, workInitial.snapshotResources, 'Project filter changes must not refetch the dashboard snapshot');

  await evaluate(cdp, `document.querySelector('[data-work-range="7d"]').click()`);
  await sleep(40);
  const work7d = await evaluate(cdp, `(() => ({
    pressed: document.querySelector('[data-work-range="7d"]')?.getAttribute('aria-pressed'),
    filterHidden: document.getElementById('work-project-filter-group')?.hidden === true,
    states: Array.from(document.querySelectorAll('#work-project-list [data-work-project]')).map((node) => node.dataset.workState),
    note: document.getElementById('work-range-note')?.innerText.trim() || '',
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(work7d.pressed, 'true');
  assert.equal(work7d.filterHidden, true, 'Historical windows must not reuse current active/review classification controls');
  assert.equal(work7d.states.every((state) => state === 'observed'), true, '7d project rows must be labelled as observed, not current health state');
  assert.match(work7d.note, /7 días/i);
  assert.equal(work7d.snapshotResources, workInitial.snapshotResources, '7d range switch must stay client-side on the same snapshot');

  await evaluate(cdp, `document.querySelector('[data-work-range="30d"]').click()`);
  await sleep(40);
  const work30d = await evaluate(cdp, `(() => ({
    pressed: document.querySelector('[data-work-range="30d"]')?.getAttribute('aria-pressed'),
    states: Array.from(document.querySelectorAll('#work-project-list [data-work-project]')).map((node) => node.dataset.workState),
    note: document.getElementById('work-range-note')?.innerText.trim() || '',
    semanticEvents: document.querySelectorAll('#work-timeline [data-work-event]').length,
    rawToolRows: document.querySelectorAll('#panel-work-v2 [data-tool-call], #panel-work-v2 .recent-row').length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(work30d.pressed, 'true');
  assert.equal(work30d.states.every((state) => state === 'historical'), true, '30d Project Map must present retained history as historical evidence');
  assert.match(work30d.note, /30 días/i);
  assert.equal(work30d.rawToolRows, 0, 'V2-B Work timeline must not regress to physical tool-call rows');
  assert.equal(work30d.snapshotResources, workInitial.snapshotResources, '30d range switch must stay client-side on the same snapshot');
  await screenshot(cdp, path.join(runDir, '00-v2-work-30d-desktop.png'));

  await evaluate(cdp, `document.querySelector('[data-work-range="now"]').click(); document.querySelector('[data-work-project-filter="current"]').click()`);
  await sleep(30);
  await evaluate(cdp, `document.querySelector('[data-v2-tab="home"]').click()`);

  await evaluate(cdp, `document.getElementById('legacy-dashboard').open = true`);
  await sleep(40);
  await evaluate(cdp, `document.querySelector('[data-tab="activity"]').click()`);
  assert.equal(await waitFor(cdp, `document.querySelectorAll('[data-activity-bucket]').length > 0 && document.querySelectorAll('#activity-recent-aggregate details').length > 0`), true, 'Activity aggregate UI must render');

  const initial = await evaluate(cdp, `(() => ({
    aggregateHidden: document.getElementById('activity-recent-aggregate').hidden,
    rawHidden: document.getElementById('activity-recent-raw').hidden,
    aggregatePressed: document.querySelector('[data-activity-mode="aggregate"]').getAttribute('aria-pressed'),
    rawPressed: document.querySelector('[data-activity-mode="raw"]').getAttribute('aria-pressed'),
    aggregateGroups: document.querySelectorAll('#activity-recent-aggregate details').length,
    rawRows: document.querySelectorAll('#activity-recent tr').length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(initial.aggregateHidden, false);
  assert.equal(initial.rawHidden, true);
  assert.equal(initial.aggregatePressed, 'true');
  assert.equal(initial.rawPressed, 'false');
  assert.ok(initial.aggregateGroups > 0);
  assert.ok(initial.rawRows > 0, 'Raw evidence must already be retained in DOM');
  await screenshot(cdp, path.join(runDir, '01-aggregate.png'));

  await evaluate(cdp, `document.querySelector('[data-activity-mode="raw"]').click()`);
  await sleep(80);
  const raw = await evaluate(cdp, `(() => ({
    aggregateHidden: document.getElementById('activity-recent-aggregate').hidden,
    rawHidden: document.getElementById('activity-recent-raw').hidden,
    aggregatePressed: document.querySelector('[data-activity-mode="aggregate"]').getAttribute('aria-pressed'),
    rawPressed: document.querySelector('[data-activity-mode="raw"]').getAttribute('aria-pressed'),
    visibleRows: Array.from(document.querySelectorAll('#activity-recent tr')).filter((node) => node.getClientRects().length > 0).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(raw.aggregateHidden, true);
  assert.equal(raw.rawHidden, false);
  assert.equal(raw.aggregatePressed, 'false');
  assert.equal(raw.rawPressed, 'true');
  assert.ok(raw.visibleRows > 0, 'Raw rows must become visible after one explicit action');
  assert.equal(raw.snapshotResources, initial.snapshotResources, 'Aggregate/Raw switch must not trigger a new snapshot request');
  await screenshot(cdp, path.join(runDir, '02-raw.png'));

  await evaluate(cdp, `document.querySelector('[data-activity-mode="aggregate"]').click(); document.querySelector('[data-activity-bucket]').click()`);
  await sleep(80);
  const bucket = await evaluate(cdp, `(() => ({
    pressed: document.querySelector('[data-activity-bucket]').getAttribute('aria-pressed'),
    detail: document.getElementById('activity-timeline-detail').innerText.trim(),
    aggregateHidden: document.getElementById('activity-recent-aggregate').hidden,
  }))()`);
  assert.equal(bucket.pressed, 'true');
  assert.equal(bucket.aggregateHidden, false);
  assert.match(bucket.detail, /llamadas/i);
  assert.match(bucket.detail, /errores/i);
  assert.doesNotMatch(bucket.detail, /Seleccioná un bloque/);
  await screenshot(cdp, path.join(runDir, '03-bucket-detail.png'));

  await evaluate(cdp, `document.querySelector('[data-tab="cockpit"]').click()`);
  assert.equal(await waitFor(cdp, `document.querySelectorAll('#cockpit-orientation [data-orientation]').length === 3 && !document.getElementById('cockpit-workspace-status')?.innerText.includes('clasificando')`), true, 'Cockpit human orientation and workspace projection must render');
  const cockpitInitial = await evaluate(cdp, `(() => ({
    orientation: Array.from(document.querySelectorAll('#cockpit-orientation [data-orientation]')).map((node) => ({ kind: node.dataset.orientation, text: node.innerText.trim() })),
    humanTasks: document.querySelectorAll('.cockpit-human-task').length,
    taskSurfaceText: document.getElementById('cockpit-open-tasks')?.innerText.trim() || '',
    nestedEvidence: document.querySelectorAll('.cockpit-task-evidence').length,
    focusOpen: document.querySelector('.cockpit-focus-detail')?.open === true,
    rawOpen: document.querySelector('.cockpit-technical-disclosure')?.open === true,
    rawCardsTotal: document.querySelectorAll('#cockpit-traces .cockpit-trace').length,
    secondaryContextOpen: document.getElementById('cockpit-secondary-context')?.open === true,
    visibleSecondaryContextCards: Array.from(document.querySelectorAll('#cockpit-secondary-context .card')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    secondary: Array.from(document.querySelectorAll('.cockpit-secondary-disclosure')).map((node) => ({ id: node.id, open: node.open })),
    visibleSecondaryTables: Array.from(document.querySelectorAll('.cockpit-secondary-disclosure table')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    helpCount: document.querySelectorAll('#panel-cockpit .context-help').length,
    visibleRawCards: Array.from(document.querySelectorAll('#cockpit-traces .cockpit-trace')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.deepEqual(cockpitInitial.orientation.map((item) => item.kind), ['now', 'next', 'attention']);
  assert.ok(cockpitInitial.taskSurfaceText.length > 0, 'Cockpit must render either current human tasks or an explicit empty-state explanation');
  assert.equal(cockpitInitial.focusOpen, false, 'Technical lifecycle focus must be collapsed by default');
  assert.equal(cockpitInitial.rawOpen, false, 'Raw technical traces must be collapsed by default');
  assert.equal(cockpitInitial.secondaryContextOpen, false, 'Secondary Cockpit context must be collapsed by default');
  assert.equal(cockpitInitial.visibleSecondaryContextCards, 0, 'Capabilities/history/Git/raw context must not compete with the default Cockpit layer');
  assert.deepEqual(cockpitInitial.secondary.map((item) => item.id), ['cockpit-workspace-detail', 'cockpit-capabilities-detail', 'cockpit-weekly-detail', 'cockpit-history-detail', 'cockpit-git-detail']);
  assert.equal(cockpitInitial.secondary.every((item) => item.open === false), true, 'Secondary Cockpit evidence must be collapsed by default');
  assert.equal(cockpitInitial.visibleSecondaryTables, 0, 'Secondary project/history tables must not compete with default Cockpit reading');
  assert.ok(cockpitInitial.helpCount >= 3, 'Cockpit must expose contextual help for projection semantics');
  assert.equal(cockpitInitial.visibleRawCards, 0, 'Raw technical trace cards must not compete with the default human layer');
  await screenshot(cdp, path.join(runDir, '04-cockpit-human-default.png'));

  if (cockpitInitial.nestedEvidence > 0) {
    await evaluate(cdp, `document.querySelector('.cockpit-task-evidence > summary').click()`);
    await sleep(80);
    const taskEvidence = await evaluate(cdp, `(() => ({
      open: document.querySelector('.cockpit-task-evidence')?.open === true,
      visibleCards: Array.from(document.querySelectorAll('.cockpit-task-evidence .cockpit-trace')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
      snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
    }))()`);
    assert.equal(taskEvidence.open, true, 'Nested task evidence must open from one explicit action');
    assert.ok(taskEvidence.visibleCards > 0, 'Nested technical traces must become visible inside the human task');
    assert.equal(taskEvidence.snapshotResources, cockpitInitial.snapshotResources, 'Opening task evidence must not fetch a new dashboard snapshot');
  }

  await evaluate(cdp, `document.querySelector('#cockpit-workspace-detail > summary').click()`);
  await sleep(60);
  const cockpitWorkspace = await evaluate(cdp, `(() => ({
    open: document.getElementById('cockpit-workspace-detail')?.open === true,
    visibleTable: document.querySelector('#cockpit-workspace-detail table')?.getClientRects().length > 0 && !document.querySelector('#cockpit-workspace-detail table')?.closest('details:not([open])'),
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(cockpitWorkspace.open, true, 'Secondary Cockpit detail must open from one explicit action');
  assert.equal(Boolean(cockpitWorkspace.visibleTable), true, 'Workspace project evidence must remain reachable');
  assert.equal(cockpitWorkspace.snapshotResources, cockpitInitial.snapshotResources, 'Opening secondary Cockpit detail must not refetch dashboard data');
  await evaluate(cdp, `document.querySelector('#cockpit-workspace-detail > summary').click()`);

  await evaluate(cdp, `document.querySelector('#cockpit-secondary-context > summary').click()`);
  await sleep(60);
  const cockpitSecondaryContext = await evaluate(cdp, `(() => ({
    open: document.getElementById('cockpit-secondary-context')?.open === true,
    visibleCards: Array.from(document.querySelectorAll('#cockpit-secondary-context .card')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(cockpitSecondaryContext.open, true, 'Secondary Cockpit context must open from one explicit action');
  assert.ok(cockpitSecondaryContext.visibleCards >= 5, 'Capabilities/history/Git/maintenance evidence must remain reachable inside secondary context');
  assert.equal(cockpitSecondaryContext.snapshotResources, cockpitInitial.snapshotResources, 'Opening secondary Cockpit context must not refetch dashboard data');

  await evaluate(cdp, `document.querySelector('.cockpit-technical-disclosure > summary').click()`);
  await sleep(80);
  const cockpitRaw = await evaluate(cdp, `(() => ({
    open: document.querySelector('.cockpit-technical-disclosure')?.open === true,
    visibleCards: Array.from(document.querySelectorAll('#cockpit-traces .cockpit-trace')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(cockpitRaw.open, true, 'Raw MSSR evidence must remain reachable behind one explicit disclosure');
  assert.equal(cockpitRaw.visibleCards, cockpitInitial.rawCardsTotal, 'Opening Raw must expose exactly the retained trace cards, including a valid empty state');
  assert.equal(cockpitRaw.snapshotResources, cockpitInitial.snapshotResources, 'Opening raw Cockpit evidence must not trigger a new snapshot request');
  await screenshot(cdp, path.join(runDir, '05-cockpit-raw-open.png'));

  await evaluate(cdp, `document.querySelector('[data-tab="tools"]').click()`);
  assert.equal(await waitFor(cdp, `document.querySelectorAll('#panel-tools .context-help').length >= 2 && !document.getElementById('tools-result-count')?.innerText.includes('cargando')`), true, 'Tools contextual help and portfolio state must render');
  const toolsInitial = await evaluate(cdp, `(() => ({
    contract: document.getElementById('panel-tools')?.dataset.uxContract || null,
    helpCount: document.querySelectorAll('#panel-tools .context-help').length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(toolsInitial.contract, 'human-v1');
  assert.ok(toolsInitial.helpCount >= 2, 'Tools must expose contextual help for portfolio and notices');
  await evaluate(cdp, `document.querySelector('#panel-tools .context-help > summary').click()`);
  await sleep(50);
  const toolsHelp = await evaluate(cdp, `(() => ({
    open: document.querySelector('#panel-tools .context-help')?.open === true,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(toolsHelp.open, true, 'Tools contextual help must open natively');
  assert.equal(toolsHelp.snapshotResources, toolsInitial.snapshotResources, 'Opening Tools help must not refetch dashboard data');
  await evaluate(cdp, `document.querySelector('#panel-tools .context-help > summary').click()`);

  await evaluate(cdp, `document.querySelector('[data-tab="errors"]').click()`);
  assert.equal(await waitFor(cdp, `document.getElementById('recent-errors-count')?.innerText.trim() !== '—'`), true, 'Errors state must render');
  const errorsInitial = await evaluate(cdp, `(() => ({
    contract: document.getElementById('panel-errors')?.dataset.uxContract || null,
    helpCount: document.querySelectorAll('#panel-errors .context-help').length,
    errorItems: document.querySelectorAll('#error-list .error-item').length,
    openItems: document.querySelectorAll('#error-list .error-item[open]').length,
    visibleRaw: Array.from(document.querySelectorAll('#error-list .error-detail')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(errorsInitial.contract, 'human-v1');
  assert.ok(errorsInitial.helpCount >= 1, 'Errors must expose contextual help');
  assert.equal(errorsInitial.openItems, 0, 'Error detail must stay collapsed by default');
  assert.equal(errorsInitial.visibleRaw, 0, 'Raw error messages must not compete with the compact list');
  await evaluate(cdp, `document.querySelector('#panel-errors .context-help > summary').click()`);
  await sleep(50);
  const errorsHelp = await evaluate(cdp, `(() => ({
    open: document.querySelector('#panel-errors .context-help')?.open === true,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(errorsHelp.open, true);
  assert.equal(errorsHelp.snapshotResources, errorsInitial.snapshotResources, 'Opening Errors help must not refetch dashboard data');
  await evaluate(cdp, `document.querySelector('#panel-errors .context-help > summary').click()`);
  if (errorsInitial.errorItems > 0) {
    await evaluate(cdp, `document.querySelector('#error-list .error-item > summary').click()`);
    await sleep(50);
    const errorDetail = await evaluate(cdp, `(() => ({
      open: document.querySelector('#error-list .error-item')?.open === true,
      rawVisible: document.querySelector('#error-list .error-detail')?.getClientRects().length > 0 && !document.querySelector('#error-list .error-detail')?.closest('details:not([open])'),
      snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
    }))()`);
    assert.equal(errorDetail.open, true, 'One explicit action must expose the full error detail');
    assert.equal(Boolean(errorDetail.rawVisible), true, 'Expanded error must expose Raw detail');
    assert.equal(errorDetail.snapshotResources, errorsInitial.snapshotResources, 'Opening an error must not refetch dashboard data');
  }
  await screenshot(cdp, path.join(runDir, '06-errors-human-v1.png'));

  await evaluate(cdp, `document.querySelector('[data-tab="mssr"]').click()`);
  assert.equal(await waitFor(cdp, `document.querySelectorAll('#panel-mssr .mssr-family-group').length === 4 && !document.getElementById('mssr-family-routing-status').innerText.includes('cargando')`), true, 'MSSR diagnostic families and summaries must render');
  const mssrInitial = await evaluate(cdp, `(() => ({
    families: Array.from(document.querySelectorAll('#panel-mssr .mssr-family-group')).map((node) => ({ id: node.dataset.mssrFamily, open: node.open, status: node.querySelector('.mssr-family-status')?.innerText.trim() || '' })),
    currentNav: document.querySelector('[data-mssr-nav][aria-current="true"]')?.dataset.mssrNav || null,
    visibleTables: Array.from(document.querySelectorAll('#panel-mssr table')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.deepEqual(mssrInitial.families.map((item) => item.id), ['context', 'routing', 'identity', 'outcomes']);
  assert.equal(mssrInitial.families.every((item) => item.open === false), true, 'MSSR diagnostic families must be collapsed by default');
  assert.equal(mssrInitial.currentNav, 'overview', 'MSSR must start in Overview');
  assert.equal(mssrInitial.visibleTables, 0, 'MSSR detail tables must not compete with the default overview');
  await screenshot(cdp, path.join(runDir, '06-mssr-overview-default.png'));

  await evaluate(cdp, `document.querySelector('[data-mssr-nav="routing"]').click()`);
  await sleep(100);
  const mssrRouting = await evaluate(cdp, `(() => ({
    open: document.querySelector('[data-mssr-family="routing"]')?.open === true,
    currentNav: document.querySelector('[data-mssr-nav][aria-current="true"]')?.dataset.mssrNav || null,
    visibleTables: Array.from(document.querySelectorAll('[data-mssr-family="routing"] table')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    selectedVisible: document.getElementById('mssr-selected-skills')?.getClientRects().length > 0 && !document.getElementById('mssr-selected-skills')?.closest('details:not([open])'),
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(mssrRouting.open, true, 'Routing family must open from local navigation');
  assert.equal(mssrRouting.currentNav, 'routing', 'Local MSSR navigation must expose the active family');
  assert.ok(mssrRouting.visibleTables > 0, 'Routing diagnostics must remain reachable after disclosure');
  assert.equal(Boolean(mssrRouting.selectedVisible), true, 'Selected skills evidence must remain visible inside Routing');
  assert.equal(mssrRouting.snapshotResources, mssrInitial.snapshotResources, 'Opening an MSSR diagnostic family must not fetch a new dashboard snapshot');
  await screenshot(cdp, path.join(runDir, '07-mssr-routing-open.png'));

  await evaluate(cdp, `document.querySelector('[data-tab="summary"]').click()`);
  assert.equal(await waitFor(cdp, `!document.getElementById('summary-forensic-status')?.innerText.includes('cargando') && document.querySelectorAll('#summary-recent tr').length > 0 && document.querySelectorAll('#agent-profiles tr').length > 0`), true, 'Summary forensic detail must already be populated from the current snapshot');
  const summaryInitial = await evaluate(cdp, `(() => ({
    forensicOpen: document.querySelector('.summary-forensic')?.open === true,
    visibleTables: Array.from(document.querySelectorAll('.summary-forensic table')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    retainedRecentRows: document.querySelectorAll('#summary-recent tr').length,
    retainedProfileRows: document.querySelectorAll('#agent-profiles tr').length,
    helpCount: document.querySelectorAll('#panel-summary .context-help').length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(summaryInitial.forensicOpen, false, 'Summary forensic detail must be collapsed by default');
  assert.equal(summaryInitial.visibleTables, 0, 'Forensic tables must not compete with Summary default reading');
  assert.ok(summaryInitial.retainedRecentRows > 0 && summaryInitial.retainedProfileRows > 0, 'Collapsed Summary must retain its current bounded evidence in DOM');
  assert.ok(summaryInitial.helpCount >= 3, 'Summary must expose contextual help for technical definitions');

  await evaluate(cdp, `document.querySelector('#panel-summary .context-help > summary').click()`);
  await sleep(50);
  const summaryHelp = await evaluate(cdp, `(() => ({
    open: document.querySelector('#panel-summary .context-help')?.open === true,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(summaryHelp.open, true, 'Contextual help must open with one native disclosure action');
  assert.equal(summaryHelp.snapshotResources, summaryInitial.snapshotResources, 'Opening contextual help must not fetch another dashboard snapshot');
  await evaluate(cdp, `document.querySelector('#panel-summary .context-help > summary').click()`);

  await evaluate(cdp, `document.querySelector('.summary-forensic > summary').click()`);
  await sleep(80);
  const summaryForensic = await evaluate(cdp, `(() => ({
    open: document.querySelector('.summary-forensic')?.open === true,
    visibleTables: Array.from(document.querySelectorAll('.summary-forensic table')).filter((node) => node.getClientRects().length > 0 && !node.closest('details:not([open])')).length,
    snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
  }))()`);
  assert.equal(summaryForensic.open, true, 'Summary forensic detail must open from one explicit action');
  assert.equal(summaryForensic.visibleTables, 2, 'Both retained forensic tables must become visible after disclosure');
  assert.equal(summaryForensic.snapshotResources, summaryInitial.snapshotResources, 'Opening Summary forensic detail must not fetch another dashboard snapshot');
  await screenshot(cdp, path.join(runDir, '08-summary-forensic-open.png'));

  await evaluate(cdp, `document.querySelector('[data-tab="summary"]').focus()`);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(60);
  const keyboardTabs = await evaluate(cdp, `(() => ({
    selected: document.querySelector('[data-tab="cockpit"]')?.getAttribute('aria-selected'),
    focused: document.activeElement?.dataset?.tab || null,
  }))()`);
  assert.equal(keyboardTabs.selected, 'true', 'ArrowRight must activate the next top-level tab');
  assert.equal(keyboardTabs.focused, 'cockpit', 'Keyboard tab navigation must move visible focus with selection');

  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  await evaluate(cdp, `document.querySelector('[data-tab="system"]').click()`);
  await sleep(120);
  const mobileSystem = await evaluate(cdp, `(() => {
    const rail = document.querySelector('.tabs');
    const tab = document.querySelector('[data-tab="system"]');
    const railRect = rail.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    return {
      selected: tab.getAttribute('aria-selected'),
      fullyVisible: tabRect.left >= railRect.left - 1 && tabRect.right <= railRect.right + 1,
      railScrollLeft: rail.scrollLeft,
      railScrollWidth: rail.scrollWidth,
      railClientWidth: rail.clientWidth,
      systemHelpCount: document.querySelectorAll('#panel-system .context-help').length,
    };
  })()`);
  assert.equal(mobileSystem.selected, 'true', 'Sistema must become the selected top-level tab on mobile');
  assert.equal(mobileSystem.fullyVisible, true, 'Selected top-level tab must be brought fully into view on an overflowing mobile rail');
  assert.ok(mobileSystem.railScrollWidth > mobileSystem.railClientWidth, 'Mobile tab rail must exercise the overflow path');
  assert.ok(mobileSystem.systemHelpCount >= 1, 'Sistema must expose contextual help for observability terminology');
  await screenshot(cdp, path.join(runDir, '09-mobile-system.png'));
  await evaluate(cdp, `document.getElementById('legacy-dashboard').open = false; document.querySelector('[data-v2-tab="home"]').click(); window.scrollTo(0, 0)`);
  await sleep(100);
  const mobileHome = await evaluate(cdp, `(() => {
    const header = document.querySelector('.topbar-v2')?.getBoundingClientRect();
    const nav = document.querySelector('.v2-tabs')?.getBoundingClientRect();
    const hero = document.querySelector('.home-hero')?.getBoundingClientRect();
    const continueSurface = document.querySelector('.home-continue-surface')?.getBoundingClientRect();
    return {
      selected: document.querySelector('[data-v2-tab="home"]')?.getAttribute('aria-selected'),
      headerHeight: Math.round(header?.height || 0),
      navHeight: Math.round(nav?.height || 0),
      chromeHeight: Math.round((header?.height || 0) + (nav?.height || 0)),
      heroVisible: Boolean(hero && hero.top < innerHeight && hero.bottom > 0),
      continueVisible: Boolean(continueSurface && continueSurface.top < innerHeight && continueSurface.bottom > 0),
      legacyOpen: document.getElementById('legacy-dashboard')?.open === true,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  assert.equal(mobileHome.selected, 'true');
  assert.equal(mobileHome.legacyOpen, false);
  assert.ok(mobileHome.chromeHeight <= 115, `V2 mobile shell + primary nav must stay compact, observed ${mobileHome.chromeHeight}px`);
  assert.equal(mobileHome.heroVisible, true, 'Human status must be visible in the first mobile viewport');
  assert.equal(mobileHome.continueVisible, true, 'Continue-now work must begin in the first mobile viewport');
  assert.equal(mobileHome.horizontalOverflow, false, 'V2 mobile shell must not create document-level horizontal overflow');
  await screenshot(cdp, path.join(runDir, '10-v2-home-mobile.png'));
  await evaluate(cdp, `document.querySelector('[data-v2-tab="work"]').click(); window.scrollTo(0, 0)`);
  await sleep(80);
  const mobileWork = await evaluate(cdp, `(() => {
    const hero = document.querySelector('#panel-work-v2 .work-hero')?.getBoundingClientRect();
    const active = document.getElementById('work-active-heading')?.getBoundingClientRect();
    const range = document.querySelector('.work-range-group')?.getBoundingClientRect();
    return {
      selected: document.querySelector('[data-v2-tab="work"]')?.getAttribute('aria-selected'),
      heroVisible: Boolean(hero && hero.top < innerHeight && hero.bottom > 0),
      activeVisible: Boolean(active && active.top < innerHeight && active.bottom > 0),
      rangeFullyVisible: Boolean(range && range.left >= 0 && range.right <= innerWidth + 1),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      snapshotResources: performance.getEntriesByName('/api/dashboard/snapshot').length + performance.getEntriesByName(location.origin + '/api/dashboard/snapshot').length,
    };
  })()`);
  assert.equal(mobileWork.selected, 'true');
  assert.equal(mobileWork.heroVisible, true, 'Trabajo status must be visible in the first mobile viewport');
  assert.equal(mobileWork.activeVisible, true, 'Trabajo activo must begin in the first mobile viewport');
  assert.equal(mobileWork.rangeFullyVisible, true, 'Trabajo range controls must fit the mobile viewport');
  assert.equal(mobileWork.horizontalOverflow, false, 'V2-B Trabajo must not create document-level horizontal overflow');
  assert.equal(mobileWork.snapshotResources, workInitial.snapshotResources, 'Opening Trabajo on mobile must reuse the same bounded snapshot');
  await screenshot(cdp, path.join(runDir, '11-v2-work-mobile.png'));

  const receipt = {
    ok: true,
    url,
    runDir,
    v2: {
      contract: homeInitial.contract,
      tabs: homeInitial.v2Tabs,
      legacyDefaultOpen: homeInitial.legacyOpen,
      legacyVisiblePanelsDefault: homeInitial.legacyVisiblePanels,
      statusSentence: homeInitial.statusSentence,
      continueTitle: homeInitial.continueTitle,
      attentionText: homeInitial.attentionText,
      activity: homeInitial.activity,
      errors: homeInitial.errors,
      sessions: homeInitial.sessions,
      persistence: homeInitial.persistence,
      changeRows: homeInitial.changeRows,
      inspectorFetched: inspectorOpen.snapshotResources !== homeInitial.snapshotResources,
      keyboard: v2Keyboard,
      work: {
        currentTaskCards: workInitial.taskCards,
        currentProjectStates: workInitial.projectStates,
        currentTimelineEvents: workInitial.timelineEvents,
        currentRangeNote: workInitial.rangeNote,
        allProjectCount: workAll.projectCount,
        sevenDayStates: work7d.states,
        thirtyDayStates: work30d.states,
        thirtyDaySemanticEvents: work30d.semanticEvents,
        rangeSwitchFetched: work30d.snapshotResources !== workInitial.snapshotResources,
        mobile: mobileWork,
      },
      mobile: mobileHome,
    },
    aggregateGroups: initial.aggregateGroups,
    rawRows: initial.rawRows,
    rawVisibleRows: raw.visibleRows,
    modeSwitchFetched: raw.snapshotResources !== initial.snapshotResources,
    bucketDetail: bucket.detail,
    cockpit: {
      orientationKinds: cockpitInitial.orientation.map((item) => item.kind),
      humanTasks: cockpitInitial.humanTasks,
      taskSurfaceText: cockpitInitial.taskSurfaceText,
      nestedEvidence: cockpitInitial.nestedEvidence,
      secondaryContextDefaultOpen: cockpitInitial.secondaryContextOpen,
      defaultVisibleSecondaryContextCards: cockpitInitial.visibleSecondaryContextCards,
      secondaryContextOpened: cockpitSecondaryContext.open,
      secondaryContextVisibleCardsAfterOpen: cockpitSecondaryContext.visibleCards,
      secondaryContextFetched: cockpitSecondaryContext.snapshotResources !== cockpitInitial.snapshotResources,
      secondaryDisclosures: cockpitInitial.secondary,
      defaultVisibleSecondaryTables: cockpitInitial.visibleSecondaryTables,
      helpCount: cockpitInitial.helpCount,
      workspaceDetailOpened: cockpitWorkspace.open,
      workspaceDetailFetched: cockpitWorkspace.snapshotResources !== cockpitInitial.snapshotResources,
      rawDefaultVisibleCards: cockpitInitial.visibleRawCards,
      rawRetainedCards: cockpitInitial.rawCardsTotal,
      rawVisibleCardsAfterOpen: cockpitRaw.visibleCards,
      rawDisclosureFetched: cockpitRaw.snapshotResources !== cockpitInitial.snapshotResources,
    },
    tools: { helpCount: toolsInitial.helpCount, contextualHelpFetched: toolsHelp.snapshotResources !== toolsInitial.snapshotResources },
    errors: { helpCount: errorsInitial.helpCount, retainedItems: errorsInitial.errorItems, defaultOpenItems: errorsInitial.openItems, defaultVisibleRaw: errorsInitial.visibleRaw, contextualHelpFetched: errorsHelp.snapshotResources !== errorsInitial.snapshotResources },
    keyboardTabs,
    mssr: { families: mssrInitial.families, defaultVisibleTables: mssrInitial.visibleTables, routingOpened: mssrRouting.open, routingVisibleTables: mssrRouting.visibleTables, familyDisclosureFetched: mssrRouting.snapshotResources !== mssrInitial.snapshotResources },
    summary: { helpCount: summaryInitial.helpCount, forensicDefaultOpen: summaryInitial.forensicOpen, defaultVisibleTables: summaryInitial.visibleTables, retainedRecentRows: summaryInitial.retainedRecentRows, retainedProfileRows: summaryInitial.retainedProfileRows, contextualHelpFetched: summaryHelp.snapshotResources !== summaryInitial.snapshotResources, forensicVisibleTablesAfterOpen: summaryForensic.visibleTables, forensicDisclosureFetched: summaryForensic.snapshotResources !== summaryInitial.snapshotResources },
    mobileSystem,
  };
  writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  cdp?.close();
  try { browser.kill(); } catch {}
  await sleep(150);
  rmSync(profileDir, { recursive: true, force: true });
}
