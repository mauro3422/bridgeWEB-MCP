export const dashboardMarkup = `
<header class="topbar topbar-v2">
  <div class="brand">
    <div class="brand-row">
      <h1>MauroPrime</h1>
      <span id="server-version" class="brand-version">v—</span>
    </div>
    <div id="server-subtitle" class="brand-subtitle">Bridge dashboard · UX v2-B · actualización cada 5 s</div>
  </div>
  <div class="topbar-actions topbar-actions-v2">
    <span id="overall-status" class="status-pill" data-tone="info"><span id="overall-dot" class="dot info"></span><span id="overall-text">comprobando…</span></span>
    <span id="shell-work-status" class="status-pill shell-work-status" data-tone="info"><span class="dot info"></span><span>leyendo trabajo…</span></span>
    <span id="shell-scope" class="shell-scope">época activa</span>
    <button id="inspector-open" class="shell-action" type="button" aria-controls="v2-inspector" aria-expanded="false">Inspector</button>
    <span id="updated-at" class="updated-at">sin actualizar</span>
  </div>
</header>

<main class="shell shell-v2" data-ux-contract="human-v2-b">
  <nav class="v2-tabs" role="tablist" aria-label="Navegación principal">
    <button class="v2-tab-button" type="button" role="tab" aria-selected="true" aria-controls="panel-home-v2" id="v2-tab-home" data-v2-tab="home">Inicio</button>
    <button class="v2-tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-work-v2" id="v2-tab-work" data-v2-tab="work" tabindex="-1">Trabajo</button>
    <button class="v2-tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-health-v2" id="v2-tab-health" data-v2-tab="health" tabindex="-1">Salud</button>
    <button class="v2-tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-explore-v2" id="v2-tab-explore" data-v2-tab="explore" tabindex="-1">Explorar</button>
  </nav>

  <section id="panel-home-v2" class="v2-panel" role="tabpanel" aria-labelledby="v2-tab-home" data-v2-panel="home" data-ux-contract="human-v2-b">
    <div class="home-stack">
      <section class="home-hero" aria-labelledby="home-heading">
        <div class="home-hero-copy">
          <div class="v2-eyebrow">Ahora</div>
          <h2 id="home-heading">Qué está pasando</h2>
          <p id="home-status-sentence" class="home-status-sentence">Leyendo estado del sistema y trabajo actual…</p>
        </div>
        <div class="home-hero-meta" aria-label="Resumen de trabajo">
          <span id="home-active-work" class="home-chip">— activos</span>
          <span id="home-closure-debt" class="home-chip">— cierres</span>
        </div>
      </section>

      <div class="home-primary-grid">
        <article class="home-surface home-continue-surface">
          <div class="home-section-head">
            <div><div class="v2-eyebrow">Continuar ahora</div><h3 id="home-continue-title">Buscando trabajo actual…</h3></div>
            <span id="home-continue-stage" class="status-pill" data-tone="info"><span class="dot info"></span><span>—</span></span>
          </div>
          <div id="home-continue-project" class="home-project-label">—</div>
          <p id="home-continue-summary" class="home-continue-summary">Reconstruyendo el último contexto humano observable.</p>
          <div class="home-continue-footer">
            <div><span class="home-meta-label">Siguiente</span><strong id="home-continue-next">—</strong></div>
            <div><span class="home-meta-label">Último cambio</span><strong id="home-continue-latest">—</strong></div>
            <button class="home-action" type="button" data-open-v2-tab="work">Ver trabajo</button>
          </div>
        </article>

        <article class="home-surface home-attention-surface">
          <div class="home-section-head">
            <div><div class="v2-eyebrow">Acción</div><h3>Necesita atención</h3></div>
            <span id="home-attention-count" class="status-pill" data-tone="info"><span class="dot info"></span><span>comprobando</span></span>
          </div>
          <div id="home-attention-list" class="home-attention-list"><div class="home-empty">Evaluando contratos y deuda accionable…</div></div>
        </article>
      </div>

      <section class="home-pulse-section" aria-labelledby="home-pulse-heading">
        <div class="home-section-title"><div><div class="v2-eyebrow">Pulso del sistema</div><h3 id="home-pulse-heading">Señales operativas</h3></div><span class="home-section-note">último bloque observable</span></div>
        <div class="home-pulse-grid">
          <article class="home-pulse-card"><span class="home-pulse-label">Actividad</span><strong id="home-pulse-activity">—</strong><span id="home-pulse-activity-note" class="home-pulse-note">cargando…</span></article>
          <article class="home-pulse-card"><span class="home-pulse-label">Errores</span><strong id="home-pulse-errors">—</strong><span id="home-pulse-errors-note" class="home-pulse-note">cargando…</span></article>
          <article class="home-pulse-card"><span class="home-pulse-label">Conexiones</span><strong id="home-pulse-sessions">—</strong><span id="home-pulse-sessions-note" class="home-pulse-note">cargando…</span></article>
          <article class="home-pulse-card"><span class="home-pulse-label">Persistencia</span><strong id="home-pulse-persistence">—</strong><span id="home-pulse-persistence-note" class="home-pulse-note">cargando…</span></article>
        </div>
      </section>

      <section class="home-changes-section" aria-labelledby="home-changes-heading">
        <div class="home-section-title"><div><div class="v2-eyebrow">Continuidad</div><h3 id="home-changes-heading">Qué cambió</h3></div><span class="home-section-note">eventos humanos recientes</span></div>
        <div id="home-changes" class="home-changes"><div class="home-empty">Reconstruyendo cambios semánticos…</div></div>
      </section>
    </div>
  </section>

  <section id="panel-work-v2" class="v2-panel" role="tabpanel" aria-labelledby="v2-tab-work" data-v2-panel="work" data-ux-contract="human-v2-b" hidden>
    <div class="work-stack">
      <section class="work-hero" aria-labelledby="work-heading">
        <div class="work-hero-copy">
          <div class="v2-eyebrow">Continuidad</div>
          <h2 id="work-heading">Trabajo</h2>
          <p id="work-status-sentence" class="work-status-sentence">Reconstruyendo trabajo activo y continuidad…</p>
        </div>
        <div class="work-range-group" role="group" aria-label="Ventana de trabajo">
          <button class="work-range-button" type="button" data-work-range="now" aria-pressed="true">Ahora</button>
          <button class="work-range-button" type="button" data-work-range="24h" aria-pressed="false">24 h</button>
          <button class="work-range-button" type="button" data-work-range="7d" aria-pressed="false">7 d</button>
          <button class="work-range-button" type="button" data-work-range="30d" aria-pressed="false">30 d</button>
        </div>
      </section>

      <section class="work-active-section" aria-labelledby="work-active-heading">
        <div class="work-section-title">
          <div><div class="v2-eyebrow">Ahora</div><h3 id="work-active-heading">Trabajo activo</h3></div>
          <span id="work-active-count" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando</span></span>
        </div>
        <div id="work-active-list" class="work-active-list"><div class="home-empty">Leyendo tareas humanas actuales…</div></div>
      </section>

      <div class="work-secondary-grid">
        <section class="work-projects-section" aria-labelledby="work-projects-heading">
          <div class="work-section-title work-section-title-wrap">
            <div><div class="v2-eyebrow">Mapa</div><h3 id="work-projects-heading">Proyectos</h3><span id="work-range-note" class="work-section-note">estado actual</span></div>
            <div id="work-project-filter-group" class="work-filter-group" role="group" aria-label="Filtro de proyectos">
              <button class="work-filter-button" type="button" data-work-project-filter="current" aria-pressed="true">Activos y revisar</button>
              <button class="work-filter-button" type="button" data-work-project-filter="all" aria-pressed="false">Todos</button>
            </div>
          </div>
          <div id="work-project-list" class="work-project-list"><div class="home-empty">Armando mapa de proyectos…</div></div>
        </section>

        <section class="work-timeline-section" aria-labelledby="work-timeline-heading">
          <div class="work-section-title">
            <div><div class="v2-eyebrow">Cambios</div><h3 id="work-timeline-heading">Actividad humana</h3></div>
            <span id="work-event-count" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando</span></span>
          </div>
          <div id="work-timeline" class="work-timeline"><div class="home-empty">Reconstruyendo eventos semánticos…</div></div>
        </section>
      </div>

      <div class="work-evidence-footer">
        <span>La evidencia exacta de trazas, Git y lifecycle sigue preservada en la vista diagnóstica.</span>
        <button class="home-action secondary" type="button" data-open-legacy-tab="cockpit">Abrir evidencia v1</button>
      </div>
    </div>
  </section>

  <section id="panel-health-v2" class="v2-panel" role="tabpanel" aria-labelledby="v2-tab-health" data-v2-panel="health" data-ux-contract="human-v2-b" hidden>
    <article class="v2-migration-surface">
      <div class="v2-eyebrow">V2-C</div><h2>Salud</h2>
      <p>La nueva lectura de Golden Signals y salud MSSR llegará en V2-C. No se convierten coberturas descriptivas en alarmas mientras esa semántica no esté definida.</p>
      <div class="v2-migration-actions"><button class="home-action" type="button" data-open-legacy-tab="system">Abrir Sistema v1</button><button class="home-action secondary" type="button" data-open-legacy-tab="mssr">Abrir MSSR v1</button></div>
    </article>
  </section>

  <section id="panel-explore-v2" class="v2-panel" role="tabpanel" aria-labelledby="v2-tab-explore" data-v2-panel="explore" data-ux-contract="human-v2-b" hidden>
    <article class="v2-migration-surface">
      <div class="v2-eyebrow">V2-D</div><h2>Explorar</h2>
      <p>El explorador unificado todavía se está migrando. Tools, errores y actividad técnica siguen disponibles sin pérdida de evidencia en la vista v1.</p>
      <div class="v2-migration-actions"><button class="home-action" type="button" data-open-legacy-tab="errors">Abrir Errores v1</button><button class="home-action secondary" type="button" data-open-legacy-tab="tools">Abrir Tools v1</button></div>
    </article>
  </section>

  <details id="legacy-dashboard" class="legacy-dashboard" data-legacy-dashboard>
    <summary class="legacy-dashboard-summary"><span><span class="v2-eyebrow">Comparación temporal</span><strong>Vista v1 · diagnóstico anterior</strong></span><span class="legacy-summary-hint">7 paneles técnicos preservados</span></summary>
    <div class="legacy-dashboard-body">
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
      <div class="health-copy"><div class="health-label">Conexiones MCP</div><div id="health-sessions" class="health-value">—</div></div>
    </article>
  </section>

  <nav class="tabs" role="tablist" aria-label="Secciones del dashboard">
    <button class="tab-button" type="button" role="tab" aria-selected="true" aria-controls="panel-summary" id="tab-summary" data-tab="summary">Resumen</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-cockpit" id="tab-cockpit" data-tab="cockpit">Dónde estoy</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-activity" id="tab-activity" data-tab="activity">Actividad</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-tools" id="tab-tools" data-tab="tools">Tools</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-mssr" id="tab-mssr" data-tab="mssr">MSSR</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-errors" id="tab-errors" data-tab="errors">Errores</button>
    <button class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="panel-system" id="tab-system" data-tab="system">Sistema</button>
  </nav>

  <section id="panel-summary" class="tab-panel" role="tabpanel" aria-labelledby="tab-summary" data-panel="summary" data-ux-contract="human-v1">
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
        <div class="card-header"><div><div class="card-kicker">Ahora</div><h2 class="card-title">Estado actual</h2></div><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre el estado actual">?</summary><div class="context-help-popover" role="note"><strong>Estado actual</strong><span>Retenidas = sesiones MCP conocidas; con solicitud activa = sesiones trabajando ahora. PID, runtime boot y uptime sirven para distinguir reinicios reales de cambios de UI.</span></div></details></div>
        <div class="status-list">
          <div class="status-row"><span class="status-key">Conexiones retenidas</span><span id="current-sessions" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">Con solicitud activa</span><span id="current-active-sessions" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">Transportes anónimos</span><span id="current-anonymous" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">PID</span><span id="current-pid" class="status-value">—</span></div>
          <div class="status-row"><span class="status-key">Runtime boot</span><code id="current-runtime-boot" class="status-value">—</code></div>
          <div class="status-row"><span class="status-key">Uptime</span><span id="current-uptime" class="status-value">—</span></div>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Época activa</div><h2 class="card-title">Resumen operativo limpio</h2><p class="card-description">Sólo la ventana activa; el historial anterior sigue preservado fuera de esta vista.</p></div><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre época activa y MSSR estructurado">?</summary><div class="context-help-popover" role="note"><strong>Época activa</strong><span>Es el baseline compartido actual de observabilidad. “MSSR estructurado” mide rutas con intent semántico estructurado dentro de esa misma ventana, no calidad del modelo ni éxito del trabajo.</span></div></details>
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
        <div class="card-header"><div><div class="card-kicker">Ejecución MCP · época activa</div><h2 class="card-title">Herramientas MCP más usadas</h2><p class="card-description">Volumen relativo de llamadas ejecutables durante la ventana activa.</p></div><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre herramientas y skill_load">?</summary><div class="context-help-popover" role="note"><strong>Tool call ≠ outcome</strong><span><code>skill_load</code> entrega una guía al contexto y registra la carga. Su uso correcto se demuestra después con verificación y outcome; esta lista sólo muestra ejecución observable.</span></div></details></div>
        <div id="summary-tools" class="tool-list"><div class="empty-state">Cargando herramientas…</div></div>
      </article>

      <details class="summary-forensic span-12" data-ux-layer="raw">
        <summary class="summary-forensic-summary"><div><div class="card-kicker">Detalle técnico</div><strong>Operaciones e identidades observadas</strong><span>La lectura operativa queda arriba; abrí esto para revisar llamadas individuales y agrupaciones por tarea/sesión/proyecto.</span></div><span id="summary-forensic-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando detalle</span></span></summary>
        <div class="summary-forensic-grid grid">
          <article class="card span-12">
            <div class="card-header"><div><div class="card-kicker">Actualización viva</div><h2 class="card-title">Últimas operaciones</h2></div></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Hora</th><th>Tool</th><th>Estado</th><th>Duración</th></tr></thead>
                <tbody id="summary-recent"><tr><td colspan="4" class="muted">Cargando…</td></tr></tbody>
              </table>
            </div>
          </article>

          <article class="card span-12">
            <div class="card-header"><div><div class="card-kicker">Atribución de llamadas, routing y errores</div><h2 class="card-title">Resultados por tarea, sesión y proyecto</h2><p id="agent-profile-summary" class="card-description">Cada fila agrupa tarea, sesión y proyecto; no crea un agente nuevo. MSSR mide sólo tools elegibles.</p></div></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Cliente</th><th>Modelo</th><th>Esfuerzo</th><th>Tarea / sesión</th><th>Proyecto primario / relacionado</th><th>Llamadas</th><th>Cobertura MSSR</th><th>Errores</th><th>Duración media</th></tr></thead>
                <tbody id="agent-profiles"><tr><td colspan="9" class="muted">Cargando perfiles…</td></tr></tbody>
              </table>
            </div>
          </article>
        </div>
      </details>
    </div>
  </section>

  <section id="panel-cockpit" class="tab-panel" role="tabpanel" aria-labelledby="tab-cockpit" data-panel="cockpit" data-ux-contract="human-v1" hidden>
    <div class="grid">
      <article class="card span-12 cockpit-focus-card">
        <div class="card-header">
          <div><div class="card-kicker">Orientación humana</div><h2 class="card-title">Dónde estoy</h2><p class="card-description">Qué pasa, qué sigue y qué requiere decisión.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre el Cockpit y su autoridad">?</summary><div class="context-help-popover" role="note"><strong>Proyección, no autoridad</strong><span>El Cockpit combina evidencia acotada de MSSR, Bridge y Git para orientarte. No cierra trazas, no cambia lifecycle y no convierte esta vista en una nueva fuente de verdad.</span></div></details><span id="cockpit-authority" class="status-pill" data-tone="info"><span class="dot info"></span><span>projection-only</span></span></div>
        </div>
        <div id="cockpit-orientation" class="cockpit-orientation" data-ux-layer="aggregate">
          <div class="cockpit-orientation-card" data-orientation="now"><span>Ahora</span><strong>Cargando trabajo actual…</strong></div>
          <div class="cockpit-orientation-card" data-orientation="next"><span>Siguiente</span><strong>Calculando próximo gate…</strong></div>
          <div class="cockpit-orientation-card" data-orientation="attention"><span>Atención</span><strong>Revisando excepciones…</strong></div>
        </div>
        <details class="cockpit-focus-detail" data-ux-layer="detail">
          <summary>Lifecycle y foco técnico reciente</summary>
          <div id="cockpit-focus" class="cockpit-focus"><div class="empty-state">Cargando foco técnico…</div></div>
        </details>
      </article>

      <article class="card span-12 cockpit-return-card">
        <div class="card-header">
          <div><div class="card-kicker">Trabajo humano · reanudar sin releer todo</div><h2 class="card-title">Al volver</h2><p class="card-description">Trabajo activo primero; ayer y deuda quedan como contexto expandible.</p></div>
          <span id="cockpit-return-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando contexto</span></span>
        </div>
        <div id="cockpit-return-summary" class="cockpit-return-summary"><div class="empty-state">Reconstruyendo dónde quedamos…</div></div>
        <div class="cockpit-return-grid">
          <section class="cockpit-return-pane cockpit-return-pane-active"><div class="cockpit-return-heading">Trabajo activo</div><div id="cockpit-open-tasks"><div class="empty-state">Cargando tareas activas…</div></div></section>
          <details class="cockpit-return-pane cockpit-return-disclosure"><summary class="cockpit-return-heading">Deuda MSSR · revisar antes de retomar</summary><div id="cockpit-lifecycle-debt"><div class="empty-state">Separando cierres administrativos…</div></div></details>
          <details class="cockpit-return-pane cockpit-return-disclosure"><summary class="cockpit-return-heading">Ayer · contexto reciente</summary><div id="cockpit-yesterday"><div class="empty-state">Cargando actividad de ayer…</div></div></details>
        </div>
      </article>

      <article class="card span-12 cockpit-workspace-card">
        <div class="card-header">
          <div><div class="card-kicker">Mapa de trabajo</div><h2 class="card-title">En qué está cada proyecto</h2><p class="card-description">Resumen conservador de proyectos observados y su próximo gate visible.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre estados de proyecto">?</summary><div class="context-help-popover" role="note"><strong>Estados proyectados</strong><span>Activo, pausado, experimental o revisar combinan tareas humanas MSSR, Git y Project Health de los últimos 7 días. Terminado o abandonado/reemplazado sólo se muestran con evidencia explícita del owner.</span></div></details><span id="cockpit-workspace-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>clasificando</span></span></div>
        </div>
        <div id="cockpit-workspace-summary" class="cockpit-weekly-summary"><div class="empty-state">Armando mapa de proyectos…</div></div>
        <details id="cockpit-workspace-detail" class="cockpit-secondary-disclosure" data-ux-layer="detail">
          <summary><span>Detalle por proyecto</span><span class="disclosure-hint">estado + próximo gate</span></summary>
          <div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Estado</th><th>Tarea / contexto</th><th>Git</th><th>Próximo gate</th></tr></thead><tbody id="cockpit-workspace-projects"><tr><td colspan="5" class="muted">Clasificando proyectos observados…</td></tr></tbody></table></div>
        </details>
      </article>

      <details id="cockpit-secondary-context" class="cockpit-secondary-stack span-12" data-ux-layer="detail">
        <summary><div><div class="card-kicker">Contexto adicional</div><strong>Capacidades, historial y evidencia técnica</strong><span>Diagnóstico útil para profundizar sin competir con la orientación actual.</span></div><span class="disclosure-hint">abrir contexto</span></summary>
        <div class="grid cockpit-secondary-grid">
      <article class="card span-12 cockpit-capabilities-card">
        <div class="card-header">
          <div><div class="card-kicker">Inventario vivo</div><h2 class="card-title">Qué puede hacer el sistema hoy</h2><p class="card-description">Resumen del catálogo y de la salud observable de las capacidades disponibles.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre el inventario de capabilities">?</summary><div class="context-help-popover" role="note"><strong>Inventario vivo</strong><span>Se deriva del catálogo runtime, Skill Health y workflow guides; no es una lista hardcodeada ni memoria de chat. Las capacidades que dependen de providers externos siguen en revisión hasta tener un probe live.</span></div></details><span id="cockpit-capability-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando capacidades</span></span></div>
        </div>
        <div id="cockpit-capability-summary" class="cockpit-weekly-summary"><div class="empty-state">Leyendo catálogo vivo…</div></div>
        <details id="cockpit-capabilities-detail" class="cockpit-secondary-disclosure" data-ux-layer="detail">
          <summary><span>Familias de capability</span><span class="disclosure-hint">catálogo vivo</span></summary>
          <div id="cockpit-capability-families" class="cockpit-capability-families"><div class="empty-state">Cargando familias…</div></div>
        </details>
      </article>

      <article class="card span-12 cockpit-weekly-card">
        <div class="card-header">
          <div><div class="card-kicker">Resumen transversal</div><h2 class="card-title">Qué hicimos esta semana</h2><p class="card-description">Actividad y pendientes observables de los últimos 7 días.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre el resumen semanal">?</summary><div class="context-help-popover" role="note"><strong>Semana observable</strong><span>Combina el historial MSSR preservado con Git local de repos observados para reconstruir avances y pendientes sin depender de recordar en qué chat quedó cada tarea.</span></div></details><span id="cockpit-weekly-window" class="status-pill" data-tone="info"><span class="dot info"></span><span>7 días · cargando</span></span></div>
        </div>
        <div id="cockpit-weekly-summary" class="cockpit-weekly-summary"><div class="empty-state">Reconstruyendo la semana…</div></div>
        <details id="cockpit-weekly-detail" class="cockpit-secondary-disclosure" data-ux-layer="detail">
          <summary><span>Detalle semanal por proyecto</span><span class="disclosure-hint">7 días</span></summary>
          <div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Evidencia MSSR</th><th>Git local</th><th>Commits 7d</th><th>Remote / tracking</th><th>Pendiente observable</th></tr></thead><tbody id="cockpit-weekly-projects"><tr><td colspan="6" class="muted">Cargando semana…</td></tr></tbody></table></div>
        </details>
      </article>
      <article class="card span-12 cockpit-history-card">
        <div class="card-header">
          <div><div class="card-kicker">Contexto acumulado</div><h2 class="card-title">Últimos 30 días</h2><p class="card-description">Cobertura y último contexto observable de los últimos 30 días.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre el contexto de 30 días">?</summary><div class="context-help-popover" role="note"><strong>Historial incremental</strong><span>Esta vista deriva de snapshots diarios ya guardados: muestra días activos, proyectos y último contexto observable sin disparar otro scan histórico largo.</span></div></details><span id="cockpit-history-window" class="status-pill" data-tone="info"><span class="dot info"></span><span>30 días · cargando</span></span></div>
        </div>
        <div id="cockpit-history-summary" class="cockpit-weekly-summary"><div class="empty-state">Armando orientación de 30 días…</div></div>
        <details id="cockpit-history-detail" class="cockpit-secondary-disclosure" data-ux-layer="detail">
          <summary><span>Detalle histórico por proyecto</span><span class="disclosure-hint">30 días</span></summary>
          <div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Días activos</th><th>Última vez</th><th>Último contexto</th></tr></thead><tbody id="cockpit-history-projects"><tr><td colspan="4" class="muted">Cargando historial incremental…</td></tr></tbody></table></div>
        </details>
      </article>


      <article class="card span-12 cockpit-technical-card">
        <details class="cockpit-technical-disclosure" data-ux-layer="raw">
          <summary><div><div class="card-kicker">Evidencia forense</div><strong>Evidencia técnica MSSR</strong><span>Las trazas individuales siguen disponibles para auditoría, pero ya no son la unidad principal de trabajo.</span></div><span id="cockpit-trace-count" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando</span></span></summary>
          <div id="cockpit-traces" class="cockpit-traces"><div class="empty-state">Cargando trazas…</div></div>
        </details>
      </article>

      <article class="card span-7">
        <div class="card-header"><div><div class="card-kicker">Repos relacionados</div><h2 class="card-title">Proyectos recientes y presión Git</h2><p class="card-description">Presión Git sólo en proyectos con trabajo abierto.</p></div><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre presión Git en Cockpit">?</summary><div class="context-help-popover" role="note"><strong>Consulta Git acotada</strong><span>Git se consulta dentro del worker aislado sólo para proyectos con trazas abiertas. Cuenta cambios tracked y no dispara un scan global de repos en cada refresh.</span></div></details></div>
        <details id="cockpit-git-detail" class="cockpit-secondary-disclosure" data-ux-layer="detail">
          <summary><span>Detalle Git por proyecto</span><span class="disclosure-hint">abrir evidencia</span></summary>
          <div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Tareas</th><th>Contexto</th><th>Git</th></tr></thead><tbody id="cockpit-projects"><tr><td colspan="4" class="muted">Cargando proyectos…</td></tr></tbody></table></div>
        </details>
      </article>

      <article class="card span-5">
        <div class="card-header"><div><div class="card-kicker">Qué requiere atención</div><h2 class="card-title">Mantenimiento y referencias</h2><p class="card-description">WATCH/REVIEW siguen siendo señales del owner canónico; el Cockpit sólo las muestra.</p></div></div>
        <div id="cockpit-maintenance" class="cockpit-maintenance"><div class="empty-state">Cargando mantenimiento…</div></div>
      </article>
        </div>
      </details>
    </div>
  </section>

  <section id="panel-activity" class="tab-panel" role="tabpanel" aria-labelledby="tab-activity" data-panel="activity" data-ux-contract="human-v1" hidden>
    <div class="grid">
      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Actividad reciente</div><h2 class="card-title">Timeline operativo</h2><p class="card-description">Bloques de 5 minutos. Cada barra se puede inspeccionar sin cambiar la ventana observada.</p></div><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre el timeline operativo">?</summary><div class="context-help-popover" role="note"><strong>Bucket de cinco minutos</strong><span>Cada barra resume llamadas y errores dentro de un bloque ya cargado. Inspeccionarlo sólo abre detalle local; no cambia la época activa ni solicita otra ventana.</span></div></details></div>
        <div class="timeline-wrap">
          <div id="activity-timeline" class="timeline" data-ux-layer="aggregate"><div class="empty-state">Cargando actividad…</div></div>
          <div class="timeline-axis"><span id="activity-timeline-start">—</span><span id="activity-timeline-end">—</span></div>
          <div id="activity-timeline-detail" class="activity-timeline-detail" data-ux-layer="detail" aria-live="polite">Seleccioná un bloque para ver sus llamadas y errores agregados.</div>
        </div>
      </article>
      <article class="card span-5">
        <div class="card-header"><div><div class="card-kicker">Volumen y latencia MCP</div><h2 class="card-title">Herramientas MCP más usadas</h2></div></div>
        <div id="activity-tools" class="tool-list"><div class="empty-state">Cargando herramientas…</div></div>
      </article>
      <article class="card span-7 activity-recent-card">
        <div class="card-header activity-recent-header">
          <div><div class="card-kicker">Últimas 20 · misma ventana</div><h2 class="card-title">Llamadas recientes</h2><p class="card-description">Agregado resume la misma evidencia que Raw; cambiar de modo no consulta otro período.</p></div>
          <div class="activity-recent-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre Agregado y Raw">?</summary><div class="context-help-popover" role="note"><strong>Mismo scope, distinta lectura</strong><span>Agregado agrupa las mismas últimas llamadas retenidas en Raw. Cambiar de modo sólo modifica la presentación en el navegador: no amplía la ventana ni solicita otro snapshot.</span></div></details><div class="activity-mode-toggle" role="group" aria-label="Modo de llamadas recientes">
            <button type="button" class="activity-mode-button" data-activity-mode="aggregate" aria-pressed="true">Agregado</button>
            <button type="button" class="activity-mode-button" data-activity-mode="raw" aria-pressed="false">Raw</button>
          </div></div>
        </div>
        <div id="activity-recent-aggregate" class="activity-call-list" data-ux-layer="aggregate"><div class="empty-state">Cargando…</div></div>
        <div id="activity-recent-raw" class="table-wrap activity-raw-table" data-ux-layer="raw" hidden>
          <table>
            <thead><tr><th>Hora</th><th>Tool</th><th>Duración</th><th>Estado</th><th>Detalle</th></tr></thead>
            <tbody id="activity-recent"><tr><td colspan="5" class="muted">Cargando…</td></tr></tbody>
          </table>
        </div>
      </article>
    </div>
  </section>

  <section id="panel-tools" class="tab-panel" role="tabpanel" aria-labelledby="tab-tools" data-panel="tools" data-ux-contract="human-v1" hidden>
    <div class="grid">
      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Registry + evidencia operativa</div><h2 class="card-title">Tool Portfolio</h2><p id="tools-portfolio-window" class="card-description">Cargando catálogo y ventana de evidencia…</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre Tool Portfolio">?</summary><div class="context-help-popover" role="note"><strong>Catálogo ≠ uso observado</strong><span>Registrada significa que la tool existe en el catálogo runtime; con evidencia significa que fue observada en la ventana actual. Una recomendación de revisión no elimina ni cambia lifecycle automáticamente.</span></div></details><span id="tools-portfolio-privacy" class="status-pill" data-tone="info"><span class="dot info"></span><span>datos agregados</span></span></div>
        </div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Registradas</div><div id="tools-registered" class="metric-value">—</div><div class="metric-note">registry canónico</div></div>
            <div class="metric-card"><div class="metric-label">Con evidencia</div><div id="tools-observed" class="metric-value">—</div><div class="metric-note">al menos una llamada</div></div>
            <div class="metric-card"><div class="metric-label">Sin evidencia</div><div id="tools-no-evidence" class="metric-value">—</div><div class="metric-note">requieren smoke test antes de decidir</div></div>
            <div id="tools-review-card" class="metric-card"><div class="metric-label">Para revisar</div><div id="tools-review" class="metric-value">—</div><div class="metric-note">sin contar mantener, proteger o falta de muestra</div></div>
          </div>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Triggers y recuperación</div><h2 class="card-title">Recordatorios accionables</h2><p class="card-description">Avisos efímeros de las últimas 24 horas. Sugieren el siguiente preflight; nunca ejecutan cambios automáticamente.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre recordatorios accionables">?</summary><div class="context-help-popover" role="note"><strong>Aviso ≠ acción</strong><span>Un recordatorio conserva una señal de recuperación o preflight para revisión humana. Puede expirar y nunca autoriza por sí mismo una mutación, un restart ni una publicación.</span></div></details><span id="tools-notice-count" class="status-pill" data-tone="info"><span class="dot info"></span><span>sin avisos</span></span></div>
        </div>
        <div id="tools-notices" class="notice-list"><div class="muted">Cargando recordatorios…</div></div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Explorar contratos</div><h2 class="card-title">Filtros del portfolio</h2><p class="card-description">La vista es diagnóstica. No cambia lifecycle, visibilidad ni implementación.</p></div>
          <button id="tools-reset" class="secondary-button" type="button">Limpiar filtros</button>
        </div>
        <div class="portfolio-filters">
          <label class="portfolio-field"><span>Buscar</span><input id="tools-search" type="search" placeholder="nombre, descripción o recomendación" autocomplete="off" /></label>
          <label class="portfolio-field"><span>Familia</span><select id="tools-family"><option value="">Todas</option></select></label>
          <label class="portfolio-field"><span>Rol</span><select id="tools-role"><option value="">Todos</option></select></label>
          <label class="portfolio-field"><span>Estado</span><select id="tools-status"><option value="">Todos</option></select></label>
          <label class="portfolio-field"><span>Lifecycle</span><select id="tools-lifecycle"><option value="">Todos</option></select></label>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Contratos y mantenimiento</div><h2 class="card-title">Inventario verificable</h2><p class="card-description">Ordenado primero por necesidad de atención y luego por volumen observado.</p></div>
          <span id="tools-result-count" class="status-pill" data-tone="info"><span class="dot info"></span><span>cargando</span></span>
        </div>
        <div id="tools-portfolio-body" class="portfolio-list" data-ux-layer="aggregate">
          <div class="muted portfolio-loading">Cargando portfolio…</div>
        </div>
      </article>
    </div>
  </section>

  <section id="panel-mssr" class="tab-panel" role="tabpanel" aria-labelledby="tab-mssr" data-panel="mssr" data-ux-contract="human-v1" hidden>
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
      <nav class="mssr-local-nav span-12" aria-label="Diagnóstico MSSR" data-ux-layer="aggregate">
        <button type="button" data-mssr-nav="overview" aria-current="true">Overview</button>
        <button type="button" data-mssr-nav="context">Contexto y health</button>
        <button type="button" data-mssr-nav="routing">Routing y skills</button>
        <button type="button" data-mssr-nav="identity">Identidad y host</button>
        <button type="button" data-mssr-nav="outcomes">Outcomes</button>
      </nav>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Presión de contexto</div><h2 class="card-title">Ensamblado selectivo</h2><p class="card-description">Compara el texto que habría entrado completo con el contexto realmente ensamblado. El ahorro no mide calidad; muestra presión evitada.</p></div><span id="mssr-context-planner" class="status-pill" data-tone="info"><span class="dot info"></span><span>sin planner observado</span></span></div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Cargado</div><div id="mssr-context-loaded" class="metric-value">—</div><div class="metric-note"><span id="mssr-context-loads">—</span> cargas medibles</div></div>
            <div class="metric-card"><div class="metric-label">Completo estimado</div><div id="mssr-context-full" class="metric-value">—</div><div class="metric-note"><span id="mssr-context-fallbacks">—</span> fallbacks full</div></div>
            <div class="metric-card"><div class="metric-label">Ahorrado</div><div id="mssr-context-saved" class="metric-value">—</div><div class="metric-note"><span id="mssr-context-skips">—</span> contextos omitidos</div></div>
            <div class="metric-card"><div class="metric-label">Tasa de ahorro</div><div id="mssr-context-savings" class="metric-value">—</div><div class="metric-note"><span id="mssr-context-duplicates">—</span> caracteres duplicados evitados</div></div>
          </div>
        </div>
      </article>
      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Auditoría diaria · read-only</div><h2 class="card-title">Salud estructural de skills</h2><p class="card-description">Revisa si el core sigue siendo un buen “sombrero”, si las recipes están indexadas y si una skill cae a carga completa. WATCH/REVIEW son propuestas de mantenimiento, no errores de routing ni permiso para autoeditar.</p></div><span id="mssr-skill-health-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>sin snapshot</span></span></div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Owned skills</div><div id="mssr-skill-health-owned" class="metric-value">—</div><div class="metric-note"><span id="mssr-skill-health-manifests">—</span> con manifest</div></div>
            <div class="metric-card"><div class="metric-label">WATCH</div><div id="mssr-skill-health-watch" class="metric-value">—</div><div class="metric-note">revisión preventiva</div></div>
            <div class="metric-card"><div class="metric-label">REVIEW</div><div id="mssr-skill-health-review" class="metric-value">—</div><div class="metric-note">prioridad estructural</div></div>
            <div class="metric-card"><div class="metric-label">Historial</div><div id="mssr-skill-health-snapshots" class="metric-value">—</div><div class="metric-note">snapshots diarios</div></div>
          </div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Skill</th><th>Estado</th><th>Core</th><th>Recipes</th><th>Δ chars</th><th>Señal / acción</th></tr></thead><tbody id="mssr-skill-health"><tr><td colspan="6" class="muted">Cargando salud estructural…</td></tr></tbody></table></div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Auditoría diaria · project control plane</div><h2 class="card-title">Salud de contexto de proyectos</h2><p class="card-description">MSSR revisa inicialización, tamaño de PROJECT_*, presión de core/módulos y knowledge no indexado en el workspace. WATCH queda silencioso; REVIEW genera atención y un plan, nunca autoedición.</p></div><span id="mssr-project-health-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>sin snapshot</span></span></div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Proyectos</div><div id="mssr-project-health-projects" class="metric-value">—</div><div class="metric-note"><span id="mssr-project-health-initialized">—</span> inicializados</div></div>
            <div class="metric-card"><div class="metric-label">OK</div><div id="mssr-project-health-ok" class="metric-value">—</div><div class="metric-note">control plane sano</div></div>
            <div class="metric-card"><div class="metric-label">WATCH</div><div id="mssr-project-health-watch" class="metric-value">—</div><div class="metric-note">visible, sin notificación</div></div>
            <div class="metric-card"><div class="metric-label">REVIEW</div><div id="mssr-project-health-review" class="metric-value">—</div><div class="metric-note"><span id="mssr-project-health-snapshots">—</span> snapshots</div></div>
          </div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Estado</th><th>Core / módulos</th><th>Δ findings</th><th>Señal / siguiente acción</th></tr></thead><tbody id="mssr-project-health"><tr><td colspan="5" class="muted">Cargando salud de proyectos…</td></tr></tbody></table></div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Operational Notice Plane · infraestructura</div><h2 class="card-title">Tunnel / runtime / restart</h2><p class="card-description">Correlaciona salud del túnel, continuidad del boot y estado del watchdog. Una respuesta perdida o 502 externo es evidencia de transporte, no prueba automática de que Bridge o la operación hayan fallado.</p></div><span id="mssr-runtime-health-status" class="status-pill" data-tone="info"><span class="dot info"></span><span>sin snapshot</span></span></div>
        <div class="card-body">
          <div class="metric-grid">
            <div class="metric-card"><div class="metric-label">Tunnel</div><div id="mssr-runtime-health-tunnel" class="metric-value">—</div><div class="metric-note">healthz + readyz</div></div>
            <div class="metric-card"><div class="metric-label">Runtime</div><div id="mssr-runtime-health-runtime" class="metric-value">—</div><div class="metric-note">continuidad entre boots</div></div>
            <div class="metric-card"><div class="metric-label">Restart</div><div id="mssr-runtime-health-restart" class="metric-value">—</div><div class="metric-note">request / watchdog ack</div></div>
            <div class="metric-card"><div class="metric-label">Historial</div><div id="mssr-runtime-health-history" class="metric-value">—</div><div class="metric-note">snapshots metadata-only</div></div>
          </div>
          <div id="mssr-runtime-health-detail" class="metric-note">Sin evidencia persistida todavía.</div>
        </div>
      </article>

      <article class="card span-7">
        <div class="card-header"><div><div class="card-kicker">Últimas ejecuciones</div><h2 class="card-title">Contexto por traza</h2><p class="card-description">Resume presión, presupuesto global y continuidad por ejecución sin almacenar contenido procedural ni cursores.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Traza</th><th>Skills</th><th>Contexto / presupuesto</th><th>Ahorro</th><th>Incidentes</th></tr></thead><tbody id="mssr-context-traces"><tr><td colspan="5" class="muted">Cargando trazas…</td></tr></tbody></table></div>
      </article>

      <article class="card span-5">
        <div class="card-header"><div><div class="card-kicker">Migración guiada</div><h2 class="card-title">Presión por skill</h2><p class="card-description">Prioriza manifests, revisión de cores o presupuesto usando cargas observadas, no sólo tamaño en disco.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Skill</th><th>Cargas</th><th>Core</th><th>Señal</th></tr></thead><tbody id="mssr-context-pressure"><tr><td colspan="4" class="muted">Cargando presión…</td></tr></tbody></table></div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Decisión del router</div><h2 class="card-title">Skills seleccionadas</h2><p class="card-description">Candidatas activas de cada fase. Seleccionar no prueba que el agente haya cargado o aplicado la guía.</p></div></div>
        <div id="mssr-selected-skills" class="tool-list"><div class="empty-state">Cargando selección…</div></div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Activación comprobada</div><h2 class="card-title">Skills cargadas</h2><p class="card-description">Cargas exitosas de <code>SKILL.md</code> correlacionadas con una traza. No son tool calls de dominio.</p></div></div>
        <div id="mssr-loaded-skills" class="tool-list"><div class="empty-state">Cargando activaciones…</div></div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Decisión del host</div><h2 class="card-title">Aceptadas vs. descartadas por skill</h2><p class="card-description">Mide candidatas opcionales después del routing. Un <code>skipped</code> es feedback contextual para esa firma semántica, no una penalización global ni un fallo de carga.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Skill</th><th>Aceptadas</th><th>Skips</th><th>Aceptación</th><th>Motivos</th><th>Firmas</th></tr></thead><tbody id="mssr-selection-feedback"><tr><td colspan="6" class="muted">Cargando decisiones del host…</td></tr></tbody></table></div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Aprendizaje histórico · observe-only</div><h2 class="card-title">Priors contextuales por firma semántica</h2><p class="card-description">Se calculan desde <code>learning_digest</code> al cerrar trazas. Por ahora sólo recolectan métricas/probabilidades empíricas: <strong>no influyen</strong> en routing, scores, permisos ni carga de contexto. <code>insufficient-evidence</code> indica que todavía no alcanzó el umbral mínimo.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Skill</th><th>Evidencia</th><th>Aceptación</th><th>Activación</th><th>Éxito cargada</th><th>Prior</th><th>Firma</th></tr></thead><tbody id="mssr-learning-priors"><tr><td colspan="7" class="muted">Cargando learning digests…</td></tr></tbody></table></div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Uso individual del sistema</div><h2 class="card-title">Activación MSSR por identidad observada</h2><p class="card-description">Une lifecycle MSSR con metadata host sólo cuando comparten exactamente un traceId. Si no existe evidencia host, se conserva el perfil del lifecycle.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Perfil</th><th>Tareas</th><th>Routing</th><th>Route → load</th><th>Requeridas</th><th>Verificación</th></tr></thead>
            <tbody id="mssr-agent-activation"><tr><td colspan="6" class="muted">Cargando perfiles…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Resultado individual</div><h2 class="card-title">Rendimiento MSSR por identidad observada</h2><p class="card-description">Se completa al registrar outcomes. “Pendiente” significa que la tarea sigue abierta; no equivale a 0% de calidad ni a un fallo.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Perfil</th><th>Cierre / estado</th><th>Éxito</th><th>Aceptación</th><th>Score</th><th>Tiempo</th><th>Loop / correcciones</th></tr></thead>
            <tbody id="mssr-agent-results"><tr><td colspan="7" class="muted">Cargando perfiles…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Ruta observable del conector</div><h2 class="card-title">Llamadas físicas y lifecycle MSSR</h2><p class="card-description">Cuenta llamadas físicas observadas: ejecución directa del Bridge, fallback y llamadas nativas de OpenCode. Los eventos route/load/verify/outcome quedan separados como lifecycle MSSR; no se suman como tool calls.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Perfil</th><th>Bridge directas</th><th>Host OpenCode</th><th>Query</th><th>Action</th><th>Fallback</th><th>Desvíos / tarea</th><th>Primera acción</th><th>Span tools</th><th>Silencios</th></tr></thead>
            <tbody id="mssr-agent-transport"><tr><td colspan="10" class="muted">Cargando rutas observables…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header">
          <div><div class="card-kicker">Comparativa por esfuerzo de razonamiento</div><h2 class="card-title">Ejecución observable por bucket</h2><p class="card-description">Metadata del host correlacionada al mismo <code>trace_id</code> que el lifecycle; el esfuerzo jamás se deriva de la variante. <code>unknown</code> y <code>multiple-observed</code> quedan separados y <code>other</code> agrupa valores no estándar. Compara ejecución y routing observables —llamadas físicas, split bridge/host/delegadas, desvíos y coberturas lifecycle/outcome— y no mide calidad ni expone razonamiento privado.</p></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Esfuerzo</th><th>Trazas</th><th>Llamadas físicas</th><th>Bridge directas</th><th>Host OpenCode</th><th>Query / action</th><th>Fallback</th><th>Desvíos / traza</th><th>Route → load</th><th>Verificación</th><th>Persistencia</th><th>Outcome</th><th>Éxito</th></tr></thead>
            <tbody id="mssr-effort-comparison"><tr><td colspan="13" class="muted">Cargando comparativa…</td></tr></tbody>
          </table>
        </div>
      </article>

      <article class="card span-12">
        <div class="card-header"><div><div class="card-kicker">Atribución primaria</div><h2 class="card-title">Outcomes por skill primaria</h2><p class="card-description">Cada tarea cerrada acredita una sola skill primaria para no multiplicar el éxito. Las skills de apoyo siguen visibles en la traza, pero no reciben otro outcome.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Skill</th><th>Tareas</th><th>Éxito</th><th>Aceptación</th><th>Score</th><th>Distribución</th></tr></thead>
            <tbody id="mssr-skill-outcomes"><tr><td colspan="6" class="muted">Cargando…</td></tr></tbody>
          </table>
        </div>
      </article>
    </div>
  </section>

  <section id="panel-errors" class="tab-panel" role="tabpanel" aria-labelledby="tab-errors" data-panel="errors" data-ux-contract="human-v1" hidden>
    <div class="grid">
      <article class="card span-12" data-ux-layer="aggregate">
        <div class="card-header">
          <div><div class="card-kicker">Últimos registros</div><h2 class="card-title">Errores recientes</h2><p class="card-description">El resumen está truncado para lectura rápida; expandí una fila para ver el mensaje completo.</p></div>
          <div class="card-header-actions"><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre errores recientes">?</summary><div class="context-help-popover" role="note"><strong>Misma evidencia, más detalle</strong><span>Cada fila resume un fallo ya incluido en el snapshot actual. Al expandirla ves el mensaje completo y el perfil observado sin consultar otra ventana ni disparar una acción.</span></div></details><span id="recent-errors-count" class="status-pill" data-tone="warn"><span class="dot warn"></span><span>—</span></span></div>
        </div>
        <div id="error-list" class="error-list"><div class="empty-state">Cargando errores…</div></div>
      </article>
    </div>
  </section>

  <section id="panel-system" class="tab-panel" role="tabpanel" aria-labelledby="tab-system" data-panel="system" data-ux-contract="human-v1" hidden>
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
          <div class="system-field"><div class="system-label">Máximo de conexiones MCP</div><div id="system-max-sessions" class="system-value">—</div></div>
        </div>
      </article>

      <article class="card span-6">
        <div class="card-header"><div><div class="card-kicker">Persistencia local</div><h2 class="card-title">Observabilidad</h2></div><details class="context-help"><summary class="info-button" aria-label="Ayuda sobre epoch, baseline, contrato y scope">?</summary><div class="context-help-popover" role="note"><strong>Cómo leer esta card</strong><span>Epoch = ventana compartida de comparación; baseline = cuándo empezó. Contrato identifica el esquema de trazas y scope define qué historia entra por defecto. Son metadatos de observabilidad, no estados de negocio.</span></div></details></div>
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
    </div>
  </details>
</main>

<div id="v2-inspector-backdrop" class="v2-inspector-backdrop" hidden></div>
<aside id="v2-inspector" class="v2-inspector" role="dialog" aria-modal="true" aria-labelledby="v2-inspector-title" aria-hidden="true" hidden>
  <div class="v2-inspector-head">
    <div><div class="v2-eyebrow">Evidencia técnica</div><h2 id="v2-inspector-title">Inspector</h2></div>
    <button id="inspector-close" class="inspector-close" type="button" aria-label="Cerrar Inspector">×</button>
  </div>
  <p class="v2-inspector-intro">Datos exactos del snapshot actual. El drill-down contextual completo llega en V2-D.</p>
  <div class="v2-inspector-grid">
    <div><span>Servidor</span><strong id="inspector-server">—</strong></div>
    <div><span>PID</span><strong id="inspector-pid">—</strong></div>
    <div><span>Runtime boot</span><code id="inspector-boot">—</code></div>
    <div><span>Inicio runtime</span><strong id="inspector-started">—</strong></div>
    <div><span>Transporte</span><strong id="inspector-transport">—</strong></div>
    <div><span>Epoch MSSR</span><code id="inspector-epoch">—</code></div>
    <div><span>Snapshot</span><strong id="inspector-snapshot">—</strong></div>
    <div><span>Build snapshot</span><strong id="inspector-build">—</strong></div>
  </div>
</aside>
`;
