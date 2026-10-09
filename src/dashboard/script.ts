export const dashboardScript = `
const numberFormat = new Intl.NumberFormat('es-AR');
const decimalFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
let refreshing = false;
let toolAuditData = null;
let activityRecentRows = [];
let activityRecentMode = 'aggregate';
let activityTimelineRows = [];
let selectedActivityBucket = '';
let workSnapshot = null;
let workRange = 'now';
let workProjectFilter = 'current';

const byId = (id) => document.getElementById(id);
const num = (value) => numberFormat.format(Number(value || 0));
const pct = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : decimalFormat.format(Number(value)) + '%';
const score = (value) => value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ms = (value) => num(Math.round(Number(value || 0))) + ' ms';
const clock = (iso) => iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const dateTime = (iso) => iso ? new Date(iso).toLocaleString('es-AR') : '—';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const exposed = (value, fallback) => value && value !== 'unknown' ? String(value) : fallback;

function toolHint(name) {
  if (name === 'work_once') return 'Alias de run_command para un comando local corto';
  return name;
}

function pendingMetric(value, pending, detail) {
  if (pending) {
    return '<span class="status-pill" data-tone="info"><span class="dot info"></span><span>pendiente</span></span>' +
      '<div class="recent-detail">' + esc(detail) + '</div>';
  }
  return pct(value);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value ?? '—');
}

function setDot(id, tone) {
  const element = byId(id);
  if (element) element.className = 'dot ' + tone;
}

function setPill(id, tone, text) {
  const element = byId(id);
  if (!element) return;
  element.dataset.tone = tone;
  const dot = element.querySelector('.dot');
  if (dot) dot.className = 'dot ' + tone;
  const spans = element.querySelectorAll('span');
  const label = spans[spans.length - 1];
  if (label) label.textContent = text;
}

function humanDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return days + ' d ' + hours + ' h';
  if (hours > 0) return hours + ' h ' + minutes + ' min';
  if (minutes > 0) return minutes + ' min';
  return Math.floor(seconds) + ' s';
}

function percentageTone(value, goodAt, warnAt) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'info';
  if (numeric >= goodAt) return 'ok';
  if (numeric >= warnAt) return 'warn';
  return 'bad';
}

function renderActivityTimelineDetail(rows) {
  const target = byId('activity-timeline-detail');
  if (!target) return;
  const selected = rows.find((row) => String(row.bucket || '') === selectedActivityBucket);
  if (!selected) {
    target.innerHTML = '<span class="muted">Seleccioná un bloque para ver sus llamadas y errores agregados.</span>';
    return;
  }
  const calls = Number(selected.calls || 0);
  const errors = Number(selected.errors || 0);
  const errorRate = calls > 0 ? (errors / calls) * 100 : 0;
  const start = new Date(selected.bucket);
  const end = new Date(start.getTime() + 5 * 60 * 1000);
  target.innerHTML = '<div class="activity-timeline-detail-grid">' +
    '<div><span class="activity-detail-label">Bloque</span><strong>' + esc(clock(start.toISOString())) + '–' + esc(clock(end.toISOString())) + '</strong></div>' +
    '<div><span class="activity-detail-label">Llamadas</span><strong>' + num(calls) + '</strong></div>' +
    '<div><span class="activity-detail-label">Errores</span><strong>' + num(errors) + '</strong></div>' +
    '<div><span class="activity-detail-label">Tasa de error</span><strong>' + decimalFormat.format(errorRate) + '%</strong></div>' +
  '</div><div class="activity-detail-note">El bloque usa la misma evidencia agregada del timeline; no implica que las últimas 20 filas Raw cubran todo ese intervalo.</div>';
}

function renderTimeline(targetId, startId, endId, inputRows) {
  const target = byId(targetId);
  if (!target) return;
  const rows = [...(inputRows || [])].sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
  const interactive = targetId === 'activity-timeline';
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">Sin actividad registrada en el período disponible.<br />El panel se completará cuando existan llamadas operativas.</div>';
    setText(startId, 'sin datos');
    setText(endId, 'sin datos');
    if (interactive) renderActivityTimelineDetail([]);
    return;
  }
  if (interactive && selectedActivityBucket && !rows.some((row) => String(row.bucket || '') === selectedActivityBucket)) selectedActivityBucket = '';
  const maxCalls = Math.max(1, ...rows.map((row) => Number(row.calls || 0)));
  target.innerHTML = rows.map((row) => {
    const calls = Number(row.calls || 0);
    const errors = Number(row.errors || 0);
    const height = 8 + (calls / maxCalls) * 136;
    const label = clock(row.bucket) + ' · ' + calls + ' llamadas · ' + errors + ' errores';
    if (interactive) {
      const bucket = String(row.bucket || '');
      const selected = bucket === selectedActivityBucket;
      return '<button type="button" class="timeline-bar timeline-bar-button" data-activity-bucket="' + esc(bucket) + '" data-errors="' + (errors > 0 ? 'true' : 'false') + '" style="--height:' + height.toFixed(1) + 'px" title="' + esc(label) + '" aria-label="' + esc(label) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"></button>';
    }
    return '<span class="timeline-bar" data-errors="' + (errors > 0 ? 'true' : 'false') + '" style="--height:' + height.toFixed(1) + 'px" title="' + esc(label) + '" aria-label="' + esc(label) + '"></span>';
  }).join('');
  setText(startId, dateTime(rows[0].bucket));
  setText(endId, dateTime(rows[rows.length - 1].bucket));
  if (interactive) renderActivityTimelineDetail(rows);
}

function renderTools(targetId, inputRows, limit) {
  const target = byId(targetId);
  if (!target) return;
  const rows = (inputRows || []).slice(0, limit);
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">Todavía no hay llamadas agregadas por tool.</div>';
    return;
  }
  const maxCalls = Math.max(1, ...rows.map((row) => Number(row.calls || 0)));
  target.innerHTML = rows.map((row) => {
    const calls = Number(row.calls || 0);
    const errors = Number(row.error_calls || 0);
    const errorRate = calls > 0 ? (errors / calls) * 100 : 0;
    const width = Math.max(3, (calls / maxCalls) * 100);
    const tone = errorRate >= 5 ? 'bad' : errorRate >= 2 ? 'warn' : '';
    return '<div class="tool-row">' +
      '<div class="tool-name"><strong>' + esc(row.tool) + '</strong><div class="tool-meta">err ' + num(errors) + ' · ' + decimalFormat.format(errorRate) + '% · avg ' + ms(row.avg_duration_ms) + '</div></div>' +
      '<div class="tool-count">' + num(calls) + '</div>' +
      '<div class="progress-track"><span class="progress-fill ' + tone + '" style="--width:' + width.toFixed(1) + '%"></span></div>' +
    '</div>';
  }).join('');
}

function renderSkillCounts(targetId, inputRows, emptyText) {
  const target = byId(targetId);
  if (!target) return;
  const rows = inputRows || [];
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">' + esc(emptyText) + '</div>';
    return;
  }
  const maxCount = Math.max(1, ...rows.map((row) => Number(row.count || 0)));
  target.innerHTML = rows.map((row) => {
    const count = Number(row.count || 0);
    const width = Math.max(3, (count / maxCount) * 100);
    return '<div class="tool-row">' +
      '<div class="tool-name"><strong>' + esc(row.name) + '</strong></div>' +
      '<div class="tool-count">' + num(count) + '</div>' +
      '<div class="progress-track"><span class="progress-fill" style="--width:' + width.toFixed(1) + '%"></span></div>' +
    '</div>';
  }).join('');
}

function recentStatus(row) {
  if (Number(row.ok) !== 1) {
    return '<span class="status-pill" data-tone="bad"><span class="dot bad"></span><span>handler error</span></span>';
  }
  if (row.result_ok !== null && row.result_ok !== undefined) {
    const passed = Number(row.result_ok) === 1;
    const tone = passed ? 'ok' : 'bad';
    const label = passed ? 'command ok' : row.result_status === 'timeout' ? 'command timeout' : 'command failed';
    return '<span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + label + '</span></span>';
  }
  return '<span class="status-pill" data-tone="ok"><span class="dot ok"></span><span>handler ok</span></span>';
}

function operationSubjectLabel(row) {
  if (!row.operation_subject) return '';
  const labels = {
    skill_load: 'skill',
    project_context_load: 'proyecto',
    skill_route_plan: 'fase',
    skill_bootstrap: 'fase',
    skill_recommend: 'fase',
    mssr_trace_record: 'evento',
    bridge_tool_query: 'tool',
    bridge_tool_action: 'tool'
  };
  return (labels[row.tool] || 'objetivo') + ': ' + row.operation_subject;
}

function renderRecent(targetId, inputRows, limit, includeDetail) {
  const target = byId(targetId);
  if (!target) return;
  const rows = (inputRows || []).slice(0, limit);
  const columns = includeDetail ? 5 : 4;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="' + columns + '" class="muted">Sin llamadas registradas.</td></tr>';
    return;
  }
  target.innerHTML = rows.map((row) => {
    const profile = [row.caller, row.model, row.reasoning_effort].filter((value) => value && value !== 'unknown').join(' · ');
    const alias = row.tool === 'work_once' ? toolHint(row.tool) : '';
    const subject = operationSubjectLabel(row);
    const summarySubject = targetId === 'summary-recent' && subject
      ? '<div class="recent-subject">' + esc(subject) + '</div>'
      : '';
    const detail = [row.error || subject || row.input_keys || '', alias, profile].filter(Boolean).join(' · ');
    return '<tr>' +
      '<td>' + esc(clock(row.started_at)) + '</td>' +
      '<td><code title="' + esc(toolHint(row.tool)) + '">' + esc(row.tool) + '</code>' + summarySubject + '</td>' +
      (includeDetail ? '<td>' + esc(ms(row.duration_ms)) + '</td><td>' + recentStatus(row) + '</td><td class="recent-detail">' + esc(detail) + '</td>' : '<td>' + recentStatus(row) + '</td><td>' + esc(ms(row.duration_ms)) + '</td>') +
    '</tr>';
  }).join('');
}

function activityCallFailed(row) {
  if (Number(row.ok) !== 1) return true;
  return row.result_ok !== null && row.result_ok !== undefined && Number(row.result_ok) !== 1;
}

function aggregateActivityCalls(inputRows) {
  const groups = new Map();
  (inputRows || []).slice(0, 20).forEach((row) => {
    const key = String(row.tool || 'unknown');
    const current = groups.get(key) || { tool: key, calls: 0, errors: 0, duration: 0, firstAt: row.started_at, lastAt: row.started_at, subjects: new Set(), profiles: new Set() };
    current.calls += 1;
    if (activityCallFailed(row)) current.errors += 1;
    current.duration += Number(row.duration_ms || 0);
    if (row.started_at && (!current.firstAt || new Date(row.started_at) < new Date(current.firstAt))) current.firstAt = row.started_at;
    if (row.started_at && (!current.lastAt || new Date(row.started_at) > new Date(current.lastAt))) current.lastAt = row.started_at;
    const subject = operationSubjectLabel(row);
    if (subject) current.subjects.add(subject);
    const profile = [row.caller, row.model, row.reasoning_effort].filter((value) => value && value !== 'unknown').join(' · ');
    if (profile) current.profiles.add(profile);
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => b.errors - a.errors || b.calls - a.calls || a.tool.localeCompare(b.tool));
}

function renderActivityRecentAggregate() {
  const target = byId('activity-recent-aggregate');
  if (!target) return;
  const groups = aggregateActivityCalls(activityRecentRows);
  if (!groups.length) {
    target.innerHTML = '<div class="empty-state">Sin llamadas registradas en la ventana reciente.</div>';
    return;
  }
  target.innerHTML = groups.map((item) => {
    const avg = item.calls ? item.duration / item.calls : 0;
    const errorRate = item.calls ? (item.errors / item.calls) * 100 : 0;
    const tone = item.errors > 0 ? (errorRate >= 20 ? 'bad' : 'warn') : 'ok';
    const subjects = [...item.subjects].slice(0, 3);
    const profiles = [...item.profiles].slice(0, 3);
    return '<details class="activity-call-group" data-tone="' + tone + '">' +
      '<summary class="activity-call-summary">' +
        '<span class="activity-call-main"><code title="' + esc(toolHint(item.tool)) + '">' + esc(item.tool) + '</code><span class="activity-call-last">última ' + esc(clock(item.lastAt)) + '</span></span>' +
        '<span class="activity-call-metrics"><strong>' + num(item.calls) + '</strong> llamadas · <strong>' + num(item.errors) + '</strong> errores · avg ' + esc(ms(avg)) + '</span>' +
      '</summary>' +
      '<div class="activity-call-detail" data-ux-layer="detail">' +
        '<div><span class="activity-detail-label">Ventana observada</span><strong>' + esc(clock(item.firstAt)) + '–' + esc(clock(item.lastAt)) + '</strong></div>' +
        '<div><span class="activity-detail-label">Éxitos</span><strong>' + num(item.calls - item.errors) + '</strong></div>' +
        '<div><span class="activity-detail-label">Tasa de error</span><strong>' + decimalFormat.format(errorRate) + '%</strong></div>' +
        '<div><span class="activity-detail-label">Perfiles observados</span><span>' + esc(profiles.length ? profiles.join(' · ') : 'sin perfil expuesto') + '</span></div>' +
        (subjects.length ? '<div class="activity-call-subjects"><span class="activity-detail-label">Objetivos recientes</span><span>' + esc(subjects.join(' · ')) + '</span></div>' : '') +
      '</div>' +
    '</details>';
  }).join('');
}

function syncActivityRecentMode() {
  const aggregate = byId('activity-recent-aggregate');
  const raw = byId('activity-recent-raw');
  if (aggregate) aggregate.hidden = activityRecentMode !== 'aggregate';
  if (raw) raw.hidden = activityRecentMode !== 'raw';
  document.querySelectorAll('[data-activity-mode]').forEach((button) => {
    const active = button.dataset.activityMode === activityRecentMode;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderActivityRecent() {
  renderActivityRecentAggregate();
  renderRecent('activity-recent', activityRecentRows, 20, true);
  syncActivityRecentMode();
}

function renderAgentProfiles(inputRows) {
  const target = byId('agent-profiles');
  if (!target) return;
  const rows = inputRows || [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="9" class="muted">Sin llamadas en la época activa.</td></tr>';
    return;
  }
  const sessions = new Set(rows.map((row) => row.session_key).filter((value) => value && value !== 'unknown'));
  const tasks = new Set(rows.map((row) => row.task_key).filter((value) => value && value !== 'unknown'));
  setText('agent-profile-summary', num(tasks.size) + ' tareas observables · ' + num(sessions.size) + ' sesiones anónimas · ' + num(rows.length) + ' agrupaciones. Una agrupación no equivale a un agente.');
  target.innerHTML = rows.map((row) => '<tr>' +
    '<td><code>' + esc(exposed(row.caller, 'cliente no identificado')) + '</code><div class="recent-detail">' +
      esc(row.host_agent && row.host_agent !== 'unknown' ? 'agente ' + row.host_agent : 'agente no expuesto') + '</div></td>' +
    '<td>' + esc(exposed(row.model, 'modelo no expuesto')) + '</td>' +
    '<td>' + esc(exposed(row.reasoning_effort, 'esfuerzo no expuesto')) + '<div class="recent-detail">' +
      esc(row.host_variant && row.host_variant !== 'unknown' ? 'variante ' + row.host_variant : 'variante no expuesta') + '</div></td>' +
    '<td><code>' + esc(exposed(row.task_key, 'tarea no identificada')) + '</code><div class="recent-detail" title="' + esc(row.session_key || 'unknown') + '">' +
      esc(row.session_key && row.session_key !== 'unknown' ? 'sesión ' + String(row.session_key).slice(-10) : 'sesión no expuesta') + '</div></td>' +
    '<td><code>' + esc(exposed(row.project, 'proyecto primario no expuesto')) + '</code><div class="recent-detail">' +
      esc(row.related_project && row.related_project !== 'none' ? 'relacionados: ' + row.related_project : 'sin repositorio auxiliar') + '</div></td>' +
    '<td>' + num(row.calls) + '</td>' +
    '<td title="' + esc(num(row.routed_chains) + ' / ' + num(row.substantive_chains) + ' cadenas sustantivas con route/bootstrap/hook; ' + num(row.traced_calls) + ' / ' + num(row.eligible_calls) + ' llamadas con traza') + '">' +
      pct(row.mssr_routed_chain_coverage) + '<div class="recent-detail">' + num(row.unrouted_chains) + ' sin route/hook · ' + num(row.exempt_calls) + ' exentas</div></td>' +
    '<td>' + num(row.error_calls) + '</td>' +
    '<td>' + ms(row.avg_duration_ms) + '</td>' +
  '</tr>').join('');
}

function compactErrorMessage(value) {
  const text = String(value || 'Error sin detalle').replace(/\\s+/g, ' ').trim();
  return text.length > 150 ? text.slice(0, 147) + '…' : text;
}

function renderErrors(inputRows) {
  const target = byId('error-list');
  if (!target) return;
  const rows = inputRows || [];
  setPill('recent-errors-count', rows.length ? 'warn' : 'ok', rows.length ? rows.length + ' recientes' : 'sin errores');
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">Sin errores registrados en la consulta actual.</div>';
    return;
  }
  target.innerHTML = rows.map((row) => {
    const raw = String(row.error || 'Error sin detalle');
    const profile = [row.caller || 'other', row.model || 'unknown', row.reasoning_effort || 'unknown'].join(' · ');
    return '<details class="error-item" data-ux-layer="detail">' +
      '<summary class="error-summary">' +
        '<span class="error-time">' + esc(clock(row.started_at)) + '</span>' +
        '<span class="error-tool">' + esc(row.tool) + '</span>' +
        '<span class="error-message">' + esc(compactErrorMessage(raw)) + '</span>' +
        '<span class="error-duration">' + esc(ms(row.duration_ms)) + '</span>' +
      '</summary>' +
      '<div class="error-detail" data-ux-layer="raw"><div class="muted">' + esc(profile) + '</div><pre>' + esc(raw) + '</pre></div>' +
    '</details>';
  }).join('');
}

function renderAttention(benchmark) {
  const target = byId('attention-list');
  const card = byId('attention-card');
  if (!target || !card) return;
  const items = [];
  const required = Number(benchmark.requiredLoadCompliance);
  const continuity = Number(benchmark.correlatedRouteLoadCoverage);
  const structured = Number(benchmark.structuredRouteRate);
  const outcomeCoverage = Number(benchmark.outcomeCoverage);

  if (Number.isFinite(required) && required < 80) {
    items.push({ tone: required < 50 ? 'bad' : 'warn', title: 'Skills requeridas cargadas', detail: num(benchmark.requiredSkillLoadsSatisfied) + ' de ' + num(benchmark.requiredSkillLoadsExpected) + ' cargas requeridas fueron satisfechas.', value: pct(required) });
  }
  if (Number.isFinite(continuity) && continuity < 90) {
    items.push({ tone: continuity < 70 ? 'bad' : 'warn', title: 'Continuidad route → load', detail: num(benchmark.orphanLoadEvents) + ' cargas huérfanas dentro de la época activa.', value: pct(continuity) });
  }
  if (Number.isFinite(structured) && structured < 90) {
    items.push({ tone: structured < 70 ? 'bad' : 'warn', title: 'Routing semántico', detail: num(benchmark.lexicalFallbackRoutes) + ' rutas usaron fallback léxico.', value: pct(structured) });
  }
  if (Number.isFinite(outcomeCoverage) && outcomeCoverage < 70) {
    items.push({ tone: outcomeCoverage < 40 ? 'bad' : 'warn', title: 'Cierre con outcome', detail: num(benchmark.outcomeTraces) + ' trazas registraron outcome sobre ' + num(benchmark.tracesWithRoute) + ' trazas con ruta.', value: pct(outcomeCoverage) });
  }

  if (!items.length) {
    card.dataset.state = 'ok';
    setPill('attention-count', 'ok', 'sin alertas');
    target.innerHTML = '<div class="attention-empty">No se detectaron métricas por debajo de los umbrales de revisión de este panel.</div>';
    return;
  }

  card.dataset.state = 'warn';
  const worstTone = items.some((item) => item.tone === 'bad') ? 'bad' : 'warn';
  setPill('attention-count', worstTone, items.length + (items.length === 1 ? ' punto' : ' puntos'));
  target.innerHTML = items.map((item) => '<div class="attention-item" data-tone="' + item.tone + '">' +
    '<span class="dot ' + item.tone + '"></span>' +
    '<div class="attention-main"><div class="attention-title">' + esc(item.title) + '</div><div class="attention-detail">' + esc(item.detail) + '</div></div>' +
    '<div class="attention-value">' + esc(item.value) + '</div>' +
  '</div>').join('');
}

function progressRow(label, description, value, goodAt, warnAt) {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
  const tone = percentageTone(numeric, goodAt, warnAt);
  return '<div class="mssr-row">' +
    '<div class="mssr-label"><strong>' + esc(label) + '</strong><span>' + esc(description) + '</span></div>' +
    '<div class="progress-track"><span class="progress-fill ' + tone + '" style="--width:' + normalized.toFixed(1) + '%"></span></div>' +
    '<div class="mssr-value">' + esc(pct(value)) + '</div>' +
  '</div>';
}

function renderMssrProgress(benchmark) {
  const target = byId('mssr-progress');
  if (!target) return;
  target.innerHTML = [
    progressRow('Routing estructurado', 'Rutas clasificadas mediante intent semántico, sin fallback léxico.', benchmark.structuredRouteRate, 95, 80),
    progressRow('Route → load', 'Trazas con carga de skills correlacionada con su ruta.', benchmark.correlatedRouteLoadCoverage, 95, 80),
    progressRow('Skills requeridas', 'Cargas obligatorias satisfechas respecto de las esperadas.', benchmark.requiredLoadCompliance, 95, 75),
    progressRow('Verificación', 'Trazas enrutadas que registraron checkpoint de verificación.', benchmark.verificationCoverage, 80, 50),
    progressRow('Persistencia', 'Trazas enrutadas que registraron persistencia.', benchmark.persistenceCoverage, 75, 40),
    progressRow('Outcome', 'Trazas enrutadas cerradas con outcome observable.', benchmark.outcomeCoverage, 85, 60),
    progressRow('Éxito del outcome', 'Outcomes atribuidos con estado success.', benchmark.outcomeSuccessRate, 90, 75),
    progressRow('Aceptación medida', 'Outcomes medidos que fueron aceptados.', benchmark.outcomeAcceptanceRate, 90, 75)
  ].join('');
}
function renderSkillHealth(report) {
  const target = byId('mssr-skill-health');
  const latest = report && report.latest ? report.latest : null;
  setText('mssr-skill-health-snapshots', report ? num(report.snapshotCount) : '—');
  if (!latest) {
    setPill('mssr-skill-health-status', 'info', 'sin snapshot');
    setText('mssr-skill-health-owned', '—');
    setText('mssr-skill-health-manifests', '—');
    setText('mssr-skill-health-watch', '—');
    setText('mssr-skill-health-review', '—');
    if (target) target.innerHTML = '<tr><td colspan="6" class="muted">El scheduler todavía no guardó un snapshot estructural.</td></tr>';
    return;
  }
  const counts = latest.counts || {};
  const watch = Number(counts.ownedStructuralWatch || 0);
  const review = Number(counts.ownedStructuralReview || 0);
  setText('mssr-skill-health-owned', num(counts.ownedSkills));
  setText('mssr-skill-health-manifests', num(counts.ownedWithContextManifest));
  setText('mssr-skill-health-watch', num(watch));
  setText('mssr-skill-health-review', num(review));
  setPill('mssr-skill-health-status', review > 0 ? 'bad' : watch > 0 ? 'warn' : 'ok', review > 0 ? review + ' REVIEW' : watch > 0 ? watch + ' WATCH' : 'sin deuda estructural');
  if (!target) return;
  const rows = Array.isArray(latest.skills) ? latest.skills.filter((item) => item.status !== 'ok') : [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="6" class="muted">Todas las skills owned están OK en el último snapshot.</td></tr>';
    return;
  }
  target.innerHTML = rows.slice(0, 30).map((item) => {
    const tone = item.status === 'review' ? 'bad' : 'warn';
    const recipes = num(item.referenceFiles) + ' refs · ' + num(item.contextModuleCount) + ' módulos';
    const delta = item.deltaChars === null || item.deltaChars === undefined ? '—' : (Number(item.deltaChars) > 0 ? '+' : '') + num(item.deltaChars);
    const reasons = (item.reasonCodes || []).join(', ') || item.recommendation || '—';
    return '<tr>' +
      '<td><code>' + esc(item.name || '—') + '</code></td>' +
      '<td><span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(String(item.status || '').toUpperCase()) + '</span></span></td>' +
      '<td>' + num(item.lines) + ' líneas · ' + num(item.chars) + ' chars</td>' +
      '<td>' + esc(recipes) + '</td>' +
      '<td>' + esc(delta) + '</td>' +
      '<td class="recent-detail"><code>' + esc(reasons) + '</code><div>' + esc(item.recommendation || '') + '</div></td>' +
    '</tr>';
  }).join('');
}
function renderProjectHealth(report) {
  const target = byId('mssr-project-health');
  const latest = report && report.latest ? report.latest : null;
  setText('mssr-project-health-snapshots', report ? num(report.snapshotCount) : '—');
  if (!latest) {
    setPill('mssr-project-health-status', 'info', 'sin snapshot');
    setText('mssr-project-health-projects', '—');
    setText('mssr-project-health-initialized', '—');
    setText('mssr-project-health-ok', '—');
    setText('mssr-project-health-watch', '—');
    setText('mssr-project-health-review', '—');
    if (target) target.innerHTML = '<tr><td colspan="5" class="muted">El scheduler todavía no guardó un snapshot de Project Context Health.</td></tr>';
    return;
  }
  const counts = latest.counts || {};
  const watch = Number(counts.watch || 0);
  const review = Number(counts.review || 0);
  setText('mssr-project-health-projects', num(counts.projects));
  setText('mssr-project-health-initialized', num(counts.initialized));
  setText('mssr-project-health-ok', num(counts.ok));
  setText('mssr-project-health-watch', num(watch));
  setText('mssr-project-health-review', num(review));
  setPill('mssr-project-health-status', review > 0 ? 'bad' : watch > 0 ? 'warn' : 'ok', review > 0 ? review + ' REVIEW' : watch > 0 ? watch + ' WATCH' : 'workspace sano');
  if (!target) return;
  const rows = Array.isArray(latest.projects) ? latest.projects.filter((item) => item.level !== 'ok') : [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="5" class="muted">Todos los proyectos administrados están OK.</td></tr>';
    return;
  }
  target.innerHTML = rows.slice(0, 30).map((item) => {
    const tone = item.level === 'review' ? 'bad' : 'warn';
    const delta = item.deltaFindings === null || item.deltaFindings === undefined ? '—' : (Number(item.deltaFindings) > 0 ? '+' : '') + num(item.deltaFindings);
    const reasons = (item.findingCodes || []).join(', ') || '—';
    return '<tr>' +
      '<td><code>' + esc(item.relativeRoot || item.name || '—') + '</code></td>' +
      '<td><span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(String(item.level || '').toUpperCase()) + '</span></span></td>' +
      '<td>' + num(item.coreEntries) + ' core · ' + num(item.modules) + ' módulos</td>' +
      '<td>' + esc(delta) + '</td>' +
      '<td class="recent-detail"><code>' + esc(reasons) + '</code><div>' + esc(item.level === 'review' ? 'usar planner / maintenance' : 'revisar en mantenimiento') + '</div></td>' +
    '</tr>';
  }).join('');
}

function renderRuntimeHealth(report) {
  const latest = report && report.latest ? report.latest : null;
  setText('mssr-runtime-health-history', report && Array.isArray(report.snapshots) ? num(report.snapshots.length) : '—');
  if (!latest) {
    setPill('mssr-runtime-health-status', 'info', 'sin snapshot');
    setText('mssr-runtime-health-tunnel', '—');
    setText('mssr-runtime-health-runtime', '—');
    setText('mssr-runtime-health-restart', '—');
    setText('mssr-runtime-health-detail', 'Sin evidencia persistida todavía.');
    return;
  }
  const level = String((latest.projection && latest.projection.level) || 'ok');
  const tone = level === 'error' ? 'bad' : level === 'review' ? 'warn' : level === 'watch' ? 'info' : 'ok';
  setPill('mssr-runtime-health-status', tone, level.toUpperCase());
  setText('mssr-runtime-health-tunnel', String((latest.tunnel && latest.tunnel.state) || 'unknown').toUpperCase());
  setText('mssr-runtime-health-runtime', String((latest.runtime && latest.runtime.continuity) || 'unknown').toUpperCase());
  setText('mssr-runtime-health-restart', String((latest.restart && latest.restart.state) || 'unknown').toUpperCase());
  const reasons = latest.projection && Array.isArray(latest.projection.reasonCodes) ? latest.projection.reasonCodes.join(', ') : '';
  const version = latest.runtime && latest.runtime.version ? 'Bridge ' + latest.runtime.version : 'Bridge';
  const observed = latest.observedAt ? dateTime(latest.observedAt) : '—';
  setText('mssr-runtime-health-detail', version + ' · ' + observed + (reasons ? ' · ' + reasons : ' · sin señales de atención') + ' · transport observado externamente');
}


function renderSkillOutcomes(inputRows) {
  const target = byId('mssr-skill-outcomes');
  if (!target) return;
  const rows = inputRows || [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="6" class="muted">Todavía no hay outcomes atribuidos en la época activa.</td></tr>';
    return;
  }
  target.innerHTML = rows.map((row) => '<tr>' +
    '<td><code title="' + esc(row.name) + '">' + esc(row.name) + '</code></td>' +
    '<td>' + num(row.outcomes) + '</td>' +
    '<td>' + pct(row.successRate) + '</td>' +
    '<td>' + pct(row.acceptanceRate) + '</td>' +
    '<td>' + score(row.averageScore) + '</td>' +
    '<td class="recent-detail">' + num(row.success) + ' ok · ' + num(row.partial) + ' parcial · ' + num(row.failed) + ' fallo</td>' +
  '</tr>').join('');
}
function renderSkillSelectionFeedback(inputRows) {
  const target = byId('mssr-selection-feedback');
  if (!target) return;
  const rows = Array.isArray(inputRows) ? inputRows : [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="6" class="muted">Todavía no hay decisiones host-gated observables en este scope.</td></tr>';
    return;
  }
  target.innerHTML = rows
    .slice()
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0) || String(a.skillName || '').localeCompare(String(b.skillName || '')))
    .slice(0, 30)
    .map((row) => {
      const reasons = Object.entries(row.reasonCounts || {})
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0])))
        .slice(0, 3)
        .map(([reason, count]) => esc(reason) + ' (' + num(count) + ')')
        .join(' · ') || '—';
      return '<tr>' +
        '<td><code title="' + esc(row.skillName || '') + '">' + esc(row.skillName || '—') + '</code></td>' +
        '<td>' + num(row.accepted) + '</td>' +
        '<td>' + num(row.skipped) + '</td>' +
        '<td>' + pct(row.acceptanceRate === null || row.acceptanceRate === undefined ? null : Number(row.acceptanceRate) * 100) + '</td>' +
        '<td class="recent-detail">' + reasons + '</td>' +
        '<td title="Firmas semánticas observadas">' + num((row.signatures || []).length) + '</td>' +
      '</tr>';
    }).join('');
}

function renderMssrLearningPriors(learning) {
  const target = byId('mssr-learning-priors');
  if (!target) return;
  const rows = learning && Array.isArray(learning.skillPriors) ? learning.skillPriors : [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="7" class="muted">Todavía no hay learning digests suficientes para mostrar priors.</td></tr>';
    return;
  }
  target.innerHTML = rows
    .slice()
    .sort((a, b) => Number(b.eligible || 0) - Number(a.eligible || 0) || Number(b.evidenceCount || 0) - Number(a.evidenceCount || 0) || String(a.skillName || '').localeCompare(String(b.skillName || '')))
    .slice(0, 40)
    .map((row) => '<tr>' +
      '<td><code>' + esc(row.skillName || '—') + '</code></td>' +
      '<td>' + num(row.evidenceCount) + (row.eligible ? '' : ' <span class="muted">/ ' + num(learning.minEvidence) + '</span>') + '</td>' +
      '<td>' + pct(row.acceptanceRate === null || row.acceptanceRate === undefined ? null : Number(row.acceptanceRate) * 100) + '</td>' +
      '<td>' + pct(row.activationRate === null || row.activationRate === undefined ? null : Number(row.activationRate) * 100) + '</td>' +
      '<td>' + pct(row.successRateWhenLoaded === null || row.successRateWhenLoaded === undefined ? null : Number(row.successRateWhenLoaded) * 100) + '</td>' +
      '<td><code>' + esc(row.recommendation || '—') + '</code></td>' +
      '<td class="recent-detail" title="' + esc(row.semanticSignature || '') + '"><code>' + esc(String(row.semanticSignature || '').slice(0, 110)) + (String(row.semanticSignature || '').length > 110 ? '…' : '') + '</code></td>' +
    '</tr>').join('');
}


function profileIdentity(row) {
  const agent = row.hostAgent && row.hostAgent !== 'unknown'
    ? 'agente ' + row.hostAgent
    : row.identitySource === 'lifecycle-only'
      ? 'agente no expuesto por lifecycle'
      : 'agente no expuesto';
  const variant = row.hostVariant && row.hostVariant !== 'unknown'
    ? ' · variante ' + row.hostVariant
    : '';
  const observedSessions = Number(row.observedSessionCount || 0);
  const observedParents = Number(row.observedParentSessionCount || 0);
  const source = row.identitySource === 'trace-correlated-host'
    ? 'host correlacionado por traceId'
    : row.identitySource === 'trace-host-mixed'
      ? 'host múltiple observado'
      : 'sólo lifecycle';
  return '<code>' + esc(exposed(row.caller, 'cliente no identificado')) + '</code><div class="recent-detail">' +
    esc(agent + ' · ' + exposed(row.model, 'modelo no expuesto') + ' · ' + exposed(row.reasoningEffort, 'esfuerzo no expuesto') + variant) + '</div><div class="recent-detail">' +
    esc(source
      + (observedSessions ? ' · ' + observedSessions + ' sesión(es) anónima(s)' : '')
      + (observedParents ? ' · ' + observedParents + ' padre(s) expuesto(s)' : '')) + '</div>';
}

function renderMssrAgentProfiles(inputRows) {
  const activation = byId('mssr-agent-activation');
  const results = byId('mssr-agent-results');
  const transport = byId('mssr-agent-transport');
  const rows = inputRows || [];
  if (activation) {
    activation.innerHTML = rows.length ? rows.map((row) => {
      const open = Number(row.routedTraces || 0) > Number(row.outcomeTraces || 0);
      return '<tr>' +
        '<td>' + profileIdentity(row) + '</td>' +
        '<td>' + num(row.routedTraces) + '</td>' +
        '<td>' + pct(row.structuredRouteRate) + '</td>' +
        '<td>' + pct(row.routeLoadCoverage) + '</td>' +
        '<td title="' + esc(num(row.requiredSkillLoadsSatisfied) + ' / ' + num(row.requiredSkillLoadsExpected)) + '">' + pct(row.requiredLoadCompliance) + '</td>' +
        '<td>' + pendingMetric(row.verificationCoverage, open && Number(row.verificationCoverage || 0) === 0, 'tarea todavía abierta') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="6" class="muted">Sin perfiles MSSR en la época activa.</td></tr>';
  }
  if (results) {
    results.innerHTML = rows.length ? rows.map((row) => {
      const open = Number(row.routedTraces || 0) > Number(row.outcomeTraces || 0);
      const outcomeDetail = num(row.outcomeTraces) + ' / ' + num(row.routedTraces) + ' outcomes';
      return '<tr>' +
        '<td>' + profileIdentity(row) + '</td>' +
        '<td>' + pendingMetric(row.outcomeCoverage, open && Number(row.outcomeTraces || 0) === 0, outcomeDetail) + '</td>' +
        '<td>' + pct(row.outcomeSuccessRate) + '</td>' +
        '<td>' + pct(row.outcomeAcceptanceRate) + '</td>' +
        '<td>' + score(row.averageOutcomeScore) + '</td>' +
        '<td>' + (row.averageCompletionMs === null || row.averageCompletionMs === undefined ? '—' : ms(row.averageCompletionMs)) + '</td>' +
        '<td>' + num(row.closureReminderEvents) + ' / ' + num(row.userCorrections) + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="7" class="muted">Sin outcomes por perfil en la época activa.</td></tr>';
  }
  if (transport) {
    transport.innerHTML = rows.length ? rows.map((row) => '<tr>' +
      '<td>' + profileIdentity(row) + '</td>' +
      '<td>' + num(row.bridgeDirectToolCalls ?? row.directToolCalls) + '</td>' +
      '<td>' + num(row.hostObservedToolCalls) + '</td>' +
      '<td>' + num(row.delegatedQueryCalls) + '</td>' +
      '<td>' + num(row.delegatedActionCalls) + '</td>' +
      '<td>' + pct(row.delegatedCallRate) + '</td>' +
      '<td title="' + esc(num(row.discoveryDetours) + ' desvíos totales') + '">' + (row.averageDiscoveryDetours === null || row.averageDiscoveryDetours === undefined ? '—' : decimalFormat.format(Number(row.averageDiscoveryDetours))) + '</td>' +
      '<td>' + (row.averageFirstActionMs === null || row.averageFirstActionMs === undefined ? '—' : ms(row.averageFirstActionMs)) + '</td>' +
      '<td>' + (row.averageToolSpanMs === null || row.averageToolSpanMs === undefined ? '—' : ms(row.averageToolSpanMs)) + '</td>' +
      '<td title="' + esc(row.averageReminderIdleMs === null || row.averageReminderIdleMs === undefined ? 'sin recordatorios' : 'idle medio ' + ms(row.averageReminderIdleMs)) + '">' + num(row.closureReminderEvents) + '</td>' +
    '</tr>').join('') : '<tr><td colspan="10" class="muted">Sin rutas MSSR observables en la época activa.</td></tr>';
  }
}

function auditStatusLabel(status) {
  return ({
    protect: 'proteger',
    maintain: 'mantener',
    clarify: 'aclarar alias',
    'no-evidence': 'sin evidencia',
    'fix-ux-schema': 'mejorar schema/UX',
    'prefer-dedicated': 'preferir dedicada',
    'deprecation-candidate': 'revisar deprecación',
    repair: 'reparar'
  })[status] || status || '—';
}

function auditTone(status) {
  if (status === 'repair' || status === 'fix-ux-schema') return 'bad';
  if (status === 'prefer-dedicated' || status === 'deprecation-candidate' || status === 'clarify') return 'warn';
  if (status === 'no-evidence') return 'info';
  return 'ok';
}

function portfolioBadge(text, tone) {
  return '<span class="portfolio-badge" data-tone="' + esc(tone || 'info') + '">' + esc(text) + '</span>';
}

function setPortfolioSelectOptions(id, values, formatter) {
  const select = byId(id);
  if (!select) return;
  const current = select.value;
  const options = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  select.innerHTML = '<option value="">Todos</option>' + options.map((value) => '<option value="' + esc(value) + '">' + esc(formatter ? formatter(value) : value) + '</option>').join('');
  if (options.includes(current)) select.value = current;
}

function toolPortfolioGroup(item) {
  if (item.status === 'no-evidence') return 'no-evidence';
  if (['repair', 'fix-ux-schema', 'prefer-dedicated', 'deprecation-candidate', 'clarify'].includes(item.status)) return 'attention';
  return 'healthy';
}

function toolPortfolioGroupMeta(group) {
  return ({
    attention: { label: 'Requiere atención', note: 'Excepciones y decisiones pendientes', tone: 'warn' },
    'no-evidence': { label: 'Sin evidencia', note: 'Requieren observación o smoke test antes de decidir', tone: 'info' },
    healthy: { label: 'Sano con evidencia', note: 'Contratos sin señal actual de cambio', tone: 'ok' }
  })[group];
}

function renderToolPortfolioRows() {
  const target = byId('tools-portfolio-body');
  if (!target) return;
  const source = toolAuditData && Array.isArray(toolAuditData.items) ? toolAuditData.items : [];
  const query = String(byId('tools-search')?.value || '').trim().toLowerCase();
  const family = String(byId('tools-family')?.value || '');
  const role = String(byId('tools-role')?.value || '');
  const status = String(byId('tools-status')?.value || '');
  const lifecycle = String(byId('tools-lifecycle')?.value || '');
  const filtersActive = Boolean(query || family || role || status || lifecycle);
  const rows = source.filter((item) => {
    const metadata = item.metadata || {};
    if (family && metadata.family !== family) return false;
    if (role && metadata.role !== role) return false;
    if (status && item.status !== status) return false;
    if (lifecycle && metadata.lifecycle !== lifecycle) return false;
    if (!query) return true;
    const haystack = [item.tool, item.description, item.recommendation, item.reason, metadata.family, metadata.role, metadata.aliasOf, metadata.preferredTool].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });

  setPill('tools-result-count', rows.length ? 'info' : 'warn', num(rows.length) + ' de ' + num(source.length));
  if (!rows.length) {
    target.innerHTML = '<div class="notice-empty portfolio-empty">Ninguna tool coincide con los filtros actuales.</div>';
    return;
  }

  const buckets = ['attention', 'no-evidence', 'healthy'].map((key) => ({
    key,
    meta: toolPortfolioGroupMeta(key),
    items: rows.filter((item) => toolPortfolioGroup(item) === key)
  })).filter((bucket) => bucket.items.length);

  target.innerHTML = buckets.map((bucket) => {
    const groupOpen = filtersActive || bucket.key === 'attention' ? ' open' : '';
    const itemsMarkup = bucket.items.map((item) => {
      const metadata = item.metadata || {};
      const evidence = item.evidence || {};
      const alias = metadata.aliasOf ? '<div class="portfolio-subline">alias de <code>' + esc(metadata.aliasOf) + '</code></div>' : '';
      const preferred = metadata.preferredTool && metadata.preferredTool !== metadata.aliasOf ? '<div class="portfolio-subline">preferida: <code>' + esc(metadata.preferredTool) + '</code></div>' : '';
      const contractBadges = [
        portfolioBadge(metadata.family || 'sin familia', 'info'),
        portfolioBadge(metadata.role || 'dedicated', metadata.role === 'fallback' ? 'warn' : metadata.role === 'alias' ? 'info' : 'ok'),
        portfolioBadge(metadata.lifecycle || 'stable', metadata.lifecycle === 'protected' ? 'ok' : metadata.lifecycle === 'deprecated' ? 'bad' : 'info'),
        portfolioBadge(item.risk || 'neutral', item.risk === 'destructive' ? 'warn' : item.risk === 'read-only' ? 'ok' : 'info')
      ].join('');
      const errorCategories = (evidence.errorCategories || []).map((entry) => entry.name + ' ' + num(entry.count)).join(' · ');
      const duration = evidence.avgDurationMs === null || evidence.avgDurationMs === undefined ? '—' : ms(evidence.avgDurationMs);
      const lastEvidence = evidence.lastSuccessAt
        ? 'último ok ' + dateTime(evidence.lastSuccessAt)
        : evidence.lastErrorAt
          ? 'último error ' + dateTime(evidence.lastErrorAt)
          : 'sin ejecución observada';
      const errorTone = Number(evidence.errorCalls || 0) > 0 ? 'warn' : Number(evidence.calls || 0) > 0 ? 'ok' : 'info';
      return '<details class="portfolio-item" data-status="' + esc(item.status || '') + '" data-ux-layer="detail">' +
        '<summary class="portfolio-item-summary">' +
          '<span class="portfolio-item-identity"><code title="' + esc(item.tool) + '">' + esc(item.tool) + '</code><span>' + esc(metadata.family || 'sin familia') + '</span></span>' +
          '<span class="portfolio-item-metrics"><strong>' + num(evidence.calls) + '</strong><span>llamadas</span><strong data-tone="' + errorTone + '">' + num(evidence.errorCalls) + '</strong><span>errores</span><span class="portfolio-item-latency">avg ' + esc(duration) + '</span></span>' +
          portfolioBadge(auditStatusLabel(item.status), auditTone(item.status)) +
        '</summary>' +
        '<div class="portfolio-item-detail">' +
          '<div class="portfolio-detail-block"><div class="portfolio-detail-label">Descripción</div><div class="portfolio-description">' + esc(item.description || 'Sin descripción registrada.') + '</div>' + alias + preferred + '</div>' +
          '<div class="portfolio-detail-block"><div class="portfolio-detail-label">Contrato</div><div class="portfolio-badges">' + contractBadges + '</div><div class="portfolio-subline">confianza ' + esc(item.confidence || '—') + '</div></div>' +
          '<div class="portfolio-detail-block"><div class="portfolio-detail-label">Evidencia</div><strong>' + num(evidence.calls) + ' llamadas · ' + pct(evidence.successRate) + ' éxito</strong><div class="portfolio-subline">' + num(evidence.errorCalls) + ' errores · avg ' + esc(duration) + ' · ' + num(evidence.uniqueSessions) + ' sesiones · ' + num(evidence.uniqueProjects) + ' proyectos</div><div class="portfolio-subline">' + esc(lastEvidence) + '</div>' + (errorCategories ? '<div class="portfolio-errors">' + esc(errorCategories) + '</div>' : '') + '</div>' +
          '<div class="portfolio-detail-block portfolio-detail-recommendation"><div class="portfolio-detail-label">Recomendación</div><div class="portfolio-recommendation">' + esc(item.recommendation || 'Sin recomendación adicional.') + '</div><div class="portfolio-reason">' + esc(item.reason || '') + '</div></div>' +
        '</div>' +
      '</details>';
    }).join('');
    return '<details class="portfolio-group" data-group="' + bucket.key + '" data-tone="' + bucket.meta.tone + '" data-ux-layer="aggregate"' + groupOpen + '>' +
      '<summary class="portfolio-group-summary"><span><strong>' + esc(bucket.meta.label) + '</strong><small>' + esc(bucket.meta.note) + '</small></span><span class="portfolio-group-count">' + num(bucket.items.length) + '</span></summary>' +
      '<div class="portfolio-group-items">' + itemsMarkup + '</div>' +
    '</details>';
  }).join('');
}

function noticeSeverityRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function groupToolNotices(items) {
  const groups = new Map();
  items.forEach((item) => {
    const code = item.code || 'bridge-notice';
    const source = item.source || 'bridge';
    const key = code + '||' + source;
    const existing = groups.get(key) || { code, source, severity: item.severity || 'info', updatedAt: item.updatedAt, occurrences: 0, items: [], actions: new Map() };
    existing.items.push(item);
    existing.occurrences += Math.max(1, Number(item.occurrences || 1));
    if (noticeSeverityRank(item.severity) > noticeSeverityRank(existing.severity)) existing.severity = item.severity;
    if (!existing.updatedAt || (item.updatedAt && new Date(item.updatedAt).getTime() > new Date(existing.updatedAt).getTime())) existing.updatedAt = item.updatedAt;
    (Array.isArray(item.actions) ? item.actions : []).forEach((action) => {
      const actionKey = [action.label, action.toolName, action.instruction].filter(Boolean).join('|');
      if (actionKey && !existing.actions.has(actionKey)) existing.actions.set(actionKey, action);
    });
    groups.set(key, existing);
  });
  const result = [...groups.values()];
  result.forEach((group) => group.items.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()));
  return result.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

function renderNoticeAction(action) {
  return '<div class="notice-action"><strong>' + esc(action.label || action.toolName || 'Siguiente paso') + '</strong>' + (action.toolName ? '<code>' + esc(action.toolName) + '</code>' : '') + (action.instruction ? '<span>' + esc(action.instruction) + '</span>' : '') + '</div>';
}

function renderRawNotice(item) {
  const actions = Array.isArray(item.actions) ? item.actions : [];
  return '<article class="notice-item notice-raw-item" data-tone="' + esc(item.severity || 'info') + '">' +
    '<div class="notice-item-head"><div><code>' + esc(item.code || 'bridge-notice') + '</code><span>' + esc(item.source || 'bridge') + '</span></div><time>' + esc(dateTime(item.updatedAt)) + '</time></div>' +
    '<div class="notice-message">' + esc(item.message || '') + '</div>' +
    (Number(item.occurrences || 0) > 1 ? '<div class="notice-occurrences">' + num(item.occurrences) + ' ocurrencias en este evento</div>' : '') +
    (actions.length ? '<div class="notice-actions">' + actions.map(renderNoticeAction).join('') + '</div>' : '') +
  '</article>';
}

function updateToolNotices(payload) {
  const target = byId('tools-notices');
  if (!target) return;
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    setPill('tools-notice-count', 'ok', 'sin avisos');
    target.innerHTML = '<div class="notice-empty">No hay recordatorios recientes. Los avisos entregados al agente aparecerán aquí durante 24 horas.</div>';
    return;
  }

  const visibleItems = items.slice(0, 12);
  const groups = groupToolNotices(visibleItems);
  const totalOccurrences = groups.reduce((total, group) => total + group.occurrences, 0);
  const hasError = groups.some((group) => group.severity === 'error');
  setPill('tools-notice-count', hasError ? 'bad' : 'warn', num(groups.length) + ' grupos · ' + num(totalOccurrences) + ' ocurrencias');
  target.innerHTML = groups.map((group) => {
    const latest = group.items[0] || {};
    const actions = [...group.actions.values()];
    const open = group.severity === 'error' ? ' open' : '';
    return '<details class="notice-group" data-tone="' + esc(group.severity) + '" data-ux-layer="aggregate"' + open + '>' +
      '<summary class="notice-group-summary"><span class="notice-group-main"><code>' + esc(group.code) + '</code><span class="notice-group-message">' + esc(latest.message || '') + '</span></span><span class="notice-group-meta"><strong>' + num(group.occurrences) + '</strong><span>ocurrencias</span><time>' + esc(dateTime(group.updatedAt)) + '</time></span></summary>' +
      '<div class="notice-group-detail" data-ux-layer="detail">' +
        '<div class="notice-group-source">Fuente <code>' + esc(group.source) + '</code> · ' + num(group.items.length) + ' eventos visibles en la ventana</div>' +
        '<div class="notice-message">' + esc(latest.message || '') + '</div>' +
        (actions.length ? '<div class="notice-actions">' + actions.map(renderNoticeAction).join('') + '</div>' : '') +
        '<details class="notice-raw" data-ux-layer="raw"><summary>Eventos raw (' + num(group.items.length) + ')</summary><div class="notice-raw-list">' + group.items.map(renderRawNotice).join('') + '</div></details>' +
      '</div>' +
    '</details>';
  }).join('');
}

function updateToolPortfolio(audit) {
  toolAuditData = audit || { items: [], summary: {} };
  const summary = toolAuditData.summary || {};
  const counts = summary.statusCounts || {};
  const reviewCount = ['repair', 'fix-ux-schema', 'prefer-dedicated', 'deprecation-candidate', 'clarify']
    .reduce((total, key) => total + Number(counts[key] || 0), 0);
  setText('tools-registered', num(summary.registeredTools));
  setText('tools-observed', num(summary.observedTools));
  setText('tools-no-evidence', num(summary.toolsWithoutEvidence));
  setText('tools-review', num(reviewCount));
  const reviewCard = byId('tools-review-card');
  if (reviewCard) reviewCard.dataset.tone = reviewCount > 0 ? 'warn' : 'ok';
  setText('tools-portfolio-window', 'Scope ' + (toolAuditData.scope || 'active') + ' · ' + num(toolAuditData.days) + ' días · desde ' + dateTime(toolAuditData.since) + '.');
  setPill('tools-portfolio-privacy', 'info', toolAuditData.metricsAvailable ? 'agregado y redactado' : 'sin SQLite');

  const items = Array.isArray(toolAuditData.items) ? toolAuditData.items : [];
  setPortfolioSelectOptions('tools-family', items.map((item) => item.metadata && item.metadata.family));
  setPortfolioSelectOptions('tools-role', items.map((item) => item.metadata && item.metadata.role));
  setPortfolioSelectOptions('tools-status', items.map((item) => item.status), auditStatusLabel);
  setPortfolioSelectOptions('tools-lifecycle', items.map((item) => item.metadata && item.metadata.lifecycle));
  renderToolPortfolioRows();
}

function setupToolPortfolioFilters() {
  const search = byId('tools-search');
  if (search) search.addEventListener('input', renderToolPortfolioRows);
  ['tools-family', 'tools-role', 'tools-status', 'tools-lifecycle'].forEach((id) => {
    const select = byId(id);
    if (select) select.addEventListener('change', renderToolPortfolioRows);
  });
  const reset = byId('tools-reset');
  if (reset) reset.addEventListener('click', () => {
    ['tools-search', 'tools-family', 'tools-role', 'tools-status', 'tools-lifecycle'].forEach((id) => {
      const field = byId(id);
      if (field) field.value = '';
    });
    renderToolPortfolioRows();
  });
}

function setupActivityControls() {
  document.querySelectorAll('[data-activity-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.activityMode;
      if (mode !== 'aggregate' && mode !== 'raw') return;
      activityRecentMode = mode;
      syncActivityRecentMode();
    });
  });
  const timeline = byId('activity-timeline');
  if (timeline) timeline.addEventListener('click', (event) => {
    const button = event.target.closest('[data-activity-bucket]');
    if (!button || !timeline.contains(button)) return;
    selectedActivityBucket = button.dataset.activityBucket || '';
    timeline.querySelectorAll('[data-activity-bucket]').forEach((candidate) => {
      candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
    });
    renderActivityTimelineDetail(activityTimelineRows);
  });
}
function setupMssrControls() {
  const panel = byId('panel-mssr');
  if (!panel || panel.dataset.mssrGrouped === 'true') return;
  const nav = panel.querySelector('.mssr-local-nav');
  if (!nav) return;

  const families = [
    {
      id: 'context',
      kicker: 'Contexto + mantenimiento',
      title: 'Contexto y health',
      description: 'Presión de contexto, salud estructural, control plane, runtime y evidencia por traza.',
      selectors: ['#mssr-context-planner', '#mssr-skill-health-status', '#mssr-project-health-status', '#mssr-runtime-health-status', '#mssr-context-traces', '#mssr-context-pressure'],
    },
    {
      id: 'routing',
      kicker: 'Selección y aprendizaje',
      title: 'Routing y skills',
      description: 'Qué seleccionó el router, qué cargó el host y qué feedback histórico quedó observable.',
      selectors: ['#mssr-selected-skills', '#mssr-loaded-skills', '#mssr-selection-feedback', '#mssr-learning-priors'],
    },
    {
      id: 'identity',
      kicker: 'Host observable',
      title: 'Identidad y host',
      description: 'Perfiles correlacionados, resultados, transporte físico y comparación por esfuerzo observado.',
      selectors: ['#mssr-agent-activation', '#mssr-agent-results', '#mssr-agent-transport', '#mssr-effort-comparison'],
    },
    {
      id: 'outcomes',
      kicker: 'Cierre atribuido',
      title: 'Outcomes',
      description: 'Resultado por skill primaria sin multiplicar atribución entre skills de apoyo.',
      selectors: ['#mssr-skill-outcomes'],
    },
  ];

  let anchor = nav;
  families.forEach((family) => {
    const details = document.createElement('details');
    details.className = 'mssr-family-group';
    details.dataset.mssrFamily = family.id;
    details.dataset.uxLayer = 'detail';
    details.innerHTML = '<summary class="mssr-family-summary"><div><span class="mssr-family-kicker">' + esc(family.kicker) + '</span><strong>' + esc(family.title) + '</strong><small>' + esc(family.description) + '</small></div><span id="mssr-family-' + family.id + '-status" class="mssr-family-status">cargando…</span></summary><div class="mssr-family-grid grid"></div>';
    anchor.insertAdjacentElement('afterend', details);
    anchor = details;
    const grid = details.querySelector('.mssr-family-grid');
    const cards = [];
    family.selectors.forEach((selector) => {
      const card = panel.querySelector(selector)?.closest('article.card');
      if (card && !cards.includes(card)) cards.push(card);
    });
    cards.forEach((card) => grid.appendChild(card));
  });

  const setCurrent = (familyId) => {
    nav.querySelectorAll('[data-mssr-nav]').forEach((button) => {
      if (button.dataset.mssrNav === familyId) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  };
  nav.querySelectorAll('[data-mssr-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const familyId = button.dataset.mssrNav || 'overview';
      setCurrent(familyId);
      if (familyId === 'overview') {
        panel.querySelector('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const details = panel.querySelector('[data-mssr-family="' + familyId + '"]');
      if (!details) return;
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  panel.dataset.mssrGrouped = 'true';
}

function syncMssrFamilySummaries(mssr) {
  const root = mssr || {};
  const context = root.contextAssembly || {};
  const top = root.top || {};
  const benchmark = root.benchmark || {};
  const text = (id) => String(byId(id)?.textContent || '—').trim() || '—';
  setText('mssr-family-context-status', pct(context.savingsRate) + ' ahorro · skills ' + text('mssr-skill-health-review') + 'R/' + text('mssr-skill-health-watch') + 'W · proyectos ' + text('mssr-project-health-review') + 'R/' + text('mssr-project-health-watch') + 'W');
  setText('mssr-family-routing-status', num((top.selectedSkills || []).length) + ' seleccionadas · ' + num((top.loadedSkills || []).length) + ' cargadas');
  setText('mssr-family-identity-status', num((root.agentProfiles || []).length) + ' perfiles · ' + num((root.reasoningEffortComparison || []).length) + ' buckets');
  setText('mssr-family-outcomes-status', num(benchmark.attributedOutcomeTraces || 0) + ' outcomes · ' + pct(benchmark.outcomeSuccessRate) + ' éxito');
}


function relativeAge(iso) {
  if (!iso) return '—';
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'hace ' + seconds + ' s';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return 'hace ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'hace ' + hours + ' h';
  const days = Math.floor(hours / 24);
  return 'hace ' + days + ' d';
}

function humanizeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Trabajo actual';
  const text = raw.replace(/[-_]+/g, ' ').replace(/ +/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function signedNumber(value, suffix) {
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? '+' : numeric < 0 ? '−' : '±';
  return prefix + num(Math.abs(numeric)) + (suffix || '');
}

function pulseTone(targetId, tone) {
  const target = byId(targetId);
  const card = target ? target.closest('.home-pulse-card') : null;
  if (card) card.dataset.tone = tone;
}

function semanticTraceEvent(row) {
  const event = String(row && row.latestEventType || '').toLowerCase();
  if (row && row.closed) return 'Trabajo cerrado';
  if (event.includes('verification')) return 'Verificación registrada';
  if (event.includes('persistence')) return 'Persistencia registrada';
  if (event.includes('outcome')) return 'Outcome registrado';
  if (event.includes('friction')) return 'Fricción registrada';
  if (event.includes('replan') || event.includes('route')) return 'Plan actualizado';
  if (event.includes('context')) return 'Contexto preparado';
  return 'Trabajo actualizado';
}

function renderHomeChanges(cockpit, status) {
  const target = byId('home-changes');
  if (!target) return;
  const rows = [];
  for (const row of Array.isArray(cockpit && cockpit.traces) ? cockpit.traces : []) {
    if (!row || !row.latestAt || row.setupOnly === true) continue;
    rows.push({
      at: row.latestAt,
      label: semanticTraceEvent(row),
      title: row.displayName || row.workflowLabel || humanizeKey(row.workflowKey),
      detail: row.closed ? 'Trabajo cerrado con evidencia observable.' : (row.summary || (row.stage ? 'Etapa ' + row.stage : '')),
      tone: row.closed ? 'ok' : 'info',
    });
  }
  if (status && status.startedAt) {
    rows.push({
      at: status.startedAt,
      label: 'Runtime iniciado',
      title: 'Bridge ' + (status.server && status.server.version ? 'v' + status.server.version : ''),
      detail: 'Nueva generación de runtime observable.',
      tone: 'info',
    });
  }
  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set();
  const selected = rows.filter((row) => {
    const key = row.label + '|' + row.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
  if (!selected.length) {
    target.innerHTML = '<div class="home-empty">No hay cambios humanos recientes en la ventana observable.</div>';
    return;
  }
  target.innerHTML = selected.map((row) => '<article class="home-change-row">' +
    '<span class="dot ' + esc(row.tone) + '"></span>' +
    '<div class="home-change-main"><span class="home-change-label">' + esc(row.label) + '</span><strong>' + esc(row.title) + '</strong><span>' + esc(row.detail || '') + '</span></div>' +
    '<time datetime="' + esc(row.at) + '">' + esc(relativeAge(row.at)) + '</time>' +
  '</article>').join('');
}

function renderHomeAttention(snapshot) {
  const target = byId('home-attention-list');
  if (!target) return;
  const status = snapshot.status || {};
  const overview = snapshot.overview || {};
  const mssr = snapshot.mssr || {};
  const cockpit = snapshot.cockpit || {};
  const benchmark = mssr.benchmark || {};
  const morning = cockpit.morningBrief || {};
  const persistence = overview.persistence || {};
  const items = [];
  const add = (tone, title, detail, legacyTab) => items.push({ tone, title, detail, legacyTab });

  if (!Boolean(status.ready) || Boolean(status.closing)) {
    add('bad', 'Bridge no está ready', status.closing ? 'El runtime está cerrando conexiones.' : 'El endpoint de servicio no reporta ready.', 'system');
  }
  const persistenceFailures = Number(persistence.failed || 0);
  const persistenceDrops = Number(persistence.dropped || 0);
  if (persistenceFailures > 0 || persistenceDrops > 0) {
    add('bad', 'Persistencia de métricas', num(persistenceFailures) + ' fallos · ' + num(persistenceDrops) + ' descartes observados.', 'system');
  }
  const requiredExpected = Number(benchmark.requiredSkillLoadsExpected || 0);
  const requiredSatisfied = Number(benchmark.requiredSkillLoadsSatisfied || 0);
  const requiredMissing = Math.max(0, requiredExpected - requiredSatisfied);
  if (requiredExpected > 0 && requiredMissing > 0) {
    add('warn', 'Cargas requeridas pendientes', num(requiredMissing) + ' de ' + num(requiredExpected) + ' cargas obligatorias no quedaron satisfechas en la época activa.', 'mssr');
  }
  const closureDebt = Number(morning.needsClosureReviewCount ?? morning.lifecycleDebtTaskCount ?? 0);
  if (closureDebt > 0) {
    add('warn', 'Cierres para revisar', num(closureDebt) + (closureDebt === 1 ? ' tarea humana necesita confirmar si sigue activa o cerrar su resultado.' : ' tareas humanas necesitan confirmar si siguen activas o cerrar su resultado.'), 'cockpit');
  }
  const projectReview = Number(cockpit.counts && cockpit.counts.projectReview || 0);
  if (projectReview > 0) {
    add('warn', 'Project Health en REVIEW', num(projectReview) + ' entradas de salud de proyecto están en estado REVIEW y requieren revisión explícita.', 'cockpit');
  }

  const closureNotice = (snapshot.toolNotices && Array.isArray(snapshot.toolNotices.items) ? snapshot.toolNotices.items : []).find((item) =>
    item && item.code === 'mssr-trace-closure-due' && Array.isArray(item.actions) && item.actions.length > 0
  );
  if (closureNotice && closureDebt === 0) add(closureNotice.severity === 'error' ? 'bad' : 'warn', 'Cierre MSSR pendiente', 'Hay trabajo sustantivo sin outcome observable. Revisá si la tarea sigue activa o si corresponde cerrarla.', 'cockpit');

  const limited = items.slice(0, 5);
  if (!limited.length) {
    setPill('home-attention-count', 'ok', 'sin acciones');
    target.innerHTML = '<div class="home-attention-clear"><span class="dot ok"></span><div><strong>Sin acciones urgentes</strong><span>Los contratos observables no requieren intervención inmediata.</span></div></div>';
    return;
  }
  const worst = limited.some((item) => item.tone === 'bad') ? 'bad' : 'warn';
  setPill('home-attention-count', worst, limited.length + (limited.length === 1 ? ' punto' : ' puntos'));
  target.innerHTML = limited.map((item) => '<article class="home-attention-row" data-tone="' + esc(item.tone) + '">' +
    '<span class="dot ' + esc(item.tone) + '"></span>' +
    '<div><strong>' + esc(item.title) + '</strong><span>' + esc(item.detail) + '</span></div>' +
    (item.legacyTab ? '<button type="button" class="home-row-action" data-open-legacy-tab="' + esc(item.legacyTab) + '">Ver</button>' : '') +
  '</article>').join('');
}

function renderHomePulse(snapshot) {
  const status = snapshot.status || {};
  const timeline = Array.isArray(snapshot.timeline && snapshot.timeline.timeline) ? [...snapshot.timeline.timeline] : [];
  timeline.sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
  const latest = timeline.at(-1) || {};
  const previous = timeline.at(-2) || null;
  const latestCalls = Number(latest.calls || 0);
  const previousCalls = previous ? Number(previous.calls || 0) : null;
  const latestErrors = Number(latest.errors || 0);
  const previousErrors = previous ? Number(previous.errors || 0) : null;
  const latestErrorRate = latestCalls > 0 ? (latestErrors / latestCalls) * 100 : 0;
  const previousErrorRate = previous && previousCalls > 0 ? (previousErrors / previousCalls) * 100 : null;

  setText('home-pulse-activity', num(latestCalls) + ' / 5 min');
  setText('home-pulse-activity-note', previousCalls === null ? 'último bloque observable' : signedNumber(latestCalls - previousCalls, '') + ' vs bloque anterior');
  pulseTone('home-pulse-activity', 'info');

  setText('home-pulse-errors', decimalFormat.format(latestErrorRate) + '%');
  setText('home-pulse-errors-note', previousErrorRate === null ? num(latestErrors) + ' errores' : signedNumber(Number((latestErrorRate - previousErrorRate).toFixed(1)), ' pp') + ' · ' + num(latestErrors) + ' errores');
  pulseTone('home-pulse-errors', 'info');

  const sessions = Number(status.sessions || 0);
  const activeSessions = Number(status.activeSessions || 0);
  const maxSessions = Number(status.limits && status.limits.maxSessions || 0);
  setText('home-pulse-sessions', maxSessions > 0 ? num(sessions) + ' / ' + num(maxSessions) : num(sessions));
  setText('home-pulse-sessions-note', num(activeSessions) + ' activas · ' + num(Math.max(0, sessions - activeSessions)) + ' idle');
  const capacityRatio = maxSessions > 0 ? sessions / maxSessions : 0;
  pulseTone('home-pulse-sessions', capacityRatio >= 1 ? 'bad' : capacityRatio >= 0.9 ? 'warn' : 'ok');

  const persistence = snapshot.overview && snapshot.overview.persistence || {};
  const failed = Number(persistence.failed || 0);
  const dropped = Number(persistence.dropped || 0);
  const pending = Number(persistence.pending || 0);
  setText('home-pulse-persistence', failed || dropped ? num(failed + dropped) + ' incidencias' : 'sin fallos');
  setText('home-pulse-persistence-note', num(pending) + ' pendientes · ' + num(dropped) + ' descartes');
  pulseTone('home-pulse-persistence', failed || dropped ? 'bad' : 'ok');
}

function updateV2Inspector(snapshot) {
  const status = snapshot.status || {};
  const observability = snapshot.mssr && snapshot.mssr.observability || {};
  setText('inspector-server', (status.server && status.server.name ? status.server.name : '—') + (status.server && status.server.version ? ' v' + status.server.version : ''));
  setText('inspector-pid', status.pid || '—');
  setText('inspector-boot', status.runtimeBootId || '—');
  setText('inspector-started', dateTime(status.startedAt));
  setText('inspector-transport', status.transport || '—');
  setText('inspector-epoch', observability.activeEpoch || '—');
  setText('inspector-snapshot', dateTime(snapshot.generatedAt));
  setText('inspector-build', snapshot.cache && snapshot.cache.buildMs !== undefined ? decimalFormat.format(snapshot.cache.buildMs) + ' ms' : '—');
}

function updateHome(snapshot) {
  const status = snapshot.status || {};
  const cockpit = snapshot.cockpit || {};
  const morning = cockpit.morningBrief || {};
  const runtime = snapshot.runtimeHealth && snapshot.runtimeHealth.latest || {};
  const runtimeLevel = String(runtime.projection && runtime.projection.level || 'ok').toLowerCase();
  const ready = Boolean(status.ready) && !Boolean(status.closing);
  const systemNeedsAttention = !ready || ['review', 'critical', 'error', 'failed'].includes(runtimeLevel);
  const systemWatch = !systemNeedsAttention && runtimeLevel === 'watch';
  const activeCount = Number(morning.openTaskCount ?? (cockpit.counts && cockpit.counts.active) ?? 0);
  const closureDebt = Number(morning.needsClosureReviewCount ?? morning.lifecycleDebtTaskCount ?? 0);

  setText('server-subtitle', 'Bridge dashboard · UX v2-B · actualización cada 5 s');
  setText('home-active-work', num(activeCount) + (activeCount === 1 ? ' activo' : ' activos'));
  setText('home-closure-debt', num(closureDebt) + (closureDebt === 1 ? ' cierre' : ' cierres'));
  const systemSentence = systemNeedsAttention ? 'Bridge requiere atención.' : systemWatch ? 'Bridge está operativo con una observación.' : 'Bridge está operativo.';
  const workSentence = activeCount || closureDebt
    ? ' Hay ' + num(activeCount) + (activeCount === 1 ? ' trabajo activo' : ' trabajos activos') + ' y ' + num(closureDebt) + (closureDebt === 1 ? ' tarea con cierre para revisar.' : ' tareas con cierre para revisar.')
    : ' No hay trabajo humano pendiente en la proyección actual.';
  setText('home-status-sentence', systemSentence + workSentence);
  setPill('shell-work-status', closureDebt > 0 ? 'warn' : activeCount > 0 ? 'info' : 'ok', num(activeCount) + ' activos · ' + num(closureDebt) + ' cierres');

  const tasks = Array.isArray(morning.tasks) ? morning.tasks : [];
  const current = tasks.find((task) => task && task.classification && task.classification.state === 'active') || tasks[0] || null;
  if (current) {
    const title = current.workflowKey ? humanizeKey(current.workflowKey) : current.project ? humanizeKey(current.project) : 'Trabajo actual';
    setText('home-continue-title', title);
    setText('home-continue-project', current.project || (Array.isArray(current.projects) ? current.projects.join(' · ') : 'MauroPrime'));
    setText('home-continue-summary', current.latestSummary || 'Trabajo activo sin resumen humano adicional.');
    setPill('home-continue-stage', 'info', current.latestStage || (current.classification && current.classification.state) || 'activo');
    setText('home-continue-next', current.nextGate || 'continuar');
    setText('home-continue-latest', relativeAge(current.latestAt));
  } else if (cockpit.focus) {
    const focus = cockpit.focus;
    setText('home-continue-title', focus.displayName || humanizeKey(focus.workflowKey));
    setText('home-continue-project', focus.project || 'MauroPrime');
    setText('home-continue-summary', focus.summary || 'Trabajo técnico activo.');
    setPill('home-continue-stage', 'info', focus.stage || focus.status || 'activo');
    setText('home-continue-next', focus.nextPhase || focus.attentionKind || 'continuar');
    setText('home-continue-latest', relativeAge(focus.latestAt));
  } else {
    setText('home-continue-title', 'Sin trabajo activo');
    setText('home-continue-project', 'MauroPrime');
    setText('home-continue-summary', 'La proyección actual no tiene una tarea humana activa para reanudar.');
    setPill('home-continue-stage', 'ok', 'libre');
    setText('home-continue-next', '—');
    setText('home-continue-latest', '—');
  }

  renderHomeAttention(snapshot);
  renderHomePulse(snapshot);
  renderHomeChanges(cockpit, status);
  updateV2Inspector(snapshot);
}

function workStateLabel(state) {
  const labels = {
    active: 'activo',
    'review-needed': 'revisar',
    paused: 'pausado',
    experimental: 'experimental',
    finished: 'terminado',
    'abandoned-or-replaced': 'reemplazado',
    observed: 'observado',
    historical: 'histórico',
  };
  return labels[state] || String(state || 'observado');
}

function workStateTone(state) {
  if (state === 'review-needed') return 'warn';
  if (state === 'active' || state === 'finished') return 'ok';
  return 'info';
}

function workProjectBlockerSummary(reason) {
  const text = String(reason || '').trim();
  if (!text) return 'Necesita revisión humana.';
  const lower = text.toLowerCase();
  if (lower.includes('evidencia disponible no alcanza') || lower.includes('clasificación explícita del owner')) return 'Falta una clasificación explícita del owner.';
  if (lower.includes('project context health') || lower.includes('salud de contexto')) return 'Project Context requiere revisión antes de clasificar.';
  if (lower.includes('trazas sustantivas') && lower.includes('cerraron')) return 'Las trazas cerraron; falta clasificar el proyecto.';
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.length > 150 ? firstSentence.slice(0, 147).trimEnd() + '…' : firstSentence;
}

function workGitDecision(project, includeDirty = false) {
  if (!project) return null;
  const remoteState = String(project.remoteState || '');
  const localChanges = Number(project.gitPressure || 0) + Number(project.trackedChanges || 0) + Number(project.untrackedChanges || 0);
  if (remoteState === 'diverged-local-tracking') return { tone: 'warn', text: 'Git divergente' };
  if (remoteState === 'behind-local-tracking') return { tone: 'warn', text: 'Git por detrás' };
  if (includeDirty && (project.gitClean === false || localChanges > 0)) return { tone: 'info', text: 'cambios locales' };
  return null;
}

function workCurrentTasks(cockpit) {
  const root = cockpit || {};
  const brief = root.morningBrief || {};
  const active = Array.isArray(brief.tasks) ? brief.tasks : [];
  const debt = Array.isArray(brief.lifecycleDebt) ? brief.lifecycleDebt : [];
  const debtKeys = new Set(debt.map((task, index) => cockpitTaskIdentity(task, index)));
  const seen = new Set();
  const rows = [];
  [...active, ...debt].forEach((task, index) => {
    if (!task) return;
    const key = cockpitTaskIdentity(task, index);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ task, needsClosure: task.needsClosureReview === true || debtKeys.has(key) });
  });
  return rows;
}

function renderWorkTask(row, workspaceProjects, index) {
  const task = row.task || {};
  const projectLabel = cockpitTaskProjectLabel(task);
  const taskLabel = humanizeKey(task.workflowKey || task.taskKey || projectLabel);
  const stage = task.latestStage || (task.classification && task.classification.state) || 'activo';
  const nextGate = task.nextGate || (row.needsClosure ? 'revisar cierre' : 'continuar');
  const latest = task.latestAt ? relativeAge(task.latestAt) : 'sin hora observable';
  const project = (workspaceProjects || []).find((item) => String(item && item.name || '').toLowerCase() === String(task.project || '').toLowerCase()) || null;
  const gitDecision = workGitDecision(project);
  const runtime = task.runtimeActivity || {};
  const attention = row.needsClosure
    ? '<span class="work-task-attention"><span class="dot warn"></span>Confirmar si continúa o cerrar resultado</span>'
    : runtime.active === true && runtime.progressing === false
      ? '<span class="work-task-attention work-task-attention-info"><span class="dot info"></span>Proceso vivo sin progreso reciente</span>'
      : '';
  const git = gitDecision ? '<span class="work-task-git" data-tone="' + esc(gitDecision.tone) + '">' + esc(gitDecision.text) + '</span>' : '';
  return '<article class="work-task-card' + (index === 0 ? ' work-task-primary' : '') + '" data-work-task data-tone="' + (row.needsClosure ? 'warn' : 'info') + '">' +
    '<div class="work-task-head"><div><span class="work-task-project">' + esc(projectLabel) + '</span><strong>' + esc(taskLabel) + '</strong></div>' +
    '<span class="status-pill" data-tone="' + (row.needsClosure ? 'warn' : 'info') + '"><span class="dot ' + (row.needsClosure ? 'warn' : 'info') + '"></span><span>' + esc(stage) + '</span></span></div>' +
    '<p>' + esc(task.latestSummary || 'Trabajo activo sin resumen humano adicional.') + '</p>' +
    (attention || git ? '<div class="work-task-signals">' + attention + git + '</div>' : '') +
    '<div class="work-task-footer"><div><span>Siguiente</span><strong>' + esc(nextGate) + '</strong></div><time>' + esc(latest) + '</time></div>' +
  '</article>';
}

function workProjectsForRange(cockpit, range) {
  const root = cockpit || {};
  if (range === 'now') {
    return (root.workspaceMap && Array.isArray(root.workspaceMap.projects) ? root.workspaceMap.projects : []).map((project) => ({
      name: project.name || 'Proyecto',
      state: project.classification && project.classification.state || 'review-needed',
      summary: ((project.currentTasks || [])[0] || {}).summary || project.latestSummary || 'Sin resumen humano reciente.',
      nextGate: project.nextGate || 'revisar',
      latestAt: project.latestAt,
      blocker: project.classification && project.classification.state === 'review-needed' ? workProjectBlockerSummary(project.classification.reason) : '',
      git: workGitDecision(project, true),
    }));
  }

  if (range === '24h') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const grouped = new Map();
    for (const trace of Array.isArray(root.traces) ? root.traces : []) {
      if (!trace || trace.setupOnly === true || !trace.latestAt || new Date(trace.latestAt).getTime() < cutoff) continue;
      const name = trace.project || 'MauroPrime';
      const key = String(name).toLowerCase();
      const previous = grouped.get(key);
      if (!previous || new Date(trace.latestAt).getTime() > new Date(previous.latestAt || 0).getTime()) {
        grouped.set(key, {
          name,
          state: 'observed',
          summary: trace.summary || 'Actividad MSSR observada durante las últimas 24 h.',
          nextGate: trace.closed ? 'cerrado' : trace.nextPhase ? 'toca ' + phaseLabel(trace.nextPhase) : 'continuar',
          latestAt: trace.latestAt,
          blocker: '',
          git: null,
        });
      }
    }
    return [...grouped.values()];
  }

  if (range === '7d') {
    const weekly = root.weekly || {};
    return (Array.isArray(weekly.projects) ? weekly.projects : []).map((project) => ({
      name: project.name || 'Proyecto',
      state: 'observed',
      summary: project.latestSummary || 'Proyecto observado en la ventana semanal.',
      nextGate: project.pendingHint || 'sin gate histórico explícito',
      latestAt: project.latestAt,
      blocker: '',
      git: workGitDecision(project),
    }));
  }

  const rolling = root.contextInventory && root.contextInventory.rolling30d || {};
  const summaries = new Map((rolling.latestSummaries || []).map((item) => [String(item.project || '').toLowerCase(), item]));
  return (Array.isArray(rolling.projects) ? rolling.projects : []).map((project) => {
    const summary = summaries.get(String(project.name || '').toLowerCase());
    return {
      name: project.name || 'Proyecto',
      state: 'historical',
      summary: summary && summary.summary || 'Proyecto observado en snapshots retenidos.',
      nextGate: 'sin gate histórico explícito',
      latestAt: summary && summary.date ? summary.date + 'T12:00:00' : project.lastSeenDate ? project.lastSeenDate + 'T12:00:00' : null,
      blocker: '',
      git: null,
      activeDays: Number(project.activeDays || 0),
    };
  });
}

function renderWorkProjects(cockpit) {
  const target = byId('work-project-list');
  if (!target) return;
  const filterGroup = byId('work-project-filter-group');
  if (filterGroup) filterGroup.hidden = workRange !== 'now';
  const allRows = workProjectsForRange(cockpit, workRange);
  const rows = workRange === 'now' && workProjectFilter === 'current'
    ? allRows.filter((project) => ['active', 'review-needed'].includes(project.state))
    : allRows;
  const rangeLabels = {
    now: 'estado actual',
    '24h': 'últimas 24 h · evidencia retenida',
    '7d': 'últimos 7 días · proyectos observados',
    '30d': 'últimos 30 días · snapshots retenidos',
  };
  setText('work-range-note', rangeLabels[workRange] || 'ventana seleccionada');
  if (!rows.length) {
    target.innerHTML = '<div class="home-empty">No hay proyectos con evidencia para esta vista.</div>';
    return;
  }
  target.innerHTML = rows.slice(0, 24).map((project) => {
    const tone = workStateTone(project.state);
    const git = project.git ? '<span class="work-project-git" data-tone="' + esc(project.git.tone) + '">' + esc(project.git.text) + '</span>' : '';
    const extra = project.activeDays ? '<span>' + num(project.activeDays) + ' días activos</span>' : '';
    return '<article class="work-project-row" data-work-project data-work-state="' + esc(project.state) + '">' +
      '<div class="work-project-main"><div class="work-project-head"><strong>' + esc(project.name) + '</strong><span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(workStateLabel(project.state)) + '</span></span></div>' +
      '<p>' + esc(project.summary) + '</p>' +
      (project.blocker ? '<span class="work-project-blocker"><span class="dot warn"></span>' + esc(project.blocker) + '</span>' : '') + '</div>' +
      '<div class="work-project-next"><span>Siguiente</span><strong>' + esc(project.nextGate) + '</strong><small>' + esc(project.latestAt ? relativeAge(project.latestAt) : 'sin tiempo observable') + '</small>' + git + extra + '</div>' +
    '</article>';
  }).join('');
}

function workSemanticEvents(cockpit, range) {
  const root = cockpit || {};
  const cutoffHours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : range === '30d' ? 24 * 30 : null;
  const cutoff = cutoffHours ? Date.now() - cutoffHours * 60 * 60 * 1000 : null;
  const rows = [];
  for (const trace of Array.isArray(root.traces) ? root.traces : []) {
    if (!trace || trace.setupOnly === true || !trace.latestAt) continue;
    const at = new Date(trace.latestAt).getTime();
    if (cutoff && at < cutoff) continue;
    const label = semanticTraceEvent(trace);
    rows.push({
      at: trace.latestAt,
      label,
      title: trace.displayName || trace.workflowLabel || humanizeKey(trace.workflowKey || trace.project),
      detail: trace.closed ? 'Trabajo cerrado con evidencia observable.' : (trace.summary || (trace.stage ? 'Etapa ' + trace.stage : 'Trabajo actualizado.')),
      tone: label === 'Fricción registrada' ? 'warn' : trace.closed ? 'ok' : 'info',
    });
  }

  if (range === '7d') {
    for (const project of Array.isArray(root.weekly && root.weekly.projects) ? root.weekly.projects : []) {
      if (!project || !project.latestAt) continue;
      rows.push({ at: project.latestAt, label: 'Proyecto observado', title: project.name || 'Proyecto', detail: project.latestSummary || 'Actividad semanal observada.', tone: 'info' });
    }
  }
  if (range === '30d') {
    const rolling = root.contextInventory && root.contextInventory.rolling30d || {};
    for (const item of Array.isArray(rolling.latestSummaries) ? rolling.latestSummaries : []) {
      if (!item || !item.date) continue;
      rows.push({ at: item.date + 'T12:00:00', label: 'Resumen diario', title: item.project || 'Proyecto', detail: item.summary || 'Actividad preservada en snapshot diario.', tone: 'info' });
    }
  }

  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.label + '|' + row.title + '|' + String(row.at).slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function renderWorkTimeline(cockpit) {
  const target = byId('work-timeline');
  if (!target) return;
  const rows = workSemanticEvents(cockpit, workRange);
  setPill('work-event-count', rows.length > 0 ? 'info' : 'ok', num(rows.length) + (rows.length === 1 ? ' evento' : ' eventos'));
  if (!rows.length) {
    target.innerHTML = '<div class="home-empty">No hay eventos humanos retenidos para esta ventana.</div>';
    return;
  }
  target.innerHTML = rows.map((row) => '<article class="work-event-row" data-work-event>' +
    '<span class="dot ' + esc(row.tone) + '"></span>' +
    '<div class="work-event-main"><span>' + esc(row.label) + '</span><strong>' + esc(row.title) + '</strong><small>' + esc(row.detail) + '</small></div>' +
    '<time datetime="' + esc(row.at) + '">' + esc(relativeAge(row.at)) + '</time>' +
  '</article>').join('');
}

function updateWork(snapshot) {
  workSnapshot = snapshot || workSnapshot;
  if (!workSnapshot) return;
  const cockpit = workSnapshot.cockpit || {};
  const brief = cockpit.morningBrief || {};
  const activeCount = Number(brief.openTaskCount ?? (cockpit.counts && cockpit.counts.active) ?? 0);
  const closureCount = Number(brief.needsClosureReviewCount ?? brief.lifecycleDebtTaskCount ?? 0);
  const rows = workCurrentTasks(cockpit);
  const workspaceProjects = cockpit.workspaceMap && Array.isArray(cockpit.workspaceMap.projects) ? cockpit.workspaceMap.projects : [];

  document.querySelectorAll('[data-work-range]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.workRange === workRange ? 'true' : 'false'));
  document.querySelectorAll('[data-work-project-filter]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.workProjectFilter === workProjectFilter ? 'true' : 'false'));

  const currentSentence = activeCount || closureCount
    ? 'Hay ' + num(activeCount) + (activeCount === 1 ? ' trabajo activo' : ' trabajos activos') + ' y ' + num(closureCount) + (closureCount === 1 ? ' cierre para revisar.' : ' cierres para revisar.')
    : 'No hay trabajo humano pendiente en la proyección actual.';
  const rangeSentence = workRange === 'now' ? ' El mapa muestra el estado actual.' : workRange === '24h' ? ' El mapa muestra evidencia retenida de las últimas 24 horas.' : workRange === '7d' ? ' El mapa muestra proyectos observados durante 7 días.' : ' El mapa histórico usa snapshots retenidos de hasta 30 días.';
  setText('work-status-sentence', currentSentence + rangeSentence);
  setPill('work-active-count', closureCount > 0 ? 'warn' : activeCount > 0 ? 'info' : 'ok', num(activeCount) + ' activos · ' + num(closureCount) + ' cierres');

  const activeTarget = byId('work-active-list');
  if (activeTarget) {
    activeTarget.innerHTML = rows.length
      ? rows.slice(0, 12).map((row, index) => renderWorkTask(row, workspaceProjects, index)).join('')
      : '<div class="home-empty work-empty-current"><strong>Sin trabajo activo</strong><span>No hay una tarea humana abierta para reanudar en el snapshot actual.</span></div>';
  }

  renderWorkProjects(cockpit);
  renderWorkTimeline(cockpit);
}

function setupWorkControls() {
  document.querySelectorAll('[data-work-range]').forEach((button) => {
    button.addEventListener('click', () => {
      workRange = button.dataset.workRange || 'now';
      if (workSnapshot) updateWork(workSnapshot);
    });
  });
  document.querySelectorAll('[data-work-project-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      workProjectFilter = button.dataset.workProjectFilter || 'current';
      if (workSnapshot) updateWork(workSnapshot);
    });
  });
  document.querySelectorAll('[data-open-v2-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activateV2Tab(button.dataset.openV2Tab || 'home', false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function activateV2Tab(name, focusButton) {
  const buttons = [...document.querySelectorAll('[data-v2-tab]')];
  const panels = [...document.querySelectorAll('[data-v2-panel]')];
  const valid = buttons.some((button) => button.dataset.v2Tab === name);
  const targetName = valid ? name : 'home';
  buttons.forEach((button) => {
    const active = button.dataset.v2Tab === targetName;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active && focusButton) button.focus();
  });
  panels.forEach((panel) => { panel.hidden = panel.dataset.v2Panel !== targetName; });
}

function setupV2Tabs() {
  const buttons = [...document.querySelectorAll('[data-v2-tab]')];
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activateV2Tab(button.dataset.v2Tab || 'home', false));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      activateV2Tab(buttons[nextIndex].dataset.v2Tab || 'home', true);
    });
  });
  activateV2Tab('home', false);
}

function openLegacyTab(name) {
  const legacy = byId('legacy-dashboard');
  if (!legacy) return;
  legacy.open = true;
  activateTab(name || 'summary', false);
  requestAnimationFrame(() => legacy.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function setupLegacyControls() {
  document.addEventListener('click', (event) => {
    const trigger = event.target && event.target.closest ? event.target.closest('[data-open-legacy-tab]') : null;
    if (!trigger) return;
    openLegacyTab(trigger.dataset.openLegacyTab || 'summary');
  });
}

function setInspectorOpen(open) {
  const inspector = byId('v2-inspector');
  const backdrop = byId('v2-inspector-backdrop');
  const button = byId('inspector-open');
  if (!inspector || !backdrop) return;
  inspector.hidden = !open;
  backdrop.hidden = !open;
  inspector.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('inspector-open', open);
  if (open) byId('inspector-close')?.focus();
  else button?.focus();
}

function setupInspector() {
  byId('inspector-open')?.addEventListener('click', () => setInspectorOpen(true));
  byId('inspector-close')?.addEventListener('click', () => setInspectorOpen(false));
  byId('v2-inspector-backdrop')?.addEventListener('click', () => setInspectorOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && byId('v2-inspector') && !byId('v2-inspector').hidden) setInspectorOpen(false);
  });
}

function updateHealth(status, overview, mssr) {
  const bridgeOk = Boolean(status.ready) && !Boolean(status.closing);
  const sqliteOk = Boolean(overview.enabled) && Boolean(overview.sqliteAvailable);
  const mssrOk = Boolean(mssr.enabled) && Boolean(mssr.sqliteAvailable);
  const overallOk = bridgeOk && sqliteOk && mssrOk;

  setDot('health-bridge-dot', bridgeOk ? 'ok' : 'bad');
  setText('health-bridge', bridgeOk ? 'ready' : 'not ready');
  setDot('health-transport-dot', bridgeOk ? 'ok' : 'bad');
  setText('health-transport', status.transport || '—');
  setDot('health-sqlite-dot', sqliteOk ? 'ok' : 'bad');
  setText('health-sqlite', sqliteOk ? 'disponible' : 'no disponible');
  setDot('health-mssr-dot', mssrOk ? 'ok' : 'warn');
  setText('health-mssr', mssrOk ? 'observando' : 'degradado');
  setDot('health-sessions-dot', Number(status.activeSessions || 0) > 0 ? 'info' : 'ok');
  setText('health-sessions', num(status.sessions) + ' retenidas · ' + num(status.activeSessions) + ' con solicitud');

  const overall = byId('overall-status');
  if (overall) overall.dataset.tone = overallOk ? 'ok' : bridgeOk ? 'warn' : 'bad';
  setDot('overall-dot', overallOk ? 'ok' : bridgeOk ? 'warn' : 'bad');
  setText('overall-text', overallOk ? 'operativo' : bridgeOk ? 'operativo con avisos' : 'no disponible');
}

function updateSummary(status, overview, summary, recent, timeline, mssr) {
  const totals = overview.totals || {};
  const benchmark = mssr.benchmark || {};
  const totalCalls = Number(totals.calls || 0);
  const totalErrors = Number(totals.errorCalls || 0);
  const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;

  setText('server-version', 'v' + (status.server && status.server.version ? status.server.version : '—'));
  setText('server-subtitle', 'MauroPrime · HTTP production-candidate · actualización automática cada 5 s');
  setText('current-sessions', num(status.sessions));
  setText('current-active-sessions', num(status.activeSessions));
  setText('current-anonymous', num(status.anonymousTransports));
  setText('current-pid', status.pid || '—');
  setText('current-runtime-boot', status.runtimeBootId || '—');
  setText('current-uptime', humanDuration(status.uptimeSeconds));

  setText('total-calls', num(totalCalls));
  setText('total-errors', num(totalErrors));
  setText('error-rate', decimalFormat.format(errorRate) + '%');
  setText('avg-duration', ms(totals.avgDurationMs));
  setText('summary-mssr-structured', pct(benchmark.structuredRouteRate));
  setText('summary-mssr-routes', num(benchmark.routeEvents));

  const errorCard = byId('errors-metric-card');
  if (errorCard) errorCard.dataset.tone = errorRate >= 5 ? 'bad' : errorRate >= 2 ? 'warn' : 'ok';

  renderAttention(benchmark);
  renderTimeline('summary-timeline', 'summary-timeline-start', 'summary-timeline-end', timeline.timeline || []);
  renderTools('summary-tools', summary.summary || [], 8);
  renderRecent('summary-recent', recent.recent || [], 8, false);
  renderAgentProfiles(summary.agentProfiles || []);
  setPill('summary-forensic-status', 'info', num(Math.min((recent.recent || []).length, 8)) + ' operaciones · ' + num((summary.agentProfiles || []).length) + ' perfiles');
}

function updateActivity(summary, recent, timeline) {
  activityRecentRows = (recent.recent || []).slice(0, 20);
  activityTimelineRows = timeline.timeline || [];
  renderTimeline('activity-timeline', 'activity-timeline-start', 'activity-timeline-end', activityTimelineRows);
  renderTools('activity-tools', summary.summary || [], 12);
  renderActivityRecent();
}

function renderMssrContextAssembly(context) {
  const data = context || {};
  setText('mssr-context-loaded', num(data.loadedChars));
  setText('mssr-context-full', num(data.fullChars));
  setText('mssr-context-saved', num(data.savedChars));
  setText('mssr-context-savings', pct(data.savingsRate));
  setText('mssr-context-loads', num(data.loadEvents));
  setText('mssr-context-fallbacks', num(data.fallbackLoads));
  setText('mssr-context-skips', num(data.skippedLoads));
  setText('mssr-context-duplicates', num(data.duplicateCharsAvoided));

  const planner = Array.isArray(data.planningModes) && data.planningModes.length ? data.planningModes[0] : null;
  const plannerName = planner && planner.name ? planner.name : 'sin planner observado';
  const plannerTone = plannerName === 'global-required-core-first' ? 'ok' : plannerName === 'legacy-sequential' ? 'warn' : 'info';
  setPill('mssr-context-planner', plannerTone, plannerName + (planner && planner.count ? ' · ' + num(planner.count) : ''));

  const tracesTarget = byId('mssr-context-traces');
  const traces = Array.isArray(data.recentTraces) ? data.recentTraces : [];
  if (tracesTarget) {
    tracesTarget.innerHTML = traces.length ? traces.map((row) => {
      const trace = String(row.traceId || '—');
      const shortTrace = trace.length > 28 ? trace.slice(0, 18) + '…' + trace.slice(-7) : trace;
      const incidents = [];
      if (Number(row.skippedForBudgetLoads || 0) > 0) incidents.push(num(row.skippedForBudgetLoads) + ' skip presupuesto');
      else if (Number(row.skippedLoads || 0) > 0) incidents.push(num(row.skippedLoads) + ' skip');
      if (Number(row.requiredOverflowLoads || 0) > 0) incidents.push(num(row.requiredOverflowLoads) + ' overflow requerido');
      if (Number(row.optionalOverflowLoads || 0) > 0) incidents.push(num(row.optionalOverflowLoads) + ' presión opcional');
      if (Number(row.overflowLoads || 0) > 0 && Number(row.requiredOverflowLoads || 0) === 0 && Number(row.optionalOverflowLoads || 0) === 0 && Number(row.skippedForBudgetLoads || 0) === 0) incidents.push(num(row.overflowLoads) + ' overflow legado');
      if (Number(row.requiredOverflowChars || 0) > 0) incidents.push(num(row.requiredOverflowChars) + ' chars req. pendientes');
      if (Number(row.acceptedOverflowChars || 0) > 0) incidents.push(num(row.acceptedOverflowChars) + ' chars acept. pendientes');
      if (Number(row.remainingRequiredUnits || 0) > 0) incidents.push(num(row.remainingRequiredUnits) + ' unidades req.');
      if (Number(row.remainingAcceptedUnits || 0) > 0) incidents.push(num(row.remainingAcceptedUnits) + ' unidades acept.');
      if (row.continuationIssued === true) incidents.push(row.chainCompleted === true ? 'cadena completada' : row.continuationConsumed === true ? 'continuación consumida' : 'continuación pendiente');
      if (Number(row.duplicateCharsAvoided || 0) > 0) incidents.push(num(row.duplicateCharsAvoided) + ' dup. evitados');
      const bootstrapObserved = row.bootstrapObserved === true;
      const contextBudget = bootstrapObserved
        ? num(row.deliveredContextChars) + ' / ' + num(row.requestedContextChars)
        : num(row.loadedChars) + ' / ' + num(row.fullChars);
      const envelope = bootstrapObserved && (Number(row.responseChars || 0) > 0 || Number(row.envelopeChars || 0) > 0)
        ? 'respuesta ' + num(row.responseChars) + ' · envelope ' + num(row.envelopeChars)
        : '';
      return '<tr>' +
        '<td><code title="' + esc(trace) + '">' + esc(shortTrace) + '</code><div class="recent-detail">' + esc(dateTime(row.latestAt)) + '</div></td>' +
        '<td>' + num(row.skills) + '</td>' +
        '<td>' + contextBudget + (envelope ? '<div class="recent-detail">' + esc(envelope) + '</div>' : '') + '</td>' +
        '<td>' + pct(row.savingsRate) + '<div class="recent-detail">' + num(row.savedChars) + ' chars</div></td>' +
        '<td>' + (incidents.length ? esc(incidents.join(' · ')) : '<span class="muted">sin incidentes</span>') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="5" class="muted">Todavía no hay cargas con telemetría de contexto.</td></tr>';
  }

  const pressureTarget = byId('mssr-context-pressure');
  const pressure = Array.isArray(data.skillPressure) ? data.skillPressure : [];
  const labels = {
    'add-context-manifest': 'agregar manifest',
    'review-core': 'revisar core',
    'review-budget': 'revisar presupuesto',
    'review-required-context': 'revisar contexto requerido',
    'review-optional-context': 'revisar contexto opcional',
    'healthy-selective': 'selectivo sano'
  };
  if (pressureTarget) {
    pressureTarget.innerHTML = pressure.length ? pressure.slice(0, 12).map((row) => {
      const recommendation = labels[row.recommendation] || row.recommendation || '—';
      const tone = row.recommendation === 'healthy-selective' ? 'ok' : row.recommendation === 'review-budget' ? 'warn' : 'info';
      return '<tr>' +
        '<td><strong>' + esc(row.name) + '</strong><div class="recent-detail">full avg ' + num(row.averageFullChars) + ' · ahorro ' + pct(row.savingsRate) + '</div></td>' +
        '<td>' + num(row.loads) + '<div class="recent-detail">fallback ' + num(row.fallbackLoads) + ' · skip ' + num(row.skippedLoads) + '</div></td>' +
        '<td>' + num(row.averageCoreChars) + '</td>' +
        '<td><span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(recommendation) + '</span></span></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="4" class="muted">No hay presión de contexto medible todavía.</td></tr>';
  }
}


function renderMssrEffortComparison(inputRows) {
  const target = byId('mssr-effort-comparison');
  if (!target) return;
  const rows = inputRows || [];
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="13" class="muted">Sin comparativa por esfuerzo en la época activa.</td></tr>';
    return;
  }
  const identitySummary = (sources) => {
    const parts = [];
    if (Number(sources['trace-correlated-host'] || 0) > 0) parts.push('host ' + num(sources['trace-correlated-host']));
    if (Number(sources['lifecycle-only'] || 0) > 0) parts.push('lifecycle ' + num(sources['lifecycle-only']));
    if (Number(sources['trace-host-mixed'] || 0) > 0) parts.push('mixto ' + num(sources['trace-host-mixed']));
    return parts.length ? parts.join(' · ') : 'sin trazas';
  };
  target.innerHTML = rows.map((row) => '<tr>' +
    '<td><strong>' + esc(row.bucket) + '</strong><div class="recent-detail">' + esc(identitySummary(row.identitySources || {})) + '</div></td>' +
    '<td>' + num(row.traces) + '</td>' +
    '<td>' + num(row.physicalToolCalls) + '</td>' +
    '<td>' + num(row.bridgeDirectToolCalls) + '</td>' +
    '<td>' + num(row.hostObservedToolCalls) + '</td>' +
    '<td title="' + esc(num(row.delegatedQueryCalls) + ' query · ' + num(row.delegatedActionCalls) + ' action') + '">' + num(row.delegatedToolCalls) + '</td>' +
    '<td>' + pct(row.delegatedCallRate) + '</td>' +
    '<td title="' + esc(num(row.discoveryDetours) + ' desvíos totales') + '">' + (row.averageDiscoveryDetoursPerTrace === null || row.averageDiscoveryDetoursPerTrace === undefined ? '—' : decimalFormat.format(Number(row.averageDiscoveryDetoursPerTrace))) + '</td>' +
    '<td>' + pct(row.routeLoadCoverage) + '</td>' +
    '<td>' + pct(row.verificationCoverage) + '</td>' +
    '<td>' + pct(row.persistenceCoverage) + '</td>' +
    '<td>' + pct(row.outcomeCoverage) + '</td>' +
    '<td>' + pct(row.outcomeSuccessRate) + '</td>' +
  '</tr>').join('');
}

function updateMssr(mssr) {
  const benchmark = mssr.benchmark || {};
  const observability = mssr.observability || {};

  setText('mssr-structured', pct(benchmark.structuredRouteRate));
  setText('mssr-routes', num(benchmark.routeEvents));
  setText('mssr-continuity', pct(benchmark.correlatedRouteLoadCoverage));
  setText('mssr-orphans', num(benchmark.orphanLoadEvents));
  setText('mssr-required', pct(benchmark.requiredLoadCompliance));
  setText('mssr-required-count', num(benchmark.requiredSkillLoadsSatisfied) + ' / ' + num(benchmark.requiredSkillLoadsExpected));
  setText('mssr-success', pct(benchmark.outcomeSuccessRate));
  setText('mssr-outcomes', num(benchmark.attributedOutcomeTraces));

  const requiredCard = byId('mssr-required-card');
  if (requiredCard) requiredCard.dataset.tone = percentageTone(benchmark.requiredLoadCompliance, 90, 70);

  const baseline = observability.baselineAt ? dateTime(observability.baselineAt) : 'sin baseline';
  setText('mssr-window', 'Scope activo desde ' + baseline + ' · ' + num(mssr.traceCount) + ' trazas · ' + num(mssr.eventCount) + ' eventos.');
  setPill('mssr-scope', 'info', 'scope ' + (mssr.scope || observability.defaultScope || 'active'));

  renderMssrProgress(benchmark);
  renderMssrContextAssembly(mssr.contextAssembly || {});
  renderMssrAgentProfiles(mssr.agentProfiles || []);
  renderMssrEffortComparison(mssr.reasoningEffortComparison || []);
  renderSkillSelectionFeedback(mssr.intentAnalysis && mssr.intentAnalysis.selectionFeedback ? mssr.intentAnalysis.selectionFeedback : []);
  renderMssrLearningPriors(mssr.intentAnalysis && mssr.intentAnalysis.learning ? mssr.intentAnalysis.learning : null);
  renderSkillCounts('mssr-selected-skills', mssr.top && mssr.top.selectedSkills ? mssr.top.selectedSkills : [], 'Sin skills seleccionadas en la época activa.');
  renderSkillCounts('mssr-loaded-skills', mssr.top && mssr.top.loadedSkills ? mssr.top.loadedSkills : [], 'Sin skills cargadas en la época activa.');
  renderSkillOutcomes(mssr.top && mssr.top.skillOutcomes ? mssr.top.skillOutcomes : []);
}

function phaseLabel(value) {
  const labels = {
    discovery: 'descubrir',
    safety: 'seguridad',
    implementation: 'implementar',
    verification: 'verificar',
    persistence: 'persistir',
    maintenance: 'mantener',
  };
  return labels[value] || value || '—';
}

function cockpitTraceTone(status) {
  if (status === 'active') return 'ok';
  if (status === 'idle') return 'warn';
  return 'info';
}

function renderCockpitChecklist(checklist) {
  return (checklist || []).filter((item) => item.required || item.completed).map((item) => {
    const state = item.completed ? 'done' : item.current ? 'current' : 'pending';
    const mark = item.completed ? '✓' : item.current ? '→' : '·';
    return '<span class="cockpit-phase" data-state="' + state + '"><span>' + mark + '</span>' + esc(phaseLabel(item.phase)) + '</span>';
  }).join('');
}

function cockpitTaskIdentity(task, index) {
  return task && (task.taskKey || task.workflowKey || (task.traceIds || []).join('|')) || 'task-' + num(index || 0);
}

function cockpitTaskProjectLabel(task) {
  if (!task) return 'Proyecto';
  return (task.projects || []).length > 1 ? task.projects.join(' + ') : task.project || 'Proyecto';
}

function cockpitTaskLabel(task) {
  if (!task) return 'tarea observable';
  return task.workflowKey || task.taskKey || task.latestSummary || 'tarea observable';
}

function cockpitTraceNextLabel(trace) {
  const labels = { closed: 'cerrada', verify: 'toca verificar', persist: 'toca persistir', close: 'falta cerrar', intermediate: 'traza intermedia', continue: trace && trace.nextPhase ? 'toca ' + phaseLabel(trace.nextPhase) : 'continuar' };
  return labels[trace && trace.attentionKind] || (trace && trace.nextPhase ? 'toca ' + phaseLabel(trace.nextPhase) : 'continuar');
}

function renderCockpitTraceCard(trace, compact) {
  const tone = cockpitTraceTone(trace.status);
  const roleLabel = trace.traceRole === 'synthetic-test' ? 'prueba técnica' : trace.traceRole === 'technical-intermediate' ? 'traza técnica' : trace.traceRole === 'workflow-member' ? 'miembro de workflow' : null;
  const meta = [trace.project, trace.stage, roleLabel ? roleLabel + (trace.workflowTraceCount > 1 ? ' · ' + trace.workflowTraceCount + ' trazas relacionadas' : '') : (trace.workflowTraceCount > 1 ? trace.workflowTraceCount + ' trazas relacionadas' : null), clock(trace.latestAt), trace.model].filter(Boolean).join(' · ');
  return '<article class="cockpit-trace' + (compact ? ' cockpit-trace-compact' : '') + '" data-status="' + esc(trace.status) + '">' +
    '<div class="cockpit-trace-head"><div><strong>' + esc(trace.displayName || trace.workflowKey || trace.project || 'Tarea MSSR sin nombre') + '</strong><div class="cockpit-meta">' + esc(meta) + '</div></div>' +
    '<span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(cockpitTraceNextLabel(trace)) + '</span></span></div>' +
    '<div class="cockpit-trace-summary">' + esc(trace.summary || 'Traza MSSR técnica o intermedia sin descripción específica registrada.') + '</div>' +
    (compact ? '' : '<div class="cockpit-phase-row">' + renderCockpitChecklist(trace.checklist) + '</div>') +
    '</article>';
}

function groupCockpitTracesByTask(tasks, traces) {
  const byTask = new Map();
  const assigned = new Set();
  (tasks || []).forEach((task, index) => {
    const key = cockpitTaskIdentity(task, index);
    const ids = new Set(task.traceIds || []);
    const matched = (traces || []).filter((trace) => ids.has(trace.traceId));
    matched.forEach((trace) => assigned.add(trace.traceId));
    byTask.set(key, matched);
  });
  return { byTask, unassigned: (traces || []).filter((trace) => !assigned.has(trace.traceId)) };
}

function renderCockpitHumanTask(task, traceRows, index) {
  const needsClosure = task.needsClosureReview === true;
  const tone = needsClosure ? 'warn' : 'info';
  const projectLabel = cockpitTaskProjectLabel(task);
  const taskLabel = cockpitTaskLabel(task);
  const lineageCount = Number((task.parentTraceIds || []).length) + Number((task.supersedesTraceIds || []).length);
  const runtimeActivity = task.runtimeActivity || {};
  const runtimeLabel = runtimeActivity.active === true
    ? runtimeActivity.progressing === true ? ' · proceso vivo/progresando' : ' · proceso vivo/sin progreso reciente'
    : '';
  const openAttr = index === 0 ? ' open' : '';
  return '<details class="cockpit-human-task" data-needs-closure="' + (needsClosure ? 'true' : 'false') + '"' + openAttr + '>' +
    '<summary class="cockpit-human-task-summary"><div><strong>' + esc(projectLabel) + '</strong><span>' + esc(taskLabel) + '</span></div>' +
    '<span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(needsClosure ? 'revisar cierre' : task.nextGate || 'continuar') + '</span></span></summary>' +
    '<div class="cockpit-human-task-detail"><div class="cockpit-open-task-summary">' + esc(task.latestSummary || 'Sin summary humano explícito; se conserva la procedencia MSSR.') + '</div>' +
    '<div class="recent-detail">' + num((task.traceIds || []).length) + ' traza(s) vinculada(s) · última actividad ' + esc(dateTime(task.latestAt)) + (lineageCount > 0 ? ' · ' + num(lineageCount) + ' enlace(s) de lineage' : '') + esc(runtimeLabel) + '</div>' +
    (traceRows && traceRows.length ? '<details class="cockpit-task-evidence" data-ux-layer="detail"><summary>' + num(traceRows.length) + ' traza(s) técnica(s) vinculada(s)</summary><div class="cockpit-task-evidence-list">' + traceRows.map((trace) => renderCockpitTraceCard(trace, true)).join('') + '</div></details>' : '') +
    '</div></details>';
}

function renderCockpit(cockpit) {
  const root = cockpit || {};
  const counts = root.counts || {};
  const authority = root.authority || {};
  const focus = root.focus;
  const brief = root.morningBrief || {};
  const yesterday = brief.yesterday || {};
  const openTasks = brief.tasks || [];
  const lifecycleDebt = brief.lifecycleDebt || [];
  const contextInventory = root.contextInventory || {};
  const rolling30d = contextInventory.rolling30d || {};
  const closureReviewCount = Number(brief.lifecycleDebtTaskCount || brief.needsClosureReviewCount || 0);
  const activeTaskCount = Number(brief.openTaskCount || openTasks.length || 0);
  const traces = root.traces || [];
  const traceGroups = groupCockpitTracesByTask([...openTasks, ...lifecycleDebt], traces);

  setPill('cockpit-authority', authority.writesProjectTruth === false ? 'ok' : 'warn', authority.mode || 'projection-only');
  setPill('cockpit-trace-count', Number(counts.active || 0) + Number(counts.idle || 0) > 0 ? 'info' : 'ok',
    num(counts.active || 0) + ' activas · ' + num(counts.idle || 0) + ' pausadas');

  const orientationTarget = byId('cockpit-orientation');
  if (orientationTarget) {
    const humanNow = openTasks[0] || lifecycleDebt[0] || null;
    const currentTitle = humanNow
      ? cockpitTaskProjectLabel(humanNow) + ' · ' + cockpitTaskLabel(humanNow)
      : focus
        ? focus.displayName || focus.workflowKey || focus.project || 'Traza reciente'
        : 'Sin tarea humana abierta';
    const currentDetail = humanNow
      ? humanNow.latestSummary || 'Tarea MSSR abierta sin summary explícito.'
      : focus
        ? focus.summary || 'Sólo hay evidencia de traza reciente; no una tarea humana agrupada.'
        : 'No hay trabajo sustantivo abierto en la ventana observable.';
    const nextTitle = humanNow && humanNow.nextGate
      ? humanNow.nextGate
      : focus && focus.nextPhase
        ? phaseLabel(focus.nextPhase)
        : closureReviewCount > 0 ? 'revisar cierres pendientes' : 'sin gate pendiente';
    const nextDetail = humanNow
      ? 'Siguiente gate de la tarea humana · ' + num((humanNow.traceIds || []).length) + ' traza(s) agrupada(s).'
      : focus
        ? 'Derivado de la traza técnica más reciente; abrí lifecycle para auditarlo.'
        : 'La proyección no observa una continuación obligatoria.';
    const projectReviewCount = Number(counts.projectReview || 0);
    const projectWatchCount = Number(counts.projectWatch || 0);
    const attentionTitle = closureReviewCount > 0
      ? num(closureReviewCount) + ' tarea(s) con cierre para revisar'
      : projectReviewCount > 0
        ? num(projectReviewCount) + ' proyecto(s) en REVIEW'
        : projectWatchCount > 0
          ? num(projectWatchCount) + ' proyecto(s) en WATCH'
          : 'Sin decisión humana prioritaria';
    const attentionDetail = lifecycleDebt.length
      ? lifecycleDebt[0].latestSummary || 'Hay trabajo sustantivo sin outcome posterior observable.'
      : projectReviewCount > 0 || projectWatchCount > 0
        ? 'Project Health conserva la evidencia debajo; esta tarjeta sólo prioriza la señal.'
        : 'No se detecta deuda de lifecycle ni Project Health de atención inmediata.';
    const items = [
      { kind: 'now', label: 'Ahora', tone: humanNow ? 'ok' : focus ? 'info' : 'ok', title: currentTitle, detail: currentDetail },
      { kind: 'next', label: 'Siguiente', tone: humanNow || focus ? 'info' : 'ok', title: nextTitle, detail: nextDetail },
      { kind: 'attention', label: 'Atención', tone: closureReviewCount > 0 || projectReviewCount > 0 ? 'warn' : projectWatchCount > 0 ? 'info' : 'ok', title: attentionTitle, detail: attentionDetail },
    ];
    orientationTarget.innerHTML = items.map((item) => '<section class="cockpit-orientation-card" data-orientation="' + item.kind + '" data-tone="' + item.tone + '"><span>' + esc(item.label) + '</span><strong>' + esc(item.title) + '</strong><small>' + esc(item.detail) + '</small></section>').join('');
  }

  const focusTarget = byId('cockpit-focus');
  if (focusTarget) {
    if (!focus) {
      focusTarget.innerHTML = '<div class="empty-state">No hay trazas recientes para orientar.</div>';
    } else {
      const nextText = focus.closed ? 'cerrada' : focus.nextPhase ? 'siguiente: ' + phaseLabel(focus.nextPhase) : 'siguiente: continuar / cerrar lifecycle';
      focusTarget.innerHTML = '<div class="cockpit-focus-main">' +
        '<div class="cockpit-focus-heading"><span class="status-pill" data-tone="' + cockpitTraceTone(focus.status) + '"><span class="dot ' + cockpitTraceTone(focus.status) + '"></span><span>' + esc(focus.status) + '</span></span>' +
        '<strong>' + esc(focus.displayName || focus.workflowKey || focus.project || 'Tarea MSSR sin nombre') + '</strong></div>' +
        '<div class="cockpit-focus-summary">' + esc(focus.summary || 'Traza MSSR técnica o intermedia sin descripción específica registrada.') + '</div>' +
        '<div class="cockpit-meta">' + esc([focus.project, focus.stage, nextText, focus.model].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="cockpit-phase-row">' + renderCockpitChecklist(focus.checklist) + '</div>' +
      '</div>';
    }
  }
  setPill(
    'cockpit-return-status',
    activeTaskCount > 0 ? 'info' : closureReviewCount > 0 ? 'warn' : 'ok',
    activeTaskCount > 0
      ? num(activeTaskCount) + ' activa(s) · ' + num(closureReviewCount) + ' deuda MSSR'
      : closureReviewCount > 0
        ? num(closureReviewCount) + ' deuda MSSR para revisar'
        : 'sin pendientes observables',
  );
  const returnSummaryTarget = byId('cockpit-return-summary');
  if (returnSummaryTarget) {
    returnSummaryTarget.innerHTML = [
      { label: 'Ayer', value: num(yesterday.projectCount || 0) + ' proyectos', detail: num(yesterday.traceCount || 0) + ' trazas sustantivas observadas' },
      { label: 'Trabajo activo', value: num(activeTaskCount), detail: 'tareas sin recordatorio de cierre pendiente' },
      { label: 'Deuda MSSR', value: num(closureReviewCount), detail: num(brief.runtimeDeferredLifecycleDebtTaskCount || 0) + ' diferida(s) por proceso vivo · sin outcome visible requiere revisión explícita' },
      { label: 'Inventario', value: contextInventory.mode === 'cached' ? 'cache' : contextInventory.mode === 'refreshed' ? 'actualizado' : 'sin estado', detail: num(contextInventory.dailySnapshotCount || 0) + ' días guardados · ' + (contextInventory.refreshedAt ? dateTime(contextInventory.refreshedAt) : 'sin snapshot durable') },
    ].map((item) => '<div class="cockpit-return-stat"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.detail) + '</small></div>').join('');
  }

  const yesterdayTarget = byId('cockpit-yesterday');
  if (yesterdayTarget) {
    const summaries = yesterday.latestSummaries || [];
    const projects = yesterday.projects || [];
    yesterdayTarget.innerHTML = Number(yesterday.traceCount || 0) === 0
      ? '<div class="empty-state">No hay trabajo sustantivo MSSR observado para ' + esc(yesterday.date || 'ayer') + '.</div>'
      : '<div class="cockpit-return-meta"><strong>' + esc(yesterday.date || 'ayer') + '</strong><span>' + num(yesterday.traceCount || 0) + ' trazas · ' + num(yesterday.projectCount || 0) + ' proyectos</span></div>' +
        '<div class="cockpit-return-chips">' + projects.slice(0, 12).map((project) => '<span class="cockpit-chip">' + esc(project) + '</span>').join('') + '</div>' +
        (summaries.length ? '<div class="cockpit-return-list">' + summaries.slice(0, 6).map((item) => '<div class="cockpit-return-item"><strong>' + esc(item.project || 'Proyecto') + '</strong><span>' + esc(item.summary || '') + '</span></div>').join('') + '</div>' : '');
  }

  const openTaskTarget = byId('cockpit-open-tasks');
  if (openTaskTarget) {
    openTaskTarget.innerHTML = openTasks.length
      ? openTasks.slice(0, 10).map((task, index) => {
        const traceRows = traceGroups.byTask.get(cockpitTaskIdentity(task, index)) || [];
        return renderCockpitHumanTask(task, traceRows, index);
      }).join('')
      : '<div class="empty-state">No hay tareas sustantivas abiertas observables en la ventana semanal.</div>';
  }

  const lifecycleDebtTarget = byId('cockpit-lifecycle-debt');
  if (lifecycleDebtTarget) {
    lifecycleDebtTarget.innerHTML = lifecycleDebt.length ? lifecycleDebt.slice(0, 10).map((task) => {
      const packet = task.resumePacket || {};
      const taskLabel = task.taskKeySource === 'explicit-mssr'
        ? task.taskKey
        : packet.workflowKey || task.workflowKey || packet.lastKnownSummary || task.latestSummary || task.taskKey || 'deuda de lifecycle';
      const completedPhases = packet.completedPhases || task.completedPhases || [];
      const requiredPhases = packet.requiredPhases || task.requiredPhases || [];
      const phaseProgress = requiredPhases.length
        ? num(completedPhases.length) + '/' + num(requiredPhases.length) + ' fases · hechas: ' + (completedPhases.length ? completedPhases.map(phaseLabel).join(', ') : 'ninguna registrada')
        : completedPhases.length ? 'hechas: ' + completedPhases.map(phaseLabel).join(', ') : 'sin contrato de fases observable';
      const nextGate = packet.nextGate || task.nextGate || 'revisar si retomar / cerrar outcome';
      const evidence = packet.evidenceRef || task.evidenceRef;
      const lastStage = packet.lastKnownStage || task.latestStage || 'stage no registrado';
      return '<div class="cockpit-open-task" data-needs-closure="true">' +
        '<div class="cockpit-open-task-head"><div><strong>' + esc(packet.project || task.project || 'Proyecto') + '</strong><span>' + esc(taskLabel) + '</span></div>' +
        '<span class="status-pill" data-tone="warn"><span class="dot warn"></span><span>' + esc(nextGate) + '</span></span></div>' +
        '<div class="cockpit-open-task-summary">' + esc(packet.lastKnownSummary || task.latestSummary || 'Trabajo sustantivo sin outcome posterior observable.') + '</div>' +
        '<div class="recent-detail">último stage: ' + esc(lastStage) + ' · ' + esc(phaseProgress) + ' · actividad ' + esc(dateTime(packet.latestAt || task.latestAt)) + '</div>' +
        (evidence ? '<div class="recent-detail">evidencia: ' + esc(evidence) + '</div>' : '') +
        '<div class="recent-detail">procedencia: ' + num((packet.traceIds || task.traceIds || []).length) + ' traza(s) · revisar antes de retomar o cerrar</div>' +
      '</div>';
    }).join('') : '<div class="empty-state">No hay deuda MSSR humana separada del trabajo activo.</div>';
  }

  const workspaceMap = root.workspaceMap || {};
  const workspaceCounts = workspaceMap.counts || {};
  const workspaceProjects = workspaceMap.projects || [];
  const workspaceReviewCount = Number(workspaceCounts['review-needed'] || 0);
  const workspaceActiveCount = Number(workspaceCounts.active || 0);
  setPill(
    'cockpit-workspace-status',
    workspaceReviewCount > 0 ? 'warn' : workspaceActiveCount > 0 ? 'ok' : 'info',
    workspaceReviewCount > 0 ? num(workspaceReviewCount) + ' para revisar · ' + num(workspaceActiveCount) + ' activos' : num(workspaceActiveCount) + ' activos · mapa al día',
  );
  const workspaceSummaryTarget = byId('cockpit-workspace-summary');
  if (workspaceSummaryTarget) {
    workspaceSummaryTarget.innerHTML = [
      { label: 'Activos', value: num(workspaceCounts.active || 0), detail: 'tarea abierta o gate MSSR observable' },
      { label: 'Revisar', value: num(workspaceCounts['review-needed'] || 0), detail: 'cierre/clasificación necesita decisión humana' },
      { label: 'Pausados', value: num(workspaceCounts.paused || 0), detail: 'sin actividad reciente; no significa terminado' },
      { label: 'Experimentos', value: num(workspaceCounts.experimental || 0), detail: 'marcador explícito experiment/prototype/spike' },
      { label: 'Terminados', value: num(workspaceCounts.finished || 0), detail: 'sólo con estado terminal explícito del proyecto owner' },
      { label: 'Reemplazados', value: num(workspaceCounts['abandoned-or-replaced'] || 0), detail: 'abandono/reemplazo declarado por el proyecto owner' },
    ].map((item) => '<div class="cockpit-weekly-stat"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.detail) + '</small></div>').join('');
  }
  const workspaceProjectTarget = byId('cockpit-workspace-projects');
  if (workspaceProjectTarget) {
    const workspaceLabels = {
      active: 'activo',
      'review-needed': 'revisar',
      paused: 'pausado',
      finished: 'terminado',
      experimental: 'experimental',
      'abandoned-or-replaced': 'abandonado / reemplazado',
    };
    const workspaceTones = {
      active: 'ok',
      'review-needed': 'warn',
      paused: 'info',
      finished: 'ok',
      experimental: 'info',
      'abandoned-or-replaced': 'info',
    };
    workspaceProjectTarget.innerHTML = workspaceProjects.length ? workspaceProjects.map((project) => {
      const classification = project.classification || {};
      const state = classification.state || 'review-needed';
      const tone = workspaceTones[state] || 'info';
      const task = (project.currentTasks || [])[0] || null;
      const taskText = task && task.summary ? task.summary : project.latestSummary || 'Sin tarea humana abierta resumida.';
      const gitText = project.gitClean === true
        ? 'clean'
        : project.gitClean === false
          ? num(project.gitPressure || 0) + ' cambios locales'
          : 'Git no observado';
      const gitTone = project.gitClean === true ? 'ok' : project.gitClean === false ? 'warn' : 'info';
      return '<tr>' +
        '<td><strong>' + esc(project.name || 'Proyecto') + '</strong><div class="recent-detail">última evidencia ' + esc(dateTime(project.latestAt)) + '</div></td>' +
        '<td><span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(workspaceLabels[state] || state) + '</span></span><div class="recent-detail">' + esc((classification.confidence || 'low') + ' · ' + (classification.basis || 'sin base')) + '</div></td>' +
        '<td><div>' + esc(taskText) + '</div><div class="recent-detail">' + num(project.openTaskCount || 0) + ' tarea(s) abierta(s) · ' + esc(classification.reason || '') + '</div></td>' +
        '<td><span class="status-pill" data-tone="' + gitTone + '"><span class="dot ' + gitTone + '"></span><span>' + esc(gitText) + '</span></span><div class="recent-detail">' + esc(project.branch || project.remoteState || 'sin branch observada') + '</div></td>' +
        '<td><strong>' + esc(project.nextGate || 'revisar') + '</strong></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="5" class="muted">No hay proyectos con evidencia suficiente dentro de la ventana observable.</td></tr>';
  }

  const capabilities = root.capabilities || {};
  const capabilityFamilies = capabilities.families || [];
  const capabilitySkills = capabilities.skills || {};
  const capabilityReviewCount = capabilityFamilies.filter((family) => family.status === 'review').length + (capabilitySkills.status === 'review' ? 1 : 0);
  setPill(
    'cockpit-capability-status',
    capabilityReviewCount > 0 ? 'warn' : 'ok',
    capabilityReviewCount > 0 ? num(capabilityReviewCount) + ' fuente(s) requieren probe/revisión' : 'catálogo disponible',
  );
  const capabilitySummaryTarget = byId('cockpit-capability-summary');
  if (capabilitySummaryTarget) {
    capabilitySummaryTarget.innerHTML = [
      { label: 'Tools registradas', value: num(capabilities.toolCount || 0), detail: num(capabilities.familyCount || 0) + ' familias runtime' },
      { label: 'Skills observadas', value: num(capabilitySkills.catalogSkills || 0), detail: num(capabilitySkills.ownedSkills || 0) + ' propias · ' + num(capabilitySkills.explicitRouting || 0) + ' routing explícito' },
      { label: 'Workflow guides', value: num(capabilities.workflowGuideCount || 0), detail: 'procedimientos reutilizables del Bridge' },
      { label: 'Provider-dependent', value: num(capabilityFamilies.filter((family) => family.status === 'review').length), detail: 'registradas, probe live sólo bajo demanda' },
    ].map((item) => '<div class="cockpit-weekly-stat"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.detail) + '</small></div>').join('');
  }
  const capabilityFamilyTarget = byId('cockpit-capability-families');
  if (capabilityFamilyTarget) {
    capabilityFamilyTarget.innerHTML = capabilityFamilies.length ? capabilityFamilies.slice(0, 24).map((family) => {
      const tone = family.status === 'available' ? 'ok' : family.status === 'review' ? 'warn' : 'info';
      return '<div class="cockpit-capability-family">' +
        '<div><strong>' + esc(family.label || family.family || 'Capability') + '</strong><span>' + num(family.toolCount || 0) + ' tools · ' + num(family.readOnlyCount || 0) + ' lectura · ' + num(family.mutableCount || 0) + ' mutables</span></div>' +
        '<span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + esc(family.status === 'available' ? 'registrada' : 'probe live pendiente') + '</span></span>' +
      '</div>';
    }).join('') : '<div class="empty-state">No hay catálogo runtime disponible.</div>';
  }

  const weekly = root.weekly || {};
  const weeklyProjects = weekly.projects || [];
  setPill('cockpit-weekly-window', 'info', num(weekly.days || 7) + ' días · ' + num(weekly.projectCount || 0) + ' proyectos');
  const weeklySummaryTarget = byId('cockpit-weekly-summary');
  if (weeklySummaryTarget) {
    const weeklyCommits = weeklyProjects.reduce((total, project) => total + Number(project.commitCount || 0), 0);
    const dirtyProjects = weeklyProjects.filter((project) => project.gitClean === false).length;
    const localOnlyProjects = weeklyProjects.filter((project) => project.remoteState === 'local-only').length;
    weeklySummaryTarget.innerHTML = [
      { label: 'Proyectos observados', value: num(weekly.projectCount || 0), detail: num(weekly.substantiveTraceCount || 0) + ' trazas con trabajo' },
      { label: 'Trazas MSSR', value: num(weekly.traceCount || 0), detail: 'historial preservado · scope ' + (weekly.scope || 'all') },
      { label: 'Commits en ventana', value: num(weeklyCommits), detail: 'sólo repos correlacionados' },
      { label: 'Repos con cambios', value: num(dirtyProjects), detail: num(localOnlyProjects) + ' sin remote configurado' },
    ].map((item) => '<div class="cockpit-weekly-stat"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.detail) + '</small></div>').join('');
  }

  const weeklyProjectTarget = byId('cockpit-weekly-projects');
  if (weeklyProjectTarget) {
    const remoteLabels = {
      'git-unavailable': 'Git no observado',
      'local-only': 'sólo local',
      'remote-no-upstream': 'remote sin upstream',
      'diverged-local-tracking': 'tracking divergente',
      'ahead-local-tracking': 'por delante',
      'behind-local-tracking': 'por detrás',
      'aligned-local-tracking': 'alineado',
    };
    weeklyProjectTarget.innerHTML = weeklyProjects.length ? weeklyProjects.map((project) => {
      const localChanges = Number(project.trackedChanges || 0) + Number(project.untrackedChanges || 0);
      const gitTone = project.gitClean === true ? 'ok' : project.gitClean === false ? 'warn' : 'info';
      const gitLabel = project.gitClean === true ? 'clean' : project.gitClean === false ? num(localChanges) + ' cambios' : 'sin lectura';
      const remoteTone = project.remoteState === 'diverged-local-tracking' ? 'bad'
        : project.remoteState === 'ahead-local-tracking' || project.remoteState === 'behind-local-tracking' ? 'warn'
          : project.remoteState === 'aligned-local-tracking' ? 'ok' : 'info';
      const remoteLabel = remoteLabels[project.remoteState] || project.remoteState || '—';
      const commitDetail = project.latestCommitSubject
        ? '<div class="recent-detail">' + esc((project.latestCommitHash || '').slice(0, 8) + ' · ' + project.latestCommitSubject) + '</div>'
        : '<div class="recent-detail">sin commit en la ventana</div>';
      return '<tr>' +
        '<td><strong>' + esc(project.name) + '</strong><div class="recent-detail">' + esc(project.latestSummary || 'sin resumen explícito') + '</div></td>' +
        '<td>' + num(project.substantiveTraceCount || 0) + ' trazas<div class="recent-detail">' + num(project.substantiveToolCalls || 0) + ' calls · ' + num((project.workflowKeys || []).length) + ' workflows</div></td>' +
        '<td><span class="status-pill" data-tone="' + gitTone + '"><span class="dot ' + gitTone + '"></span><span>' + esc(gitLabel) + '</span></span><div class="recent-detail">' + esc(project.branch || project.gitError || 'branch no observada') + '</div></td>' +
        '<td><strong>' + num(project.commitCount || 0) + '</strong>' + commitDetail + '</td>' +
        '<td><span class="status-pill" data-tone="' + remoteTone + '"><span class="dot ' + remoteTone + '"></span><span>' + esc(remoteLabel) + '</span></span><div class="recent-detail">' + esc(project.upstream || (project.remotes || []).join(', ') || 'sin tracking remoto local') + '</div></td>' +
        '<td>' + esc(project.pendingHint || '—') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="6" class="muted">No hay proyectos MSSR correlacionados en la ventana semanal.</td></tr>';
  }

  const historyCoverage = Math.max(0, Math.min(1, Number(rolling30d.coverageRatio || 0)));
  const historyCoveragePct = Math.round(historyCoverage * 100);
  const historySnapshots = Number(rolling30d.snapshotCount || 0);
  const historyDays = Number(rolling30d.days || 30);
  setPill(
    'cockpit-history-window',
    rolling30d.coverage === 'complete' ? 'ok' : historySnapshots > 0 ? 'warn' : 'info',
    num(historyDays) + ' días · ' + num(historyCoveragePct) + '% cobertura',
  );
  const historySummaryTarget = byId('cockpit-history-summary');
  if (historySummaryTarget) {
    historySummaryTarget.innerHTML = [
      { label: 'Cobertura', value: num(historySnapshots) + '/' + num(historyDays) + ' días', detail: rolling30d.coverage === 'complete' ? 'ventana diaria completa' : 'parcial · se completa con snapshots diarios' },
      { label: 'Días con actividad', value: num(rolling30d.activityDayCount || 0), detail: num(rolling30d.traceDayObservations || 0) + ' observaciones de trazas por día' },
      { label: 'Proyectos', value: num(rolling30d.projectCount || 0), detail: 'únicos observados en snapshots retenidos' },
      { label: 'Workflows', value: num(rolling30d.workflowCount || 0), detail: 'identidades observadas sin nuevo scope=all' },
    ].map((item) => '<div class="cockpit-weekly-stat"><span>' + esc(item.label) + '</span><strong>' + esc(item.value) + '</strong><small>' + esc(item.detail) + '</small></div>').join('');
  }
  const historyProjectTarget = byId('cockpit-history-projects');
  if (historyProjectTarget) {
    const historySummaries = new Map((rolling30d.latestSummaries || []).map((item) => [String(item.project || '').toLowerCase(), item]));
    const historyProjects = rolling30d.projects || [];
    historyProjectTarget.innerHTML = historyProjects.length ? historyProjects.slice(0, 24).map((project) => {
      const summary = historySummaries.get(String(project.name || '').toLowerCase());
      return '<tr>' +
        '<td><strong>' + esc(project.name || 'Proyecto') + '</strong></td>' +
        '<td>' + num(project.activeDays || 0) + '</td>' +
        '<td>' + esc(project.lastSeenDate || '—') + '</td>' +
        '<td>' + esc(summary?.summary || 'Sin resumen diario retenido para este proyecto.') + (summary?.date ? '<div class="recent-detail">snapshot ' + esc(summary.date) + '</div>' : '') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="4" class="muted">Todavía no hay snapshots diarios suficientes para una vista de 30 días.</td></tr>';
  }

  const traceTarget = byId('cockpit-traces');
  if (traceTarget) {
    traceTarget.innerHTML = traces.length
      ? traces.map((trace) => renderCockpitTraceCard(trace, false)).join('')
      : '<div class="empty-state">Sin trazas MSSR recientes.</div>';
  }

  const projectTarget = byId('cockpit-projects');
  const projects = root.projects || [];
  if (projectTarget) {
    projectTarget.innerHTML = projects.length ? projects.map((project) => {
      const healthTone = project.healthLevel === 'review' ? 'bad' : project.healthLevel === 'watch' ? 'warn' : project.healthLevel === 'ok' ? 'ok' : 'info';
      const projectLocalChanges = Number(project.trackedChanges || 0) + Number(project.untrackedChanges || 0);
      const gitLabel = project.gitClean === true ? 'clean' : project.gitClean === false ? num(projectLocalChanges) + ' cambios' : 'sin lectura';
      const gitTone = project.gitClean === true ? 'ok' : project.gitClean === false ? 'warn' : 'info';
      return '<tr>' +
        '<td><strong>' + esc(project.name) + '</strong><div class="recent-detail">' + esc(project.relativeRoot || '') + '</div></td>' +
        '<td>' + num(project.activeTraces) + ' abiertas<div class="recent-detail">' + num(project.recentTraces) + ' recientes</div></td>' +
        '<td><span class="status-pill" data-tone="' + healthTone + '"><span class="dot ' + healthTone + '"></span><span>' + esc(project.healthLevel) + '</span></span><div class="recent-detail">' + num(project.findingCount) + ' findings · ' + num(project.referenceCandidateCount || 0) + ' refs candidatas' + (Number(project.referenceHighPriorityCount || 0) > 0 ? ' · ' + num(project.referenceHighPriorityCount) + ' high' : '') + '</div></td>' +
        '<td><span class="status-pill" data-tone="' + gitTone + '"><span class="dot ' + gitTone + '"></span><span>' + esc(gitLabel) + '</span></span><div class="recent-detail">' + esc(project.branch || project.gitError || 'branch no observada') + '</div></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="4" class="muted">Todavía no hay proyectos correlacionados con las trazas recientes.</td></tr>';
  }

  const maintenanceTarget = byId('cockpit-maintenance');
  if (maintenanceTarget) {
    const refs = root.referenceLifecycle || {};
    const referenceCounts = refs.candidates || {};
    const referenceValue = refs.candidateReferenceProjectionAvailable
      ? num(referenceCounts.total || 0) + ' candidatas · '
        + num(referenceCounts.high || 0) + ' high · '
        + num(referenceCounts.medium || 0) + ' medium · '
        + num(referenceCounts.low || 0) + ' low'
      : 'snapshot pendiente';
    const referenceTone = !refs.candidateReferenceProjectionAvailable
      ? 'info'
      : Number(referenceCounts.high || 0) > 0 ? 'warn' : Number(referenceCounts.total || 0) > 0 ? 'info' : 'ok';
    const items = [
      { label: 'Project Health REVIEW', value: num(counts.projectReview || 0), tone: Number(counts.projectReview || 0) > 0 ? 'bad' : 'ok' },
      { label: 'Project Health WATCH', value: num(counts.projectWatch || 0), tone: Number(counts.projectWatch || 0) > 0 ? 'warn' : 'ok' },
      { label: 'Referencias documentales', value: referenceValue, tone: referenceTone },
    ];
    maintenanceTarget.innerHTML = items.map((item) => '<div class="cockpit-maintenance-row"><span>' + esc(item.label) + '</span><span class="status-pill" data-tone="' + item.tone + '"><span class="dot ' + item.tone + '"></span><span>' + esc(item.value) + '</span></span></div>').join('') +
      '<div class="cockpit-maintenance-note">' + esc(refs.note || authority.note || '') + '</div>';
  }
}

function updateSystem(status, overview, mssr) {
  const observability = mssr.observability || {};
  const privacy = mssr.privacy || {};
  setText('system-server', (status.server && status.server.name ? status.server.name : '—') + ' ' + (status.server && status.server.version ? 'v' + status.server.version : ''));
  setText('system-node', status.node || '—');
  setText('system-pid', status.pid || '—');
  setText('system-uptime', humanDuration(status.uptimeSeconds));
  setText('system-host', (status.host || '—') + ':' + (status.port || '—'));
  setText('system-mcp-path', status.mcpPath || '—');
  setText('system-started', dateTime(status.startedAt));
  setText('system-max-sessions', status.limits && status.limits.maxSessions !== undefined ? num(status.limits.maxSessions) : '—');
  setText('system-db', overview.sqlitePath || '—');
  setText('system-jsonl', overview.jsonlPath || '—');
  setText('system-mssr-epoch', observability.activeEpoch || '—');
  setText('system-mssr-baseline', dateTime(observability.baselineAt));
  setText('system-mssr-contract', observability.contractVersion || '—');
  setText('system-mssr-scope', observability.defaultScope || '—');
  setText('system-privacy', privacy.rawPromptsStored === false && privacy.transcriptsStored === false ? 'sin prompts ni transcripts crudos' : 'revisar configuración');
  setText('system-active-events', num(mssr.eventCount));
}

function activateTab(name, focusButton) {
  const buttons = [...document.querySelectorAll('[data-tab]')];
  const panels = [...document.querySelectorAll('[data-panel]')];
  const valid = buttons.some((button) => button.dataset.tab === name);
  const targetName = valid ? name : 'summary';
  buttons.forEach((button) => {
    const active = button.dataset.tab === targetName;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active && focusButton) button.focus();
    if (active) {
      const rail = button.parentElement;
      if (rail && rail.scrollWidth > rail.clientWidth + 4) {
        const left = button.offsetLeft - Math.max(0, (rail.clientWidth - button.offsetWidth) / 2);
        rail.scrollTo({ left: Math.max(0, left), behavior: focusButton ? 'smooth' : 'auto' });
      }
    }
  });
  panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== targetName; });
  if (location.hash !== '#' + targetName) history.replaceState(null, '', '#' + targetName);
}

function setupTabs() {
  const buttons = [...document.querySelectorAll('[data-tab]')];
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab || 'summary', false));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      activateTab(buttons[nextIndex].dataset.tab || 'summary', true);
    });
  });
  activateTab(location.hash.replace('#', '') || 'summary', false);
}

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(url + ' → HTTP ' + response.status);
  return await response.json();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const snapshot = await getJson('/api/dashboard/snapshot');
    const { status, overview, summary, recent, errors, timeline, mssr, skillHealth, projectHealth, runtimeHealth, toolAudit, toolNotices, cockpit } = snapshot;

    updateHealth(status, overview, mssr);
    updateSummary(status, overview, summary, recent, timeline, mssr);
    updateActivity(summary, recent, timeline);
    updateMssr(mssr);
    renderSkillHealth(skillHealth);
    renderProjectHealth(projectHealth);
    renderRuntimeHealth(runtimeHealth);
    syncMssrFamilySummaries(mssr);
    updateToolPortfolio(toolAudit);
    updateToolNotices(toolNotices);
    renderCockpit(cockpit);
    updateSystem(status, overview, mssr);
    renderErrors(errors.errors || []);
    updateHome(snapshot);
    updateWork(snapshot);
    setText('updated-at', 'actualizado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (error) {
    setDot('overall-dot', 'bad');
    const overall = byId('overall-status');
    if (overall) overall.dataset.tone = 'bad';
    setText('overall-text', 'error de actualización');
    setText('home-status-sentence', 'No se pudo actualizar el snapshot del dashboard. Revisá el estado técnico en Inspector.');
    setPill('shell-work-status', 'bad', 'snapshot con error');
    setText('updated-at', String(error && error.message ? error.message : error));
  } finally {
    refreshing = false;
  }
}

setupToolPortfolioFilters();
setupActivityControls();
setupMssrControls();
setupV2Tabs();
setupWorkControls();
setupLegacyControls();
setupInspector();
setupTabs();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('hashchange', () => activateTab(location.hash.replace('#', '') || 'summary', false));
`;
