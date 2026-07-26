export const dashboardMarkup = `
<header class="topbar">
  <div class="brand">
    <div class="brand-row">
      <h1>Bridge MCP Dashboard</h1>
      <span id="server-version" class="brand-version">v—</span>
    </div>
    <div id="server-subtitle" class="brand-subtitle">MauroPrime · HTTP production-candidate · actualización automática cada 5 s</div>
  </div>
  <div class="topbar-actions">
    <span id="updated-at" class="updated-at">sin actualizar</span>
    <span id="overall-status" class="status-pill" data-tone="info"><span id="overall-dot" class="dot info"></span><span id="overall-text">comprobando…</span></span>
  </div>
</header>

<main class="shell">
  <section class="health-strip" aria-label="Estado de componentes">
    <article class="health-item">
      <span id="health-bridge-dot" class="dot"></span>
      <div class="health-copy"><div class="health-label">Bridge HTTP</div><div id="health-bridge" class="health-value">comprobando</div></div>
    </article>
    <article class="health-item">
      <span id="health-transport-dot" class="dot"></span>
      <div class="health-copy"><div class="health-label">Transporte MCP</div><div id="health-transport" class="health-value">comprobando</div></div>
    </article>
    <article class="health-item">
      <span id="health-sqlite-dot" class="dot"></span>
      <div class="health-copy"><div class="health-label">Métricas SQLite</div><div id="health-sqlite" class="health-value">comprobando</div></div>
    </article>
    <article class="health-item">
      <span id="health-mssr-dot" class="dot"></span>
      <div class="health-copy"><div class="health-label">MSSR</div><div id="health-mssr" class="health-value">comprobando</div></div>
    </article>
    <article class="health-item">
      <span id="health-sessions-dot" class="dot"></span>
      <div class="health-copy"><div class="health-label">Sesiones</div><div id="health-sessions" class="health-value">—</div></div>
    </article>
  </section>

  <nav class="tabs" role="tablist" aria-label="Secciones del dashboard">
    <button class="tab-button" type="button" role="tab" aria-selected="true" aria-controls="panel-summary" id="tab-summary" data-tab="summary">Resumen</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-activity" id="tab-activity" data-tab="activity">Actividad</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-mssr" id="tab-mssr" data-tab="mssr">MSSR</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-errors" id="tab-errors" data-tab="errors">Errores</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-system" id="tab-system" data-tab="system">Sistema</button>
  </nav>

  <section id="panel-summary" class="tab-panel" role="tabpanel" aria-labelledby="tab-summary" data-panel="summary">
    <div class="grid">
      <article id="attention-card" class="card attention-card span-12" data-state="warn">
        <div class="attention-head">
          <div>
            <div class="card-kicker">Lectura operativa</div>
            <h2 class="card-title">Requiere atención</h2>
          </div>
          <span id="attention-count" class="status-pill" data-tone="warn"><span class="dot warn"></span><span>comprobando</span></span>
        </div>
        <div id="attention-list" class="attention-list"><div class="attention-empty">Evaluando métricas MSSR de la época activa…</div></div>
      </article>

      <article class="card span-8">
        <div class="card-header">
          <div><div class="card-kicker">Últimas llamadas observadas</div><h2 class="card-title">Actividad por bloques de 5 minutos</h2><p class="card-description">Las barras rojas contienen al menos un error dentro del bloque.</p></div>
          <span class="status-pill" data-tone="info"><span class="dot info"></span><span>hasta 500 llamadas</span></span>
        </div>
        <div id="summary-timeline-wrap" class="timeline-wrap">
          <div id="summary-timeline" class="timeline"><div class="empty-state">Cargando actividad…</div></div>
          <div class="timeline-axis"><span id="summary-timeline-start">—</span><span id="summary-timeline-end">—</span></div>
        </div>
      </article>

      <article class="card span-4">
        <div class="card-header"><div><div class="card-kicker">Ahora</div><h2 class="card-title">Estado actual</h2></div></div>
        <div class="status-list">
          <div class="status-row"><span class="status-key">Sesiones HTTP</span><span id="current-sessions" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">Sesiones activas</span><span id="current-active-sessions" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">Transportes anónimos</span><span id="current-anonymous" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">PID</span><span id="current-pid" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">Uptime</span><span id="current-uptime" class="status-value">—</span></div>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Época activa</div><h2 class="card-title">Resumen operativo limpio</h2><p class="card-description">Desde el baseline compartido actual. El historial anterior se conserva fuera de esta vista.</p></div>
        </div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Tool calls</div><div id="total-calls" class="metric-value">—</div><div class="metric-note">época activa</div></div>
            <div id="errors-metric-card" class="metric-card"><div class="metric-label">Errores</div><div id="total-errors" class="metric-value">—</div><div class="metric-note"><span id="error-rate">—</span> del total</div></div>
            <div class="metric-card"><div class="metric-label">Duración promedio</div><div id="avg-duration" class="metric-value">—</div><div class="metric-note">llamadas activas</div></div>
            <div class="metric-card"><div class="metric-label">MSSR estructurado</div><div id="summary-mssr-structured" class="metric-value">—</div><div class="metric-note"><span id="summary-mssr-routes">—</span> rutas en época activa</div></div>
          </div>
        </div>
      </article>

      <article class="card span-7">
        <div class="card-header"><div><div class="card-kicker">Época activa</div><h2 class="card-title">Tools más usadas</h2></div></div>
        <div id="summary-tools" class="tool-list"><div class="empty-state">Cargando tools…</div></div>
      </article>

      <article class="card span-5">
        <div class="card-header"><div><div class="card-kicker">Actualización viva</div><h2 class="card-title">Últimas operaciones</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Hora</th><th>Tool</th><th>Estado</th><th>Duración</th></tr></thead>
            <tbody id="summary-recent"><tr><td colspan="4" class="muted">Cargando…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Atribución de llamadas y errores</div><h2 class="card-title">Resultados por cliente y modelo</h2><p class="card-description">Separa Codex, ChatGPT Web, modelo y esfuerzo cuando el host los expone. Los valores no observables aparecen como unknown.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Modelo</th><th>Esfuerzo</th><th>Llamadas</th><th>Errores</th><th>Duración media</th></tr></thead>
            <tbody id="agent-profiles"><tr><td colspan="6" class="muted">Cargando perfiles…</td></tr></tbody>
          </table>
        </div>
      </article>
    </div>
  </section>

  <section id="panel-activity" class="tab-panel" role="tabpanel" aria-labelledby="tab-activity" data-panel="activity" hidden>
    <div class="grid">
      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Actividad reciente</div><h2 class="card-title">Timeline completo</h2><p class="card-description">Agrupación de las últimas llamadas disponibles en bloques de 5 minutos.</p></div></div>
        <div class="timeline-wrap">
          <div id="activity-timeline" class="timeline"><div class="empty-state">Cargando actividad…</div></div>
          <div class="timeline-axis"><span id="activity-timeline-start">—</span><span id="activity-timeline-end">—</span></div>
        </div>
      </article>
      <article class="card span-5">
        <div class="card-header"><div><div class="card-kicker">Volumen y latencia</div><h2 class="card-title">Tools más usadas</h2></div></div>
        <div id="activity-tools" class="tool-list"><div class="empty-state">Cargando tools…</div></div>
      </article>
      <article class="card span-7">
        <div class="card-header"><div><div class="card-kicker">Últimas 20</div><h2 class="card-title">Llamadas recientes</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Hora</th><th>Tool</th><th>Duración</th><th>Estado</th><th>Detalle</th></tr></thead>
            <tbody id="activity-recent"><tr><td colspan="5" class="muted">Cargando…</td></tr></tbody>
          </table>
        </div>
      </article>
    </div>
  </section>

  <section id="panel-mssr" class="tab-panel" role="tabpanel" aria-labelledby="tab-mssr" data-panel="mssr" hidden>
    <div class="grid">
      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Trace contract</div><h2 class="card-title">Calidad MSSR · época activa</h2><p id="mssr-window" class="card-description">Cargando ventana de observabilidad…</p></div>
          <span id="mssr-scope" class="status-pill" data-tone="info"><span class="dot info"></span><span>scope active</span></span>
        </div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Routing semántico</div><div id="mssr-structured" class="metric-value">—</div><div class="metric-note"><span id="mssr-routes">—</span> rutas</div></div>
            <div class="metric-card"><div class="metric-label">Route → load</div><div id="mssr-continuity" class="metric-value">—</div><div class="metric-note"><span id="mssr-orphans">—</span> cargas huérfanas</div></div>
            <div id="mssr-required-card" class="metric-card"><div class="metric-label">Skills requeridas</div><div id="mssr-required" class="metric-value">—</div><div id="mssr-required-count" class="metric-note">—</div></div>
            <div class="metric-card"><div class="metric-label">Éxito por outcome</div><div id="mssr-success" class="metric-value">—</div><div class="metric-note"><span id="mssr-outcomes">—</span> atribuidos</div></div>
          </div>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Embudo de ejecución</div><h2 class="card-title">Cobertura y cumplimiento</h2><p class="card-description">Cada barra explica una etapa distinta; no deben interpretarse como el mismo tipo de porcentaje.</p></div></div>
        <div id="mssr-progress" class="mssr-list"><div class="empty-state">Cargando métricas MSSR…</div></div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Uso individual del sistema</div><h2 class="card-title">Activación MSSR por modelo</h2><p class="card-description">Comprueba si cada perfil enruta, carga lo requerido y verifica. La muestra siempre queda visible.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Perfil</th><th>Tareas</th><th>Routing</th><th>Route → load</th><th>Requeridas</th><th>Verificación</th></tr></thead>
            <tbody id="mssr-agent-activation"><tr><td colspan="6" class="muted">Cargando perfiles…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Resultado individual</div><h2 class="card-title">Rendimiento MSSR por modelo</h2><p class="card-description">Compara cierres, calidad, velocidad y fricción. No declara un ganador con una muestra insuficiente.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Perfil</th><th>Cierre</th><th>Éxito</th><th>Aceptación</th><th>Score</th><th>Tiempo</th><th>Loop / correcciones</th></tr></thead>
            <tbody id="mssr-agent-results"><tr><td colspan="7" class="muted">Cargando perfiles…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Atribución primaria</div><h2 class="card-title">Outcomes por skill</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Skill</th><th>Tareas</th><th>Éxito</th><th>Aceptación</th><th>Score</th><th>Distribución</th></tr></thead>
            <tbody id="mssr-skill-outcomes"><tr><td colspan="6" class="muted">Cargando…</td></tr></tbody>
          </table>
        </div>
      </article>
    </div>
  </section>

  <section id="panel-errors" class="tab-panel" role="tabpanel" aria-labelledby="tab-errors" data-panel="errors" hidden>
    <div class="grid">
      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Últimos registros</div><h2 class="card-title">Errores recientes</h2><p class="card-description">El resumen está truncado para lectura rápida; expandí una fila para ver el mensaje completo.</p></div>
          <span id="recent-errors-count" class="status-pill" data-tone="warn"><span class="dot warn"></span><span>—</span></span>
        </div>
        <div id="error-list" class="error-list"><div class="empty-state">Cargando errores…</div></div>
      </article>
    </div>
  </section>

  <section id="panel-system" class="tab-panel" role="tabpanel" aria-labelledby="tab-system" data-panel="system" hidden>
    <div class="grid">
      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Proceso activo</div><h2 class="card-title">Runtime HTTP</h2></div></div>
        <div class="system-grid">
          <div class="system-field"><div class="system-label">Servidor</div><div id="system-server" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Node</div><div id="system-node" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">PID</div><div id="system-pid" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Uptime</div><div id="system-uptime" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Host</div><div id="system-host" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">MCP path</div><div id="system-mcp-path" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Inicio</div><div id="system-started" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Máximo de sesiones</div><div id="system-max-sessions" class="system-value">—</div></div>
        </div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Persistencia local</div><h2 class="card-title">Observabilidad</h2></div></div>
        <div class="system-grid">
          <div class="system-field"><div class="system-label">SQLite</div><div id="system-db" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Bridge JSONL</div><div id="system-jsonl" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Epoch compartida</div><div id="system-mssr-epoch" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Baseline</div><div id="system-mssr-baseline" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Contrato</div><div id="system-mssr-contract" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Scope por defecto</div><div id="system-mssr-scope" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Privacidad</div><div id="system-privacy" class="system-value">—</div></div>
          <div class="system-field"><div class="system-label">Eventos activos</div><div id="system-active-events" class="system-value">—</div></div>
        </div>
      </article>
    </div>
  </section>
</main>
`;
