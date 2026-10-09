#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:3001/dashboard';
const DEFAULT_VIEWPORT = { width: 1440, height: 1000 };
const DEFAULT_SIMILARITY = 0.86;
const DEFAULT_SETTLE_MS = 550;
const DEFAULT_MAX_CAPTURES_PER_TAB = 24;
const DEFAULT_REVIEW_PER_TAB = 6;

function usage() {
  console.log(`Bridge Dashboard Visual QA Harness

Usage:
  node scripts/dashboard-visual-harness.mjs [options]

Options:
  --url <url>                 Dashboard URL (default: ${DEFAULT_URL})
  --out <dir>                 Evidence root (default: data/dashboard-visual-qa)
  --viewport <WxH>            Viewport (default: ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height})
  --tabs <a,b,c>              Restrict dashboard tabs
  --surface <legacy|v2>       Capture retained V1 panels or V2 human-intent surfaces (default: legacy)
  --similarity <0..1>         Near-duplicate threshold (default: ${DEFAULT_SIMILARITY})
  --settle-ms <ms>            Wait after tab/scroll changes (default: ${DEFAULT_SETTLE_MS})
  --max-per-tab <n>           Candidate cap per tab (default: ${DEFAULT_MAX_CAPTURES_PER_TAB})
  --review-per-tab <n>        Representative audit views per tab (default: ${DEFAULT_REVIEW_PER_TAB})
  --chrome <path>              Explicit Chrome/Chromium executable
  --help                      Show this help

The harness launches a separate headless Chrome process (windowsHide=true), so it does not
create or focus a desktop browser window. Evidence is written under an ignored runtime folder.
`);
}

function parseArgs(argv) {
  const result = {
    url: DEFAULT_URL,
    out: 'data/dashboard-visual-qa',
    viewport: { ...DEFAULT_VIEWPORT },
    tabs: null,
    surface: 'legacy',
    similarity: DEFAULT_SIMILARITY,
    settleMs: DEFAULT_SETTLE_MS,
    maxPerTab: DEFAULT_MAX_CAPTURES_PER_TAB,
    reviewPerTab: DEFAULT_REVIEW_PER_TAB,
    chrome: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    const value = argv[i + 1];
    if (arg === '--url') result.url = value, i += 1;
    else if (arg === '--out') result.out = value, i += 1;
    else if (arg === '--surface') result.surface = value, i += 1;
    else if (arg === '--tabs') result.tabs = value.split(',').map((v) => v.trim()).filter(Boolean), i += 1;
    else if (arg === '--chrome') result.chrome = value, i += 1;
    else if (arg === '--similarity') result.similarity = Number(value), i += 1;
    else if (arg === '--settle-ms') result.settleMs = Number(value), i += 1;
    else if (arg === '--max-per-tab') result.maxPerTab = Number(value), i += 1;
    else if (arg === '--review-per-tab') result.reviewPerTab = Number(value), i += 1;
    else if (arg === '--viewport') {
      const match = /^(\d+)x(\d+)$/i.exec(value || '');
      if (!match) throw new Error(`Invalid --viewport: ${value}`);
      result.viewport = { width: Number(match[1]), height: Number(match[2]) };
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['legacy', 'v2'].includes(result.surface)) throw new Error('--surface must be legacy or v2');
  if (!(result.similarity > 0 && result.similarity <= 1)) throw new Error('--similarity must be > 0 and <= 1');
  if (!(result.settleMs >= 0)) throw new Error('--settle-ms must be >= 0');
  if (!(result.maxPerTab >= 2)) throw new Error('--max-per-tab must be >= 2');
  if (!(result.reviewPerTab >= 2)) throw new Error('--review-per-tab must be >= 2');
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const isoRunId = () => new Date().toISOString().replace(/[:.]/g, '-');

async function getFreePort() {
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

function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const where = spawnSync('where', ['chrome.exe'], { encoding: 'utf8', windowsHide: true });
  if (where.status === 0) {
    const first = where.stdout.split(/\r?\n/).map((v) => v.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  }
  throw new Error('Chrome/Chromium was not found. Pass --chrome <path>.');
}

async function fetchJson(url, attempts = 80, delayMs = 100) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }
  throw lastError || new Error(`Could not fetch ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP websocket open timeout')), 8000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('CDP websocket error'));
      }, { once: true });
    });
    this.ws.addEventListener('message', (event) => this.#onMessage(event.data));
  }

  #onMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`${message.error.message || 'CDP error'} (${message.error.code || 'unknown'})`));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method) {
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    }
  }

  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  call(method, params = {}, timeoutMs = 10000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function evaluate(cdp, expression, { awaitPromise = true } = {}) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed';
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 12000, intervalMs = 150) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch {}
    await sleep(intervalMs);
  }
  return false;
}

function setFromSignature(signature) {
  const values = new Set();
  for (const token of signature.tokens || []) values.add(`t:${token}`);
  for (const block of signature.blocks || []) {
    values.add(`b:${block.key}|${block.x}|${block.y}|${block.w}|${block.h}`);
  }
  return values;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller) if (larger.has(value)) intersection += 1;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function downsamplePositions(input, maxCount) {
  const positions = [...new Set(input.map((v) => Math.max(0, Math.round(v))))].sort((a, b) => a - b);
  if (positions.length <= maxCount) return positions;
  const chosen = [];
  for (let i = 0; i < maxCount; i += 1) {
    const index = Math.round(i * (positions.length - 1) / (maxCount - 1));
    chosen.push(positions[index]);
  }
  return [...new Set(chosen)];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildAuditOpportunities(stats = {}) {
  const opportunities = [];
  const scrollScreens = stats.viewportHeight ? Number(stats.scrollHeight || 0) / stats.viewportHeight : 0;
  const repeated = (stats.repeatedVisibleTexts || []).filter(([, count]) => count >= 5);
  const push = (id, signal, evidence, ideas) => opportunities.push({ id, signal, evidence, ideas });

  if (repeated.length) push(
    'repeated-row-copy',
    repeated[0][1] >= 20 ? 'high' : 'medium',
    `${repeated.length} textos se repiten >=5 veces; máximo ${repeated[0][1]} repeticiones.`,
    ['agrupar por estado/recomendación', 'mostrar contador acumulado', 'drill-down expandible para filas y estadísticas'],
  );
  if ((stats.rowLikeCount || 0) >= 40) push(
    'large-row-set',
    'high',
    `${stats.rowLikeCount} filas/items repetitivos en la pestaña.`,
    ['resumen por grupos antes del detalle', 'filtros/búsqueda', 'paginación o virtualización', 'master-detail con grupo expandible'],
  );
  if (scrollScreens >= 6) push(
    'deep-scroll',
    scrollScreens >= 10 ? 'high' : 'medium',
    `${scrollScreens.toFixed(1)} viewports verticales (${stats.scrollHeight}px).`,
    ['cards/secciones colapsables', 'navegación local sticky', 'summary-first + details', 'cargar detalle bajo demanda'],
  );
  if ((stats.descriptionWords || 0) >= 150) push(
    'static-explanation-load',
    (stats.descriptionWords || 0) >= 300 ? 'high' : 'medium',
    `${stats.descriptionWords} palabras de explicación estática.`,
    ['frase corta visible', 'tooltip/popover accesible para definiciones', 'details para metodología avanzada'],
  );
  if ((stats.helpAffordanceCount || 0) === 0 && ((stats.descriptionWords || 0) >= 80 || (stats.nativeTooltipCount || 0) >= 25)) push(
    'contextual-help-gap',
    'medium',
    `${stats.nativeTooltipCount || 0} title técnicos y 0 affordances de ayuda contextual.`,
    ['patrón único de ayuda accesible', 'aria-describedby + teclado', 'evitar hover-only para información esencial'],
  );
  if ((stats.collapseAffordanceCount || 0) === 0 && scrollScreens >= 4) push(
    'progressive-disclosure-gap',
    'medium',
    `0 controles de expansión detectados en una superficie de ${scrollScreens.toFixed(1)} viewports.`,
    ['details/summary o acordeón moderado', 'expandir sólo excepciones/filas seleccionadas', 'preservar estado de expansión durante QA'],
  );
  if ((stats.tableCount || 0) >= 4) push(
    'table-fragmentation',
    'low',
    `${stats.tableCount} tablas compiten en la misma pestaña.`,
    ['resumen visual común', 'subvistas por tema', 'tablas sólo para detalle comparativo'],
  );
  return opportunities;
}

function buildReviewQueue(manifest, maxPerTab) {
  const queue = [];
  for (const tab of manifest.tabs) {
    const captures = manifest.captures.filter((capture) => capture.tab === tab.id).sort((a, b) => a.scrollY - b.scrollY);
    if (!captures.length) continue;
    const textMedian = median(captures.map((capture) => capture.viewportTextChars || 0));
    const scored = captures.map((capture, index) => {
      const reasons = [];
      let score = 0;
      if (index === 0) score += 100, reasons.push('inicio de pestaña');
      if (index === captures.length - 1) score += 90, reasons.push('final de pestaña');
      const novelty = Number(capture.deltaFromPrevious?.novelty || 0);
      if (novelty >= 0.18) score += Math.round(novelty * 50), reasons.push(`novedad ${(novelty * 100).toFixed(0)}%`);
      if (capture.deltaFromPrevious?.sectionChanged) score += 38, reasons.push('cambio de sección');
      if ((capture.repetitionHits || []).length) score += Math.min(32, capture.repetitionHits.length * 8), reasons.push(`${capture.repetitionHits.length} repetición/es visible/s`);
      if (textMedian && (capture.viewportTextChars || 0) > textMedian * 1.25) score += 14, reasons.push('densidad textual alta');
      if ((capture.visibleCounts?.rows || 0) >= 12) score += 12, reasons.push(`${capture.visibleCounts.rows} filas/items visibles`);
      if ((capture.visibleCounts?.tables || 0) >= 2) score += 8, reasons.push(`${capture.visibleCounts.tables} tablas visibles`);
      if (!reasons.length) reasons.push('muestra de continuidad');
      return { capture, score, reasons };
    });
    scored.sort((a, b) => b.score - a.score || a.capture.scrollY - b.capture.scrollY);
    const targetCount = Math.min(maxPerTab, scored.length);
    const selected = [];
    const selectedIndexes = new Set();
    const sectionCounts = new Map();
    const sectionKey = (item) => item.capture.dominantSection || item.capture.visibleHeadings?.[0] || '__top__';
    const add = (item, forced = false) => {
      if (!item || selectedIndexes.has(item.capture.index)) return false;
      const key = sectionKey(item);
      if (!forced && (sectionCounts.get(key) || 0) >= 2) return false;
      selected.push(item);
      selectedIndexes.add(item.capture.index);
      sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
      return true;
    };
    add(scored.find((item) => item.capture.index === captures[0].index), true);
    add(scored.find((item) => item.capture.index === captures.at(-1).index), true);
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      add(item, false);
    }
    selected.sort((a, b) => a.capture.scrollY - b.capture.scrollY);
    for (const item of selected) queue.push({
      tab: tab.id,
      tabLabel: tab.label,
      captureIndex: item.capture.index,
      file: item.capture.file,
      scrollY: item.capture.scrollY,
      score: item.score,
      reasons: item.reasons,
      dominantSection: item.capture.dominantSection || null,
      visibleHeadings: item.capture.visibleHeadings || [],
      visibleCounts: item.capture.visibleCounts || {},
      repetitionHits: item.capture.repetitionHits || [],
      deltaFromPrevious: item.capture.deltaFromPrevious || null,
    });
  }
  return queue;
}

function renderHtml(manifest, runDir) {
  const captureByIndex = new Map(manifest.captures.map((capture) => [capture.index, capture]));
  const card = (capture, audit = null) => {
    const reasons = audit?.reasons?.length ? `<div class="reasons">${audit.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>` : '';
    const headings = (capture.visibleHeadings || []).length ? escapeHtml(capture.visibleHeadings.join(' · ')) : 'sin heading visible';
    const counts = capture.visibleCounts || {};
    const delta = capture.deltaFromPrevious || {};
    const repetitions = (capture.repetitionHits || []).map((hit) => `${hit.count}× ${hit.text}`).join(' | ');
    return `<figure id="capture-${capture.index}">
      <a href="${escapeHtml(relativePosix(runDir, path.join(runDir, capture.file)))}"><img loading="lazy" src="${escapeHtml(capture.file)}" alt="${escapeHtml(capture.tabLabel)} y=${capture.scrollY}"></a>
      <figcaption><strong>${escapeHtml(capture.tabLabel)}</strong> · y=${capture.scrollY} · ${capture.viewportTextChars} chars · sección: ${escapeHtml(capture.dominantSection || '—')}<br>
      <span class="muted">${headings}</span>${reasons}
      <details><summary>evidencia de esta vista</summary><div class="detail">filas/items ${counts.rows || 0} · cards ${counts.cards || 0} · tablas ${counts.tables || 0} · links ${counts.links || 0} · botones ${counts.buttons || 0}<br>delta: ${(Number(delta.novelty || 0) * 100).toFixed(0)}% novedad${delta.sectionChanged ? ' · cambio de sección' : ''}${repetitions ? `<br>repeticiones: ${escapeHtml(repetitions)}` : ''}<br><code>${escapeHtml(capture.sha256.slice(0, 12))}</code></div></details></figcaption>
    </figure>`;
  };

  const nav = manifest.tabs.map((tab) => `<a href="#tab-${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</a>`).join('');
  const reviewCards = manifest.reviewQueue.map((item) => card(captureByIndex.get(item.captureIndex), item)).join('');
  const groups = manifest.tabs.map((tab) => {
    const captures = manifest.captures.filter((capture) => capture.tab === tab.id);
    const stats = manifest.tabStats.find((item) => item.tab === tab.id) || {};
    const opportunities = manifest.auditOpportunities.find((item) => item.tab === tab.id)?.items || [];
    const opportunityHtml = opportunities.length
      ? `<div class="opportunities">${opportunities.map((item) => `<div class="opportunity ${escapeHtml(item.signal)}"><strong>${escapeHtml(item.id)}</strong> · ${escapeHtml(item.evidence)}<br><span>${item.ideas.map(escapeHtml).join(' · ')}</span></div>`).join('')}</div>`
      : '<p class="muted">Sin señales heurísticas fuertes en esta pasada.</p>';
    const cards = captures.map((capture) => card(capture)).join('');
    return `<section id="tab-${escapeHtml(tab.id)}"><h2>${escapeHtml(tab.label)} <small>${captures.length} capturas</small></h2>
      <p>${stats.descriptionCount || 0} descripciones · ${stats.descriptionWords || 0} palabras explicativas · ${stats.rowLikeCount || 0} filas/items · ${stats.nativeTooltipCount || 0} title técnicos · ${stats.helpAffordanceCount || 0} ayudas · ${stats.collapseAffordanceCount || 0} expandibles · ${stats.scrollHeight || 0}px</p>
      ${opportunityHtml}
      <details class="all-evidence"><summary>Ver evidencia completa de ${escapeHtml(tab.label)} (${captures.length})</summary><div class="grid">${cards || '<p>Sin capturas.</p>'}</div></details></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Visual QA · ${escapeHtml(manifest.runId)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:#0c111b;color:#e8eef8}header{position:sticky;top:0;z-index:2;background:#111827f2;padding:14px 24px;border-bottom:1px solid #334155}main{padding:20px 24px;max-width:1900px;margin:auto}h1,h2{margin:.2em 0}.meta,.muted{color:#9eabc0}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.nav a,.reasons span{display:inline-block;padding:4px 8px;border:1px solid #344761;border-radius:999px;color:#cfe4ff;text-decoration:none;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:12px}figure{margin:0;background:#121a27;border:1px solid #27364b;border-radius:10px;overflow:hidden}img{display:block;width:100%;height:auto}figcaption{padding:9px 11px;color:#cbd5e1;font-size:13px}.reasons{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.detail{padding:7px 0;color:#aebbd0;line-height:1.45}section{margin-bottom:34px;scroll-margin-top:120px}small{font-weight:400;color:#94a3b8}code{color:#a5d8ff}.review{padding:14px;border:1px solid #3b516f;border-radius:12px;background:#101927;margin-bottom:30px}.opportunities{display:grid;gap:7px;margin:10px 0 14px}.opportunity{padding:9px 11px;border-left:3px solid #64748b;background:#121a27;border-radius:5px}.opportunity.high{border-left-width:6px}.opportunity span{color:#aebbd0;font-size:13px}.all-evidence>summary{cursor:pointer;padding:9px 11px;background:#121a27;border:1px solid #27364b;border-radius:8px;font-weight:600}details summary{cursor:pointer}
</style></head><body><header><h1>Bridge/MSSR Dashboard · Visual QA</h1><div class="meta">${escapeHtml(manifest.capturedAt)} · ${manifest.captures.length} vistas únicas · ${manifest.reviewQueue.length} en cola de revisión · ${manifest.skipped.length} redundantes descartadas · headless</div><nav class="nav">${nav}</nav></header><main><section class="review"><h2>Cola de revisión representativa</h2><p class="muted">Seleccionada por inicio/final, cambio de sección, novedad, repetición y densidad. La evidencia completa permanece debajo.</p><div class="grid">${reviewCards}</div></section>${groups}</main></body></html>`;
}

function renderMarkdown(manifest) {
  const lines = [
    '# Bridge/MSSR Dashboard Visual QA Evidence',
    '',
    `- Run: \`${manifest.runId}\``,
    `- Captured: ${manifest.capturedAt}`,
    `- URL: ${manifest.url}`,
    `- Browser: ${manifest.browser.product || 'unknown'}`,
    `- Viewport: ${manifest.viewport.width}×${manifest.viewport.height}`,
    `- Unique screenshots: ${manifest.captures.length}`,
    `- Review queue: ${manifest.reviewQueue.length}`,
    `- Near-duplicate candidates skipped: ${manifest.skipped.length}`,
    `- Console/runtime errors: ${manifest.runtimeErrors.length}`,
    `- Network failures: ${manifest.networkFailures.length}`,
    '',
    '## Tabs',
    '',
    '| Tab | Capturas | Review | Alto px | Filas/items | Descripciones | Palabras | Repeticiones top | Ayuda | Expandibles |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const tab of manifest.tabs) {
    const stats = manifest.tabStats.find((item) => item.tab === tab.id) || {};
    const captures = manifest.captures.filter((capture) => capture.tab === tab.id).length;
    const review = manifest.reviewQueue.filter((item) => item.tab === tab.id).length;
    const topRepeat = stats.repeatedVisibleTexts?.[0]?.[1] || 0;
    lines.push(`| ${tab.label} | ${captures} | ${review} | ${stats.scrollHeight ?? 0} | ${stats.rowLikeCount ?? 0} | ${stats.descriptionCount ?? 0} | ${stats.descriptionWords ?? 0} | ${topRepeat}× | ${stats.helpAffordanceCount ?? 0} | ${stats.collapseAffordanceCount ?? 0} |`);
  }
  lines.push('', '## Heuristic audit opportunities', '');
  for (const tab of manifest.tabs) {
    const items = manifest.auditOpportunities.find((entry) => entry.tab === tab.id)?.items || [];
    lines.push(`### ${tab.label}`, '');
    if (!items.length) lines.push('- No strong deterministic audit signal in this run.', '');
    else for (const item of items) lines.push(`- **${item.signal} · ${item.id}**: ${item.evidence} Ideas: ${item.ideas.join('; ')}.`, '');
  }
  lines.push('## Files', '', '- `contact-sheet.html`: review queue first; full evidence collapsed by tab.', '- `review-queue.json`: machine-readable representative review set.', '- `review-queue.md`: ordered frame-by-frame audit checklist.', '- `manifest.json`: complete structured evidence, fingerprints, deltas and errors.', '- `screens/`: all retained viewport PNGs.', '');
  return lines.join('\n');
}

function renderReviewMarkdown(manifest) {
  const lines = [
    '# Dashboard visual QA review queue',
    '',
    `Run: \`${manifest.runId}\` · ${manifest.reviewQueue.length} representative views from ${manifest.captures.length} unique captures.`,
    '',
    'The queue is a review aid, not a replacement for the complete evidence set.',
    '',
  ];
  for (const tab of manifest.tabs) {
    const items = manifest.reviewQueue.filter((item) => item.tab === tab.id);
    lines.push(`## ${tab.label}`, '');
    for (const item of items) {
      const repetition = (item.repetitionHits || []).map((hit) => `${hit.count}× ${hit.text}`).join(' | ');
      lines.push(
        `### Frame ${item.captureIndex} · y=${item.scrollY} · score ${item.score}`,
        '',
        `- File: \`${item.file}\``,
        `- Section: ${item.dominantSection || 'unknown'}`,
        `- Why review: ${item.reasons.join('; ')}`,
        `- Visible headings: ${(item.visibleHeadings || []).join(' · ') || 'none'}`,
        `- Visible counts: rows/items ${item.visibleCounts?.rows || 0}, cards ${item.visibleCounts?.cards || 0}, tables ${item.visibleCounts?.tables || 0}, buttons ${item.visibleCounts?.buttons || 0}, links ${item.visibleCounts?.links || 0}`,
        `- Delta from previous retained frame: ${Math.round(Number(item.deltaFromPrevious?.novelty || 0) * 100)}% novelty${item.deltaFromPrevious?.sectionChanged ? ', section changed' : ''}`,
        `- Repetition hits: ${repetition || 'none'}`,
        '- QA notes: _pending manual/visual review_',
        '',
      );
    }
  }
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tabDataKey = options.surface === 'v2' ? 'v2Tab' : 'tab';
  const panelDataKey = options.surface === 'v2' ? 'v2Panel' : 'panel';
  const tabSelector = options.surface === 'v2' ? '[data-v2-tab]' : '[data-tab]';
  const panelSelector = options.surface === 'v2' ? '[data-v2-panel]' : '[data-panel]';
  const cwd = process.cwd();
  const runId = isoRunId();
  const root = path.resolve(cwd, options.out);
  const runDir = path.join(root, runId);
  const screensDir = path.join(runDir, 'screens');
  mkdirSync(screensDir, { recursive: true });

  const chromePath = findChrome(options.chrome);
  const debugPort = await getFreePort();
  const profileDir = path.join(os.tmpdir(), `bridge-dashboard-qa-${process.pid}-${Date.now()}`);
  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    `--window-size=${options.viewport.width},${options.viewport.height}`,
    'about:blank',
  ];

  const chrome = spawn(chromePath, chromeArgs, {
    windowsHide: true,
    stdio: 'ignore',
  });

  let cdp = null;
  const runtimeErrors = [];
  const consoleMessages = [];
  const networkFailures = [];

  try {
    const browserVersion = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
    const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error('No Chrome page target was exposed by CDP.');

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([
      cdp.call('Page.enable'),
      cdp.call('Runtime.enable'),
      cdp.call('Network.enable'),
      cdp.call('Log.enable'),
    ]);
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      runtimeErrors.push({ kind: 'exception', timestamp: new Date().toISOString(), text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Runtime exception' });
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      consoleMessages.push({ type: params.type, timestamp: new Date().toISOString(), text: String(text).slice(0, 1200) });
    });
    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      if (entry.level === 'error') runtimeErrors.push({ kind: 'log', timestamp: new Date().toISOString(), text: String(entry.text || '').slice(0, 1200), url: entry.url || null, lineNumber: entry.lineNumber ?? null });
    });
    cdp.on('Network.loadingFailed', (params) => {
      if (params.canceled) return;
      networkFailures.push({ requestId: params.requestId, errorText: params.errorText, type: params.type, timestamp: new Date().toISOString() });
    });

    await cdp.call('Page.navigate', { url: options.url });
    const loaded = await waitFor(cdp, `document.readyState === 'complete' && !!document.querySelector('${tabSelector}')`, 15000);
    if (!loaded) throw new Error(`Dashboard did not become ready: ${options.url}`);
    await waitFor(cdp, `document.getElementById('updated-at')?.textContent?.trim() !== 'sin actualizar'`, 8000);
    await sleep(options.settleMs);
    if (options.surface === 'legacy') {
      await evaluate(cdp, `(() => { const legacy = document.getElementById('legacy-dashboard'); if (legacy) legacy.open = true; })()`);
      await sleep(Math.min(180, Math.max(50, options.settleMs / 3)));
    }

    const discoveredTabs = await evaluate(cdp, `Array.from(document.querySelectorAll('${tabSelector}')).map((node) => ({id: node.dataset.${tabDataKey}, label: node.textContent.trim()}))`);
    let tabs = discoveredTabs || [];
    if (options.tabs) tabs = tabs.filter((tab) => options.tabs.includes(tab.id));
    if (!tabs.length) throw new Error('No dashboard tabs matched the requested selection.');

    const captures = [];
    const skipped = [];
    const tabStats = [];
    let screenshotIndex = 0;

    for (const tab of tabs) {
      await evaluate(cdp, `(() => { const node = Array.from(document.querySelectorAll('${tabSelector}')).find((candidate) => candidate.dataset.${tabDataKey} === ${JSON.stringify(tab.id)}); if (!node) return false; node.click(); return true; })()`);
      await sleep(options.settleMs);
      await evaluate(cdp, `window.scrollTo(0, 0)`);
      await sleep(100);

      const stats = await evaluate(cdp, `(() => {
        const panel = Array.from(document.querySelectorAll('${panelSelector}')).find((candidate) => candidate.dataset.${panelDataKey} === ${JSON.stringify(tab.id)});
        if (!panel) return null;
        const hiddenByClosedDetails = (node) => { const closed = node.closest('details:not([open])'); if (!closed) return false; if (node.matches('summary') && node.parentElement === closed) return Boolean(closed.parentElement?.closest('details:not([open])')); return true; };
        const isVisiblyRendered = (node) => !hiddenByClosedDetails(node) && !node.closest('[hidden]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
        const retainedDescriptions = Array.from(panel.querySelectorAll('.card-description'));
        const descriptions = retainedDescriptions.filter(isVisiblyRendered);
        const text = descriptions.map((node) => node.textContent.trim()).filter(Boolean);
        const retainedText = retainedDescriptions.map((node) => node.textContent.trim()).filter(Boolean);
        const repeated = Object.entries(text.reduce((acc, value) => (acc[value] = (acc[value] || 0) + 1, acc), {})).filter(([, count]) => count > 1);
        const densityTexts = Array.from(panel.querySelectorAll('.card-description, td, .portfolio-recommendation, .portfolio-reason'))
          .filter(isVisiblyRendered)
          .map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim())
          .filter((value) => value.length >= 24);
        const repeatedVisibleTexts = Object.entries(densityTexts.reduce((acc, value) => (acc[value] = (acc[value] || 0) + 1, acc), {}))
          .filter(([, count]) => count >= 3)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12);
        const visibleCount = (selector) => Array.from(panel.querySelectorAll(selector)).filter(isVisiblyRendered).length;
        const visibleCollapseCount = Array.from(panel.querySelectorAll('details > summary, [aria-expanded], [data-collapse], [data-accordion]')).filter((node) => {
          if (!node.matches('summary')) return isVisiblyRendered(node);
          const owner = node.parentElement;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return !owner?.parentElement?.closest('details:not([open])') && !node.closest('[hidden]') && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        }).length;
        return {
          descriptionCount: descriptions.length,
          descriptionWords: text.join(' ').split(/\\s+/).filter(Boolean).length,
          retainedDescriptionCount: retainedDescriptions.length,
          retainedDescriptionWords: retainedText.join(' ').split(/\\s+/).filter(Boolean).length,
          repeatedDescriptions: repeated,
          repeatedVisibleTexts,
          nativeTooltipCount: visibleCount('[title]'),
          retainedNativeTooltipCount: panel.querySelectorAll('[title]').length,
          helpAffordanceCount: visibleCount('[data-tooltip], [aria-describedby], .help-icon, .info-button'),
          collapseAffordanceCount: visibleCollapseCount,
          ariaLabelCount: visibleCount('[aria-label]'),
          buttonCount: visibleCount('button'),
          linkCount: visibleCount('a[href]'),
          tableCount: visibleCount('table'),
          cardCount: visibleCount('article.card, article.metric-card, .metric-card'),
          rowLikeCount: visibleCount('tbody tr, .tool-row, .status-row, .attention-item, .cockpit-trace-card, .cockpit-return-pane'),
          headingCount: visibleCount('h2,h3'),
          panelTextChars: (panel.innerText || '').replace(/\\s+/g, ' ').trim().length,
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: innerHeight,
        };
      })()`);
      tabStats.push({ tab: tab.id, ...(stats || {}) });

      const layout = await evaluate(cdp, `(() => {
        const panel = Array.from(document.querySelectorAll('${panelSelector}')).find((candidate) => candidate.dataset.${panelDataKey} === ${JSON.stringify(tab.id)});
        if (!panel) return {height: document.documentElement.scrollHeight, viewport: innerHeight, landmarks: []};
        const nodes = Array.from(panel.querySelectorAll('article, .table-wrap, .timeline-wrap')).filter((node) => {
          const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
          return !node.closest('details:not([open])') && !node.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 24;
        });
        const landmarks = nodes.map((node) => Math.max(0, node.getBoundingClientRect().top + scrollY - 110));
        return {height: document.documentElement.scrollHeight, viewport: innerHeight, landmarks};
      })()`);
      const maxScroll = Math.max(0, Number(layout.height || 0) - Number(layout.viewport || options.viewport.height));
      const regular = [];
      const stride = Math.max(320, Math.floor(Number(layout.viewport || options.viewport.height) * 0.88));
      for (let y = 0; y < maxScroll; y += stride) regular.push(y);
      regular.push(maxScroll);
      let positions = downsamplePositions([0, ...(layout.landmarks || []), ...regular, maxScroll].map((y) => Math.min(maxScroll, y)), options.maxPerTab);
      if (!positions.includes(maxScroll)) positions = downsamplePositions([...positions, maxScroll], options.maxPerTab);

      const keptSignatures = [];
      const repetitionProbe = JSON.stringify((stats?.repeatedVisibleTexts || []).slice(0, 12).map(([text, count]) => ({ text, count })));
      for (let posIndex = 0; posIndex < positions.length; posIndex += 1) {
        const requestedY = positions[posIndex];
        await evaluate(cdp, `window.scrollTo({top:${requestedY}, left:0, behavior:'instant'})`);
        await sleep(Math.min(220, Math.max(70, Math.floor(options.settleMs / 3))));

        const signature = await evaluate(cdp, `(() => {
          const viewportTop = scrollY; const viewportBottom = scrollY + innerHeight;
          const visible = Array.from(document.querySelectorAll('main article, main .metric-card, main .status-row, main .tool-row, main tr, main .attention-item, main .cockpit-return-pane, main .cockpit-trace-card'))
            .filter((node) => {
              const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
              return !node.closest('details:not([open])') && !node.closest('[hidden]') && rect.bottom > 0 && rect.top < innerHeight && rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none';
            }).slice(0, 220);
          const blocks = visible.map((node) => {
            const rect = node.getBoundingClientRect();
            const raw = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 220);
            const key = (node.id || node.getAttribute('data-state') || node.className || node.tagName).toString().replace(/\\s+/g, '.').slice(0, 90) + ':' + raw.toLowerCase().replace(/\\d+/g, '#').slice(0, 110);
            return {key, x:Math.round(rect.left/40), y:Math.round(rect.top/40), w:Math.round(rect.width/40), h:Math.round(rect.height/40)};
          });
          const visibleText = visible.map((node) => (node.innerText || node.textContent || '')).join(' ').replace(/\\s+/g, ' ').trim();
          const tokens = Array.from(new Set(visibleText.toLowerCase().replace(/\\d+(?:[.,:]\\d+)*/g, '#').split(/[^\\p{L}\\p{N}_#.-]+/u).filter((token) => token.length > 2))).slice(0, 700);
          const panel = Array.from(document.querySelectorAll('${panelSelector}')).find((candidate) => candidate.dataset.${panelDataKey} === ${JSON.stringify(tab.id)});
          const isVisible = (node) => { const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return !node.closest('details:not([open])') && !node.closest('[hidden]') && rect.bottom>0 && rect.top<innerHeight && rect.width>4 && rect.height>4 && style.visibility!=='hidden' && style.display!=='none'; };
          const headings = panel ? Array.from(panel.querySelectorAll('h2,h3,h4')).filter(isVisible).map((node) => {
            const rect = node.getBoundingClientRect();
            return { text:(node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140), top:rect.top, bottom:rect.bottom };
          }).filter((item) => item.text) : [];
          const visibleHeadings = headings.filter((item) => item.bottom > 0 && item.top < innerHeight).map((item) => item.text).slice(0, 10);
          const absoluteY = scrollY + Math.min(260, innerHeight * 0.35);
          let dominantSection = null;
          if (panel) {
            for (const node of Array.from(panel.querySelectorAll('h2,h3,h4')).filter(isVisible)) {
              const top = node.getBoundingClientRect().top + scrollY;
              if (top <= absoluteY) dominantSection = (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140) || dominantSection;
              else break;
            }
          }
          const countVisible = (selector) => panel ? Array.from(panel.querySelectorAll(selector)).filter(isVisible).length : 0;
          const visibleCounts = {
            rows: countVisible('tbody tr, .tool-row, .status-row, .attention-item, .cockpit-trace-card, .cockpit-return-pane'),
            cards: countVisible('article.card, article.metric-card, .metric-card'),
            tables: countVisible('table'),
            buttons: countVisible('button'),
            links: countVisible('a[href]'),
            help: countVisible('[data-tooltip], [aria-describedby], .help-icon, .info-button'),
          };
          const repetitionHits = ${repetitionProbe}.filter((item) => visibleText.includes(item.text)).slice(0, 8);
          return {scrollY:Math.round(scrollY), scrollHeight:document.documentElement.scrollHeight, tokens, blocks, textChars:visibleText.length, textPreview:visibleText.slice(0, 900), visibleHeadings, dominantSection, visibleCounts, repetitionHits};
        })()`);
        const signatureSet = setFromSignature(signature);
        let bestSimilarity = 0;
        let bestCapture = null;
        for (const previous of keptSignatures) {
          const similarity = jaccard(signatureSet, previous.set);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestCapture = previous.file;
          }
        }
        const forced = posIndex === 0 || posIndex === positions.length - 1;
        if (!forced && bestSimilarity >= options.similarity) {
          skipped.push({ tab: tab.id, requestedY, scrollY: signature.scrollY, similarity: Number(bestSimilarity.toFixed(4)), duplicateOf: bestCapture, reason: 'near-duplicate-signature' });
          continue;
        }

        const shot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 15000);
        const buffer = Buffer.from(shot.data, 'base64');
        const digest = sha256(buffer);
        const exactDuplicate = captures.find((capture) => capture.tab === tab.id && capture.sha256 === digest);
        if (!forced && exactDuplicate) {
          skipped.push({ tab: tab.id, requestedY, scrollY: signature.scrollY, similarity: 1, duplicateOf: exactDuplicate.file, reason: 'exact-png-duplicate' });
          continue;
        }

        const immediatePrevious = keptSignatures.at(-1) || null;
        const similarityToPrevious = immediatePrevious ? jaccard(signatureSet, immediatePrevious.set) : 0;
        const currentTokens = new Set(signature.tokens || []);
        const previousTokens = new Set(immediatePrevious?.signature?.tokens || []);
        const addedTokens = [...currentTokens].filter((token) => !previousTokens.has(token)).slice(0, 18);
        const removedTokens = [...previousTokens].filter((token) => !currentTokens.has(token)).slice(0, 18);
        const deltaFromPrevious = {
          similarity: Number(similarityToPrevious.toFixed(4)),
          novelty: immediatePrevious ? Number((1 - similarityToPrevious).toFixed(4)) : 0,
          sectionChanged: Boolean(immediatePrevious && (immediatePrevious.signature?.dominantSection || null) !== (signature.dominantSection || null)),
          addedTokens,
          removedTokens,
        };

        const fileName = `${String(screenshotIndex).padStart(3, '0')}_${tab.id}_y${String(Math.max(0, signature.scrollY)).padStart(5, '0')}.png`;
        const filePath = path.join(screensDir, fileName);
        writeFileSync(filePath, buffer);
        const relativeFile = relativePosix(runDir, filePath);
        captures.push({
          index: screenshotIndex,
          tab: tab.id,
          tabLabel: tab.label,
          requestedY,
          scrollY: signature.scrollY,
          scrollHeight: signature.scrollHeight,
          file: relativeFile,
          sha256: digest,
          bytes: buffer.length,
          viewportTextChars: signature.textChars,
          textPreview: signature.textPreview,
          visibleHeadings: signature.visibleHeadings || [],
          dominantSection: signature.dominantSection || null,
          visibleCounts: signature.visibleCounts || {},
          repetitionHits: signature.repetitionHits || [],
          deltaFromPrevious,
          maxSimilarityToPrevious: Number(bestSimilarity.toFixed(4)),
        });
        keptSignatures.push({ set: signatureSet, file: relativeFile, signature });
        screenshotIndex += 1;
      }
    }

    const auditOpportunities = tabStats.map((stats) => ({ tab: stats.tab, items: buildAuditOpportunities(stats) }));
    const reviewQueue = buildReviewQueue({ tabs, captures, tabStats, auditOpportunities }, options.reviewPerTab);

    const manifest = {
      schemaVersion: 2,
      harness: 'bridge-dashboard-visual-qa',
      runId,
      capturedAt: new Date().toISOString(),
      url: options.url,
      headless: true,
      focusStealing: false,
      dedupe: {
        method: 'visible-text + quantized-layout Jaccard, followed by exact PNG SHA-256',
        similarityThreshold: options.similarity,
      },
      browser: {
        executable: chromePath,
        product: browserVersion.Browser,
        protocolVersion: browserVersion['Protocol-Version'],
        userAgent: browserVersion['User-Agent'],
      },
      surface: options.surface,
      viewport: options.viewport,
      reviewPerTab: options.reviewPerTab,
      tabs,
      tabStats,
      auditOpportunities,
      reviewQueue,
      captures,
      skipped,
      runtimeErrors,
      consoleMessages,
      networkFailures,
    };

    writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(runDir, 'manifest.md'), `${renderMarkdown(manifest)}\n`, 'utf8');
    writeFileSync(path.join(runDir, 'review-queue.json'), `${JSON.stringify({ schemaVersion: 1, runId, items: reviewQueue }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(runDir, 'review-queue.md'), `${renderReviewMarkdown(manifest)}\n`, 'utf8');
    writeFileSync(path.join(runDir, 'contact-sheet.html'), renderHtml(manifest, runDir), 'utf8');

    console.log(JSON.stringify({
      ok: true,
      runDir,
      url: options.url,
      tabs: tabs.map((tab) => tab.id),
      captures: captures.length,
      reviewQueue: reviewQueue.length,
      auditOpportunities: auditOpportunities.reduce((sum, entry) => sum + entry.items.length, 0),
      skippedNearDuplicates: skipped.length,
      runtimeErrors: runtimeErrors.length,
      networkFailures: networkFailures.length,
      manifest: path.join(runDir, 'manifest.json'),
      contactSheet: path.join(runDir, 'contact-sheet.html'),
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    if (chrome?.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else {
        try { chrome.kill('SIGTERM'); } catch {}
      }
    }
    try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error(`[dashboard-visual-harness] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
