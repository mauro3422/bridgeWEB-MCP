export const dashboardScript = `
const numberFormat = new Intl.NumberFormat('es-AR');
const decimalFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
let refreshing = false;

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

function renderTimeline(targetId, startId, endId, inputRows) {
  const target = byId(targetId);
  if (!target) return;
  const rows = [...(inputRows || [])].sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">Sin actividad registrada en el período disponible.<br />El panel se completará cuando existan llamadas operativas.</div>';
    setText(startId, 'sin datos');
    setText(endId, 'sin datos');
    return;
  }
  const maxCalls = Math.max(1, ...rows.map((row) => Number(row.calls || 0)));
  target.innerHTML = rows.map((row) => {
    const calls = Number(row.calls || 0);
    const errors = Number(row.errors || 0);
    const height = 8 + (calls / maxCalls) * 136;
    const label = clock(row.bucket) + ' · ' + calls + ' llamadas · ' + errors + ' errores';
    return '<span class="timeline-bar" data-errors="' + (errors > 0 ? 'true' : 'false') + '" style="--height:' + height.toFixed(1) + 'px" title="' + esc(label) + '" aria-label="' + esc(label) + '"></span>';
  }).join('');
  setText(startId, dateTime(rows[0].bucket));
  setText(endId, dateTime(rows[rows.length - 1].bucket));
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

function recentStatus(ok) {
  const tone = Number(ok) === 1 ? 'ok' : 'bad';
  const label = Number(ok) === 1 ? 'ok' : 'error';
  return '<span class="status-pill" data-tone="' + tone + '"><span class="dot ' + tone + '"></span><span>' + label + '</span></span>';
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
      (includeDetail ? '<td>' + esc(ms(row.duration_ms)) + '</td><td>' + recentStatus(row.ok) + '</td><td class="recent-detail">' + esc(detail) + '</td>' : '<td>' + recentStatus(row.ok) + '</td><td>' + esc(ms(row.duration_ms)) + '</td>') +
    '</tr>';
  }).join('');
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
    '<td><code>' + esc(exposed(row.caller, 'cliente no identificado')) + '</code></td>' +
    '<td>' + esc(exposed(row.model, 'modelo no expuesto')) + '</td>' +
    '<td>' + esc(exposed(row.reasoning_effort, 'esfuerzo no expuesto')) + '</td>' +
    '<td><code>' + esc(exposed(row.task_key, 'tarea no identificada')) + '</code><div class="recent-detail" title="' + esc(row.session_key || 'unknown') + '">' +
      esc(row.session_key && row.session_key !== 'unknown' ? 'sesión ' + String(row.session_key).slice(-10) : 'sesión no expuesta') + '</div></td>' +
    '<td><code>' + esc(exposed(row.project, 'proyecto primario no expuesto')) + '</code><div class="recent-detail">' +
      esc(row.related_project && row.related_project !== 'none' ? 'relacionados: ' + row.related_project : 'sin repositorio auxiliar') + '</div></td>' +
    '<td>' + num(row.calls) + '</td>' +
    '<td title="' + esc(num(row.traced_calls) + ' / ' + num(row.eligible_calls) + ' tools elegibles') + '">' +
      pct(row.mssr_trace_coverage) + '<div class="recent-detail">' + num(row.untraced_calls) + ' sin traza</div></td>' +
    '<td>' + num(row.error_calls) + '</td>' +
    '<td>' + ms(row.avg_duration_ms) + '</td>' +
  '</tr>').join('');
}

function compactErrorMessage(value) {
  const text = String(value || 'Error sin detalle').replace(/\s+/g, ' ').trim();
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
    return '<details class="error-item">' +
      '<summary class="error-summary">' +
        '<span class="error-time">' + esc(clock(row.started_at)) + '</span>' +
        '<span class="error-tool">' + esc(row.tool) + '</span>' +
        '<span class="error-message">' + esc(compactErrorMessage(raw)) + '</span>' +
        '<span class="error-duration">' + esc(ms(row.duration_ms)) + '</span>' +
      '</summary>' +
      '<div class="error-detail"><div class="muted">' + esc(profile) + '</div><pre>' + esc(raw) + '</pre></div>' +
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

function profileIdentity(row) {
  return '<code>' + esc(exposed(row.caller, 'cliente no identificado')) + '</code><div class="recent-detail">' +
    esc(exposed(row.model, 'modelo no expuesto') + ' · ' + exposed(row.reasoningEffort, 'esfuerzo no expuesto')) + '</div>';
}

function renderMssrAgentProfiles(inputRows) {
  const activation = byId('mssr-agent-activation');
  const results = byId('mssr-agent-results');
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
}

function updateActivity(summary, recent, timeline) {
  renderTimeline('activity-timeline', 'activity-timeline-start', 'activity-timeline-end', timeline.timeline || []);
  renderTools('activity-tools', summary.summary || [], 12);
  renderRecent('activity-recent', recent.recent || [], 20, true);
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
  renderMssrAgentProfiles(mssr.agentProfiles || []);
  renderSkillCounts('mssr-selected-skills', mssr.top && mssr.top.selectedSkills ? mssr.top.selectedSkills : [], 'Sin skills seleccionadas en la época activa.');
  renderSkillCounts('mssr-loaded-skills', mssr.top && mssr.top.loadedSkills ? mssr.top.loadedSkills : [], 'Sin skills cargadas en la época activa.');
  renderSkillOutcomes(mssr.top && mssr.top.skillOutcomes ? mssr.top.skillOutcomes : []);
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
    const [status, overview, summary, recent, errors, timeline, mssr] = await Promise.all([
      getJson('/status'),
      getJson('/api/metrics/overview?scope=active'),
      getJson('/api/metrics/summary?limit=12&scope=active'),
      getJson('/api/metrics/recent?limit=20&scope=active'),
      getJson('/api/metrics/errors?limit=20&scope=active'),
      getJson('/api/metrics/timeline?limit=500&scope=active'),
      getJson('/api/mssr/summary?days=30&scope=active')
    ]);

    updateHealth(status, overview, mssr);
    updateSummary(status, overview, summary, recent, timeline, mssr);
    updateActivity(summary, recent, timeline);
    updateMssr(mssr);
    updateSystem(status, overview, mssr);
    renderErrors(errors.errors || []);
    setText('updated-at', 'actualizado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (error) {
    setDot('overall-dot', 'bad');
    const overall = byId('overall-status');
    if (overall) overall.dataset.tone = 'bad';
    setText('overall-text', 'error de actualización');
    setText('updated-at', String(error && error.message ? error.message : error));
  } finally {
    refreshing = false;
  }
}

setupTabs();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('hashchange', () => activateTab(location.hash.replace('#', '') || 'summary', false));
`;
