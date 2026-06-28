function baseHtml(title: string, body: string, compact = false) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #121a2f;
      --panel2: #17213a;
      --text: #e7edf8;
      --muted: #98a8c7;
      --ok: #45d483;
      --warn: #ffcc66;
      --bad: #ff6b7a;
      --line: rgba(255,255,255,.09);
      --accent: #7aa7ff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: radial-gradient(circle at top left, #18294b 0, var(--bg) 34rem); color: var(--text); }
    a { color: var(--accent); }
    header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: ${compact ? "0.8rem" : "1.2rem 1.4rem"}; border-bottom: 1px solid var(--line); position: sticky; top: 0; backdrop-filter: blur(10px); background: rgba(11, 16, 32, .72); z-index: 5; }
    h1 { font-size: ${compact ? "1rem" : "1.35rem"}; margin: 0; letter-spacing: .02em; }
    .sub { color: var(--muted); font-size: .82rem; }
    main { padding: ${compact ? ".75rem" : "1.2rem"}; max-width: ${compact ? "520px" : "1280px"}; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: .9rem; }
    .card { background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.025)); border: 1px solid var(--line); border-radius: 16px; padding: 1rem; box-shadow: 0 18px 40px rgba(0,0,0,.22); }
    .span3 { grid-column: span 3; } .span4 { grid-column: span 4; } .span6 { grid-column: span 6; } .span8 { grid-column: span 8; } .span12 { grid-column: span 12; }
    @media (max-width: 900px) { .span3, .span4, .span6, .span8 { grid-column: span 12; } }
    .metric { font-size: ${compact ? "1.3rem" : "2rem"}; font-weight: 700; margin-top: .25rem; }
    .label { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
    .pill { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid var(--line); border-radius: 999px; padding: .3rem .55rem; color: var(--muted); font-size: .78rem; }
    .dot { width: .55rem; height: .55rem; border-radius: 99px; background: var(--muted); display: inline-block; }
    .dot.ok { background: var(--ok); } .dot.bad { background: var(--bad); } .dot.warn { background: var(--warn); }
    table { width: 100%; border-collapse: collapse; font-size: .84rem; }
    th, td { border-bottom: 1px solid var(--line); padding: .55rem .35rem; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .barrow { display: grid; grid-template-columns: minmax(8rem, 1fr) 4rem 6rem; align-items: center; gap: .7rem; margin: .55rem 0; }
    .bar { height: .65rem; border-radius: 99px; overflow: hidden; background: rgba(255,255,255,.08); }
    .bar > i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), #9fe0ff); border-radius: inherit; }
    .timeline { display: flex; gap: .18rem; align-items: end; min-height: 110px; border-bottom: 1px solid var(--line); padding-top: .5rem; }
    .tick { flex: 1; min-width: 5px; background: linear-gradient(180deg, #7aa7ff, #4d72c9); border-radius: 4px 4px 0 0; position: relative; }
    .tick.error { background: linear-gradient(180deg, var(--bad), #aa3040); }
    code { background: rgba(255,255,255,.08); padding: .12rem .3rem; border-radius: 6px; }
    .muted { color: var(--muted); }
    .small { font-size: .78rem; }
    .right { text-align: right; }
    .hide-compact { display: ${compact ? "none" : "block"}; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

const sharedScript = `
const fmt = new Intl.NumberFormat('es-AR');
const shortTime = (iso) => iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
const num = (v) => fmt.format(Number(v || 0));
const ms = (v) => num(Math.round(Number(v || 0))) + ' ms';
async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return await res.json();
}
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function okDot(id, ok) { const el = document.getElementById(id); if (el) el.className = 'dot ' + (ok ? 'ok' : 'bad'); }
function barRows(rows) {
  const max = Math.max(1, ...rows.map(r => Number(r.calls || 0)));
  return rows.map(r => '<div class="barrow"><div><strong>' + r.tool + '</strong><div class="muted small">err ' + num(r.error_calls) + ' · avg ' + ms(r.avg_duration_ms) + '</div></div><div class="right">' + num(r.calls) + '</div><div class="bar"><i style="width:' + Math.max(4, (Number(r.calls || 0) / max) * 100) + '%"></i></div></div>').join('');
}
function recentRows(rows) {
  return rows.map(r => '<tr><td>' + shortTime(r.started_at) + '</td><td><code>' + r.tool + '</code></td><td>' + ms(r.duration_ms) + '</td><td>' + (Number(r.ok) === 1 ? '<span class="pill"><span class="dot ok"></span>ok</span>' : '<span class="pill"><span class="dot bad"></span>error</span>') + '</td><td class="muted small">' + (r.error || r.input_keys || '') + '</td></tr>').join('');
}
function timelineBars(rows) {
  const max = Math.max(1, ...rows.map(r => Number(r.calls || 0)));
  return rows.map(r => '<div class="tick ' + (Number(r.errors || 0) > 0 ? 'error' : '') + '" title="' + shortTime(r.bucket) + ' · calls ' + r.calls + ' · errors ' + r.errors + '" style="height:' + Math.max(6, (Number(r.calls || 0) / max) * 100) + '%"></div>').join('');
}
`;

export function renderDashboardHtml() {
  return baseHtml("Bridge MCP Dashboard", `
<header>
  <div>
    <h1>Bridge MCP Dashboard</h1>
    <div class="sub">MauroPrime · HTTP production-candidate · auto-refresh 5s</div>
  </div>
  <div class="pill"><span id="ready-dot" class="dot"></span><span id="ready-text">checking...</span></div>
</header>
<main>
  <div class="grid">
    <section class="card span3"><div class="label">Tool calls</div><div id="total-calls" class="metric">-</div></section>
    <section class="card span3"><div class="label">Errores</div><div id="total-errors" class="metric">-</div></section>
    <section class="card span3"><div class="label">Avg duration</div><div id="avg-duration" class="metric">-</div></section>
    <section class="card span3"><div class="label">Sesiones HTTP</div><div id="sessions" class="metric">-</div><div class="muted small">anon <span id="anonymous">-</span></div></section>
    <section class="card span8"><div class="label">Actividad por bloques de 5 minutos</div><div id="timeline" class="timeline"></div></section>
    <section class="card span4"><div class="label">Runtime</div><p class="small"><strong>PID:</strong> <span id="pid">-</span></p><p class="small"><strong>Uptime:</strong> <span id="uptime">-</span></p><p class="small"><strong>DB:</strong> <span id="dbpath" class="muted">-</span></p><p class="small"><a href="/widget">abrir widget compacto</a></p></section>
    <section class="card span6"><div class="label">Tools más usadas</div><div id="summary-bars"></div></section>
    <section class="card span6"><div class="label">Llamadas recientes</div><table><thead><tr><th>Hora</th><th>Tool</th><th>Duración</th><th>Estado</th><th>Detalle</th></tr></thead><tbody id="recent"></tbody></table></section>
    <section class="card span12"><div class="label">Errores recientes</div><table><thead><tr><th>Hora</th><th>Tool</th><th>Duración</th><th>Error</th></tr></thead><tbody id="errors"></tbody></table></section>
  </div>
</main>
<script>
${sharedScript}
async function refresh() {
  try {
    const [status, overview, summary, recent, errors, timeline] = await Promise.all([
      getJson('/status'), getJson('/api/metrics/overview'), getJson('/api/metrics/summary?limit=10'), getJson('/api/metrics/recent?limit=20'), getJson('/api/metrics/errors?limit=20'), getJson('/api/metrics/timeline?limit=500')
    ]);
    okDot('ready-dot', status.ready); setText('ready-text', status.ready ? 'ready' : 'not ready');
    setText('sessions', num(status.sessions)); setText('anonymous', num(status.anonymousTransports)); setText('pid', status.pid); setText('uptime', num(status.uptimeSeconds) + 's');
    setText('total-calls', num(overview.totals.calls)); setText('total-errors', num(overview.totals.errorCalls)); setText('avg-duration', ms(overview.totals.avgDurationMs)); setText('dbpath', overview.sqlitePath || '-');
    document.getElementById('summary-bars').innerHTML = barRows(summary.summary || []);
    document.getElementById('recent').innerHTML = recentRows(recent.recent || []);
    document.getElementById('errors').innerHTML = (errors.errors || []).map(r => '<tr><td>' + shortTime(r.started_at) + '</td><td><code>' + r.tool + '</code></td><td>' + ms(r.duration_ms) + '</td><td class="muted small">' + (r.error || '-') + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">sin errores registrados</td></tr>';
    document.getElementById('timeline').innerHTML = timelineBars(timeline.timeline || []);
  } catch (err) {
    okDot('ready-dot', false); setText('ready-text', String(err.message || err));
  }
}
refresh(); setInterval(refresh, 5000);
</script>
`, false);
}

