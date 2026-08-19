# bridge-mcp

MCP local propio para conectar ChatGPT con MauroPrime mediante OpenAI Secure MCP Tunnel.

El objetivo es tener un puente local controlado por nosotros para operar filesystem, shell, Git, diagnosticos, reinicio seguro, metricas e inteligencia de codigo sin depender de un runner generico.

## Estado actual

```text
bridge-mcp current release v0.6.107
Live runtime: v0.6.107
Packaged MSSR: 0.2.32
Mode: Streamable HTTP live; Operational Notice Plane Gate E5 migration/invariant integration closed and live-verified
Project root: D:\Dev\bridge-mcp
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Rollback: stdio via scripts/start-bridge-watchdog.ps1
```

Ruta activa recomendada:

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> tunnel-client profile bridge-local-http
  -> http://127.0.0.1:3001/mcp
  -> bridge-mcp Streamable HTTP en MauroPrime
  -> filesystem / shell / git / procesos / analisis de codigo
```

`stdio` sigue disponible solamente como rollback estable.

## Stack

```text
Node.js v24.x
TypeScript
@modelcontextprotocol/sdk
zod
node:sqlite para metricas locales
MCP Streamable HTTP local
OpenAI Secure MCP Tunnel mediante tunnel-client
```

## Arquitectura actual

```text
src/bridge-server.ts
  Router MCP minimo:
  - tools/list
  - tools/call
  - metricas begin/end

src/tool-registry.ts
  Registry modular central

src/tools/*.ts
  Modulos de tools por dominio

src/tools/shared/*.ts
  Helpers transversales
```

Modulos actuales:

```text
core
file-navigation
file-writing
workflow-guides
images
process
git
project
workspace
cache
bridge-ops
metrics
code-intelligence
code-graph
python-analysis
blender
tablet-whiteboard
bridge-workflow
```

## Contexto de proyecto y guias reutilizables

Para trabajo sustancial en un repositorio, ChatGPT debe llamar una vez a `project_context_load` con `projectRoot` y la tarea actual. La tool puede cargar:

```text
<project>/AGENTS.override.md o AGENTS.md
<project>/.mssr/PROJECT_CONTEXT.md
<project>/.mssr/PROJECT_MEMORY.md
<project>/.mssr/PROJECT_STATE.md
<project>/.bridge/workflow-guides/*
```

`AGENTS.md` sigue siendo la entrada nativa para Codex. En ChatGPT web, la carga ocurre por instrucciones MCP y `project_context_load`; las guias aplicables se detectan con `workflow_guide_recommend` y se incorporan con `workflow_guide_load`.

MSSR project context es canonical-only: `.mssr/project-context.json` es el único manifest activo, `.mssr/knowledge/` contiene memoria modular durable y `.mssr/runtime/` contiene receipts/cache efímeros. `project_context_load` nunca cae a `.bridge/`; un repo sin contrato válido devuelve estado no inicializado y debe pasar explícitamente por `project_context_initialize`. Con un manifest válido, el core se carga primero y `@mauroprime/mssr` selecciona módulos de contexto/memoria/estado/directivas por intent y stage. `project_context_health` clasifica `ok/watch/review`; `project_context_audit` aplica esa salud recursivamente a un workspace; `project_context_capture` persiste conocimiento revisado en `.mssr/knowledge/` con transacción contenido+manifest. `project_change_consistency` compara Git, versión, changelog e impacto PROJECT_* y puede bloquear `persist`, pero ningún audit/watch inventa memoria automáticamente.

Para debugging/recovery MSSR puede cargar selectivamente sólo `changelogs/INDEX.md` y el changelog de la versión actual. `changelogs/LEGACY.md` queda fuera del contexto normal y se consulta únicamente para una regresión histórica concreta.

### Operational Notice Plane

Bridge usa `bridgeNotices` como único transporte general de avisos operativos: cola acotada, TTL, deduplicación pendiente, historial reciente y entrega automática dentro de una respuesta MCP posterior. MSSR define la política portable que decide si evidencia acotada merece atención; Bridge observa el host/proyecto y adapta el candidato al transporte. No se crea una segunda cola MSSR.

Trace, outcome, Context Message y aviso operacional son contratos distintos. Un aviso puede sugerir un preflight o una recuperación, pero nunca autoriza ni ejecuta esa acción automáticamente. Tampoco es server push: no puede interrumpir una tool opaca en curso y normalmente llega en el siguiente límite MCP observable.

Desde 0.6.99, Skill Health y Project Context Health comparan cada snapshot diario con el anterior y usan fingerprints estructurales acotados. `OK/WATCH` estable queda silencioso; `REVIEW` estable con la misma evidencia no se repite después de que el aviso anterior haya sido drenado; cambios materiales, escaladas/deescaladas y resoluciones sí generan transición. Ver `docs/OPERATIONAL_NOTICE_PLANE_ADAPTER.md` y la especificación portable de MSSR.
Desde 0.6.100, el mismo contrato cubre también lifecycle idle/missing-outcome, mantenimiento de conocimiento y frescura del Context Plane mediante proyecciones portables de MSSR 0.2.20. El timer y los leases siguen siendo responsabilidad del host: idle sólo puede pedir REVIEW, `progress`/outcome resuelven esa atención y el callback revalida cualquier lease nuevo antes de avisar. La frescura es estado actual (`fresh=OK`, unknown-only=WATCH, stale/unavailable=REVIEW, conflicting=ERROR), por lo que volver a `fresh` resuelve el aviso de frescura aunque una deuda durable ya acumulada siga necesitando un cierre explícito de mantenimiento.

Desde 0.6.105, C2e conecta proyecto+memoria con el mismo plano: `src/project-situation.ts` observa proyectos gestionados que tengan receipts operativamente activos del Context Plane, compara las revisiones entregadas de PROJECT_CONTEXT/PROJECT_MEMORY/PROJECT_STATE/changelogs/ADRs con las revisiones canónicas actuales mediante el MSSR empaquetado y entrega la contradicción a C2c/C2d. En 0.6.107 el paquete MSSR es `0.2.32`; `/api/mssr/project-situation` sigue exponiendo sólo metadata acotada. `noticeClass`, categoría y prioridad sirven para enrutar atención, pero no crean otra cola ni otra autoridad. Un receipt nuevo/una carga actual reemplaza evidencia vieja para esa autoridad; una alerta puede resolver sin borrar historia. Bridge sólo muestra acciones C2d `ready` y nunca interpreta prosa libre de memoria como verdad canónica. Ver `docs/SITUATION_MODEL_ADAPTER.md`.

Desde 0.6.106, Gate E3 preserva el `MssrNotice v1` genuino como `BridgeNotice.mssrNotice` dentro del mismo `bridgeNotices`: `noticeId`, dedupe semántico y payload portable quedan intactos; `BridgeNotice.id`, timestamps, TTL, occurrences, mirrors de UI/details y acciones son metadata de delivery del host. En 0.6.107 / MSSR 0.2.32, Gate E5 cierra la migración: E4 direct-host sigue independiente, los notices Bridge-native y external-MCP conservan su identidad, el schema portable sigue rechazando metadata de delivery/ejecución y la cola general de Bridge sigue siendo una sola. Ver `docs/OPERATIONAL_NOTICE_PLANE_ADAPTER.md`.
Las guias globales viven en `integrations/workflow-guides/`. Las guias del proyecto tienen prioridad sobre una global con el mismo nombre.

## Tools expuestas

El catálogo MCP sigue en `156` tools. La release live `0.6.107` carga `@mauroprime/mssr` `0.2.32`; Gate E5 no agrega otra MCP tool ni otra cola. La adopción quedó probada por full regression, `bridge_verify_all` con `failedRequired=0`, watchdog/tunnel `live/ready`, matriz E5 y relay `mssr-notice-v1` preservado.

`blender_review_bundle` genera en una sola llamada vistas ortográficas múltiples, una hoja de contacto adjunta al resultado MCP y un manifiesto con geometría, materiales, colecciones, visibilidad, rig, acciones, diagnósticos, hashes y confirmación de restauración de la escena.

`whiteboard_capture_pc_view` solicita una captura fresca al navegador de PC que está viendo TabletWhiteboard, respeta su pan/zoom actual y adjunta el PNG al resultado MCP. Como crea un archivo y un registro SQLite, se clasifica como herramienta mutante neutral, no como consulta de solo lectura. `whiteboard_latest_capture` y `whiteboard_capture_list` siguen siendo read-only.

`whiteboard_add_text` crea cajas de texto estructuradas. `whiteboard_add_diagram` crea rectángulos, elipses, líneas, flechas, polylines, polígonos, etiquetas y paths SVG con curvas Bézier cuadráticas o cúbicas. `whiteboard_add_svg` acepta SVG sanitizado, y `whiteboard_insert_image` sube un PNG/JPEG/WebP local existente después de validar política de rutas, tamaño, MIME y firma. Todas escriben objetos bloqueados dentro de la capa separada de ChatGPT y conservan persistencia, undo/redo, backups, exportación y capturas.

Antes de adjuntar una captura, Bridge compara el tamaño HTTP, los bytes reales, las dimensiones del IHDR y el SHA-256 con los metadatos entregados por TabletWhiteboard. Una inconsistencia cancela la operación.

El origen predeterminado se configura con `TABLET_WHITEBOARD_URL`. Orígenes privados adicionales deben declararse explícitamente, separados por comas, en `TABLET_WHITEBOARD_ALLOWED_ORIGINS`. Todos deben usar `http://`, no incluir credenciales/rutas y apuntar a localhost o una red LAN privada.

```powershell
$env:TABLET_WHITEBOARD_URL = "http://127.0.0.1:8787"
$env:TABLET_WHITEBOARD_ALLOWED_ORIGINS = "http://192.168.1.33:8787"
```


### Core / lectura / navegacion

```text
system_info
list_dir
read_text_file
read_file_lines
read_many_files
list_files_smart
search_files
```

### Escritura segura

```text
write_text_file
apply_patch
edit_lines
```

`write_text_file`, `apply_patch` y `edit_lines` hacen verificacion postflight con hash/bytes/contexto cuando corresponde.

### Archivos binarios

```text
binary_file_info
binary_file_read_chunk
binary_file_write
binary_upload_begin
binary_upload_append
binary_upload_status
binary_upload_finish
binary_upload_abort
```

`binary_file_write` cubre payloads pequenos. Para imagenes, ZIP, GLB u otros binarios grandes, usar el flujo reanudable `begin -> append -> status -> finish`, con secuencias, validacion de bytes/SHA-256 y escritura atomica. No enviar base64 a `write_text_file`.

### Ejecucion / terminal

```text
run_command
terminal_start
terminal_write
terminal_read
terminal_stop
terminal_list
work_once
work_begin
work_peek
work_show
work_feed
work_finish
```

Robustez de procesos:

- Los timeouts terminan el arbol completo del proceso en Windows, no solamente el shell intermediario.
- Una sesion finalizada por senal se informa como `running: false` y respeta `cleanupAfterMs`, incluso cuando vale `0`.
- Los aliases `work_*` tienen esquemas tipados y las mismas anotaciones de riesgo que sus tools equivalentes.
- La lista de comandos bloqueados es una barrera contra accidentes, no una sandbox. El Bridge debe mantenerse en un entorno confiable.

### Git

```text
git_status
git_diff
git_log
git_show_commit
git_compare_branches
git_create_branch
git_restore_file
git_set_remote
git_commit_all
git_push_current_branch
```

Los comandos Git validan refs y rutas, limitan la salida y filtran archivos sensibles. `git_commit_all` hace preflight de archivos modificados, staged y untracked antes de ejecutar `git add`.

### Proyecto / politica de rutas

```text
path_policy_status
project_profile
project_profile_save
```

`project_profile` detecta lenguajes, frameworks, package manager, scripts, comandos utiles, archivos importantes y estado Git. `project_profile_save` guarda overrides separados de los datos detectados en `.bridge-project.json`.

### Snapshots de workspace

```text
workspace_snapshot
workspace_diff
workspace_rollback
workspace_snapshot_list
```

Los snapshots se guardan fuera del proyecto, excluyen carpetas generadas y archivos sensibles, verifican hashes y rutas antes del rollback y rechazan restauraciones desde snapshots truncados.

### Cache persistente

```text
cache_status
cache_prune
```

El cache JSON tiene TTL, limites de bytes/entradas, poda automatica y `dryRun` para revisar eliminaciones antes de aplicarlas.

### Bridge / salud / restart

```text
tunnel_health
bridge_health
bridge_self_check
bridge_verify_all
bridge_request_restart
bridge_restart_status
```

### Metricas / visualizaciones

```text
bridge_metrics_query
bridge_metrics_status
bridge_metrics_summary
bridge_metrics_recent
bridge_visualization_catalog
bridge_visualize_metrics
mssr_observatory_query
mssr_trace_record
mssr_observatory_epoch_start
```

### Inteligencia de codigo

```text
analyze_code
impact_analysis
find_duplicate_symbols
import_graph
dependency_graph
call_graph
find_dead_code
```

Motores disponibles:

```text
regex       -> rapido y simple
typescript  -> AST por archivo
semantic    -> TypeScript Program + TypeChecker entre archivos
```

`import_graph` y `dependency_graph` aceptan:

```json
{
  "resolutionEngine": "auto | relative | typescript"
}
```

Con `typescript` o `auto`, el grafo usa el resolver del compilador TypeScript, incluyendo `tsconfig.json`, `baseUrl`, `paths`, barrels/index files y reescritura de extensiones cuando TypeScript puede resolverlas.

## Scripts principales

```powershell
npm install
npm run check
npm run build
npm run smoke:http
npm run test:regressions
npm run verify:all
npm run start
npm run start:http
```

`npm run verify:all` ejecuta:

```text
bridge-doctor.ps1
npm run check
npm run build
smoke:http
test:regressions
docs:tools:check
tools/list sanity
git status
```

## Validacion rapida

```powershell
Set-Location C:\dev\bridge-mcp
npm run check
npm run build
.\scripts\test-bridge-http.ps1
.\scripts\test-bridge-regressions.ps1
.\scripts\bridge-doctor.ps1
```

Desde MCP, usar preferentemente:

```text
bridge_self_check
bridge_verify_all
bridge_restart_status
git_status
```

Estado esperado:

```text
bridge_self_check.ok = true
server.version = 0.6.21
tunnel.baseUrl = http://127.0.0.1:8081
tunnel healthz = live
tunnel readyz = ready
git = ## main...origin/main
```

## HTTP local production-candidate

Endpoints locales:

```text
GET  http://127.0.0.1:3001/healthz
GET  http://127.0.0.1:3001/readyz
GET  http://127.0.0.1:3001/status
GET  http://127.0.0.1:3001/dashboard
GET  http://127.0.0.1:3001/api/mssr/summary?days=30&scope=active
POST http://127.0.0.1:3001/mcp
```

El resumen MSSR separa por caller/modelo las llamadas físicas directas de los
fallbacks `bridge_tool_query` y `bridge_tool_action`. También informa desvíos de
descubrimiento previos a la primera acción de dominio, tiempo hasta esa acción,
span de tools y recordatorios por inactividad. Un recordatorio idle no demuestra
que la interfaz de ChatGPT haya quedado bloqueada.

Limites y seguridad HTTP:

```text
BRIDGE_MCP_HTTP_MAX_SESSIONS=64
BRIDGE_MCP_HTTP_MAX_BODY_BYTES=16777216
BRIDGE_MCP_HTTP_SESSION_IDLE_MS=1800000
BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS=15000
BRIDGE_MCP_HTTP_ANON_TTL_MS=60000
```

Las inicializaciones reservan capacidad de forma atomica. Si se alcanza el limite, el Bridge conserva todas las sesiones con requests activos y puede reciclar la sesion inactiva mas antigua que ya supere `BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS`; si todas siguen activas o son demasiado recientes, responde `503`. Los clientes locales de smoke/verificacion cierran sus sesiones mediante `DELETE /mcp`. Los cuerpos JSON que superan `BRIDGE_MCP_HTTP_MAX_BODY_BYTES` responden `413`. El servidor sigue limitado a loopback por defecto.

Perfil de tunel:

```text
bridge-local-http -> http://127.0.0.1:3001/mcp
```

Admin local del tunnel-client:

```text
http://127.0.0.1:8081
```

Si aparece `8080`, tratarlo como contexto viejo salvo que se haya cambiado intencionalmente el perfil.

## Watchdog y restart seguro

Modo HTTP recomendado:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-http-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp -Profile bridge-local-http -TunnelBaseUrl http://127.0.0.1:8081
```

Instalacion al inicio de Windows sin admin:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\install-bridge-watchdog-task.ps1 -InstallMode Startup -WatchdogMode Http
```

Restart seguro desde MCP:

```text
bridge_request_restart
```

Ese flujo escribe `.bridge-restart-request`; el watchdog externo reinicia HTTP/tunnel y luego escribe `.bridge-restart-ack`. No matar `node.exe` ni `tunnel-client.exe` directamente desde el MCP activo.

Antes de adoptar o detener un proceso, el watchdog verifica el nombre/version del Bridge, el transporte, el puerto y la linea de comando esperada. Si el puerto pertenece a un proceso desconocido, aborta en vez de matarlo.

Rollback stdio:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```

## Metricas y logs

Runtime local:

```text
logs/bridge-events.jsonl
logs/mssr-events.jsonl
data/bridge-metrics.sqlite
data/bridge-metrics.sqlite-wal
data/bridge-metrics.sqlite-shm
```

Consultas rapidas:

```powershell
node .\scripts\query-bridge-metrics.mjs status
node .\scripts\query-bridge-metrics.mjs summary 50
node .\scripts\query-bridge-metrics.mjs recent 25
node .\scripts\query-bridge-metrics.mjs errors 25
```

Variables utiles:

```text
BRIDGE_MCP_METRICS_ENABLED=0
BRIDGE_MCP_METRICS_DIR=...
BRIDGE_MCP_LOG_DIR=...
BRIDGE_MCP_METRICS_SQLITE=...
BRIDGE_MCP_EVENTS_JSONL=...
BRIDGE_MCP_MSSR_EVENTS_JSONL=...
BRIDGE_MCP_MSSR_STATE=...
BRIDGE_MCP_MSSR_TRACE_LEASE_MS=7200000
BRIDGE_MCP_WEB_CLOSURE_IDLE_MS=60000
BRIDGE_MCP_MSSR_UNROUTED_WARNING_MS=60000
```

Las métricas generales guardan nombres de tools, duración, éxito/error, claves de input y tamaño de salida. No guardan argumentos completos.

El MSSR Observatory agrega trazas correlacionadas para rutas, cargas, replans, fuentes de contexto, verificación, persistencia, outcomes, fricción y correcciones. Con `trace-contract-v1`, Bridge propaga la traza dentro de una sesión, mediante una lease compartida del proceso y, cuando la memoria del coordinador no está disponible, desde SQLite. Primero exige coincidencia exacta de sesión anónima o proyecto; si el conector rotó esa metadata o la misma tarea pasó a un repositorio relacionado, sólo adopta automáticamente la única traza abierta del mismo caller. Nunca usa el nombre de una skill para elegir entre dos tareas concurrentes. Si varias trazas pueden corresponder, emite `mssr-trace-ambiguous` y exige un ID explícito. Reinicios históricos y reanudaciones deliberadamente ambiguas también requieren `traceId`. No se guardan prompts crudos, transcripciones ni cadena de pensamiento.

Cada outcome sustancial declara una sola `primarySkill`; las `supportingSkills` quedan como contribución sin duplicar éxito. Reintentos y revisiones reutilizan el mismo trace y el resumen cuenta el último outcome. El dashboard separa routing semántico, continuidad route→load, required-load compliance, verificación/persistencia, éxito, aceptación y score por skill primaria.

Para `caller=chatgpt-web`, el coordinador arma un watchdog después de actividad sustantiva trazada o de un checkpoint no final. Routing, carga de contexto, catálogo/audit, consultas del observatorio y `skill_load` son preparación observable y no inician por sí solos la ventana. Si después de trabajo real la traza queda abierta sin `outcome` durante `BRIDGE_MCP_WEB_CLOSURE_IDLE_MS`, emite `mssr-web-outcome-missing-after-idle` y persiste un evento privado `closure_reminder`. Otra actividad sustantiva reinicia la ventana y un `outcome` la cancela. El resumen MSSR expone `surfaces` para comparar cobertura de outcomes y recordatorios entre `chatgpt-web`, `codex-local` y otros callers. Este control observa el lifecycle MCP; no puede probar que el navegador haya renderizado el texto final.

La telemetría actual usa una época persistida `trace-contract-v1`. `/api/mssr/summary?scope=active` y el dashboard muestran sólo la línea base actual; `scope=all` conserva la historia anterior para comparar sin borrarla. `mssr_observatory_epoch_start` abre deliberadamente una línea base activa nueva con confirmación y razón, sin eliminar eventos previos. Las métricas `surfaces` separan `codex-local`, `chatgpt-web` y `other`; `agentProfiles` cruza ese caller con `model` y `reasoningEffort` (`gpt-5.6-terra`, `gpt-5.6-sol`, `low`, `medium`, `high`, etc.). En Codex, Bridge toma automáticamente esos campos de `x-codex-turn-metadata` cuando el host los entrega; otros hosts pueden declararlos explícitamente. Bridge no los infiere por latencia, longitud o conducta: cuando no puede probarlos registra `unknown`. MSSR se consulta antes de cadenas especializadas y se replantea al cambiar de fase, ante fallos materiales, cambios de provider/schema, capabilities nuevas o fricción reusable; no se ejecuta entre cada lectura o comando exitoso de la misma fase.

OpenCode aporta esa identidad desde un plugin de host separado: `/api/mssr/events`
acepta `mssr-host-call-v1` y guarda agente, modelo, variante, duración, estado e
identificadores correlacionables con hash como métricas de ejecución. Estos
eventos no inventan outcomes MSSR y nunca contienen prompts, argumentos,
outputs ni errores crudos.

La proyección lifecycle usa esa identidad únicamente cuando la llamada host y
la ruta comparten el mismo `traceId`. Si falta evidencia host conserva
`lifecycle-only`; si una traza contiene varios agentes o modelos muestra
`multiple-observed` en vez de elegir el más reciente. Una relación padre de
subagente sólo existe cuando OpenCode expone `parentID`: Bridge persiste su hash
y el dashboard muestra únicamente la cardinalidad de padres observados. Las
llamadas físicas del Bridge, wrappers y host OpenCode se cuentan por separado
de los eventos route/load/checkpoint.

La misma época gobierna ahora las métricas generales de tools. `/api/metrics/*` y `bridge_metrics_*` usan `scope=active` por defecto, mientras `scope=all` conserva el acumulado. Cada llamada nueva guarda `traceId`, `caller`, `model` y `reasoningEffort` cuando son observables; el dashboard muestra llamadas, errores y latencia agrupados por ese perfil para no mezclar Codex con ChatGPT Web ni variantes de modelo.

La identidad de superficie también se obtiene del `clientInfo` del handshake MCP. Una tool genérica o stateless hereda la única traza abierta compatible con su caller para fines de observabilidad, sin inyectar argumentos fuera de schema ni volver a ejecutar MSSR entre llamadas. El dashboard MSSR separa por perfil routing estructurado, route→load, cargas requeridas, verificación, cierre, éxito, aceptación, score, duración, recordatorios de loop y correcciones del usuario.

El dashboard distingue herramientas MCP de skills. Las herramientas son llamadas
ejecutables y se agregan por nombre, latencia y error. MSSR registra por separado
skills seleccionadas por el router, skills realmente cargadas y un único outcome
por `primarySkill`; las `supportingSkills` no duplican el éxito de la tarea.

El contador HTTP muestra conexiones MCP retenidas por el servidor, no cantidad
de chats de usuario. Una conexión puede quedar idle hasta `sessionIdleMs` y el
límite protege capacidad de transporte. En rendimiento, una traza enrutada sin
outcome todavía se muestra como `pendiente`; no se interpreta como 0% de calidad.
Los valores de modelo o esfuerzo no expuestos por el host se presentan como
`modelo no expuesto` / `esfuerzo no expuesto`. `work_once` es el alias corto de
`run_command` para ejecutar una única acción local acotada.

ChatGPT también entrega `_meta["openai/session"]`, un identificador anónimo de
conversación. Bridge lo vuelve a hashear localmente y deriva además un `task_key`
acotado desde el texto normalizado de `project_context_load`; no conserva ese
texto. El dashboard agrupa una fila por tarea observable, sesión anónima y
proyecto primario, en vez de interpretar cada agrupación como otro agente.
`project_context_load` fija el proyecto primario de la sesión. Los repositorios
observados después por `cwd`, `path` o `projectRoot` se agregan como relacionados
cuando difieren del primario; nunca lo reemplazan. Bridge no guarda el
identificador original ni argumentos completos. Esto permite distinguir tareas
Web concurrentes y mostrar qué repositorios auxiliares atravesó cada una.
Cuando Codex no expone ese identificador, una conexión MCP conserva los proyectos
cargados con `project_context_load` hasta abrir la siguiente ruta: uno se atribuye
por nombre y varios se clasifican como `multi-project`. Las llamadas posteriores
heredan el proyecto de la traza; una traza cerrada nunca se pega a otra carga de
contexto. Sin evidencia suficiente, la UI muestra `ámbito global o proyecto no
expuesto` y no inventa MyceliumFront desde el directorio del proceso Bridge.
La metadata oficial del cliente no incluye el modelo ni el nivel de
razonamiento: permanecen `unknown` en ChatGPT Web salvo declaración explícita.
`openai/userAgent` no se usa para inferirlos porque OpenAI lo define como una
pista opcional y best-effort.

Las métricas generales clasifican cada llamada como `bootstrap`, `exempt`,
`traced` o `unrouted`. La cobertura MSSR usa sólo tools elegibles
(`traced + unrouted`), de modo que health, métricas y el propio bootstrap no
deprimen artificialmente el porcentaje. Una llamada elegible sin traza emite
`mssr-unrouted-tool-call` con rate limit, pero no se bloquea: MSSR sigue siendo
asesor y no sustituye permisos ni ejecución. Al retomar un `traceId` explícito
después de reiniciar, Bridge reconstruye rutas y skills cargadas desde SQLite
antes de evaluar los gates de fase.

`skill_route_plan` y `skill_recommend` usan `responseMode=compact` por defecto:
devuelven la ruta accionable, nombres, razón corta, obligatoriedad, orden y
warnings. `responseMode=debug` conserva scores, planes de fase y metadata completa.
El contenido procedural entra mediante `skill_bootstrap` o `skill_load`. Bootstrap usa `contentMode=selective` por defecto y planifica globalmente el presupuesto. Para `caller=chatgpt-web`, además separa tres estados observables: **recommended**, **accepted/skipped** y **loaded**. Los roots requeridos siguen siendo obligaciones; sólo los roots opcionales reciben una decisión del host. Si un root opcional es `accepted`, su cierre transitivo de dependencias se materializa junto con él; si es `skipped`, las dependencias que existen únicamente por ese root permanecen fuera del contexto. Un `skipped` conserva un motivo acotado (`irrelevant-domain`, `redundant`, `deferred-phase`, `context-budget`, etc.) y no se registra como fallo de carga. El modo `auto` queda disponible para callers compatibles que no implementan gate explícito.

Bridge puede conservar durante una traza abierta working metadata acotada —resumen resuelto, hipótesis, decisiones/evidencia y próximo gate— únicamente en RAM. `mssr_trace_working_update` no escribe esa memoria en SQLite. En un `outcome`, Bridge primero intenta destilar un `learning-digest-v1` estricto y luego purga siempre la RAM; un fallo del destilado no retiene la memoria efímera ni bloquea un outcome verdadero. Nunca se copian al digest `workingSummary`, hipótesis activas, prompts crudos, transcripts, secretos, decisiones arbitrarias de scratchpad ni chain-of-thought privado.

El digest durable conserva sólo consecuencias estructuradas reutilizables: firma semántica canónica, skills recomendadas/cargadas/accepted-skipped, transiciones de stage a skill, decisiones de módulos de contexto de skill/proyecto, metadata final del outcome y únicamente hallazgos que terminaron `supported` o `rejected` con `evidenceRef`. Esto permite analizar continuidad y aprendizaje operativo sin convertir SQLite en un scratchpad histórico.

El coordinador de cierre expone un preflight con `closureDue`, `canCloseSuccess`, skills/fases faltantes y `nextRequiredAction`. Un idle puede producir un aviso `stale-open`/candidato a cierre, pero no demuestra que ChatGPT haya terminado ni autoriza `success`. Para recuperación stateless, una traza vieja puede seguir abierta y ser reanudada con `traceId` explícito mientras deja de competir automáticamente con una ruta fresca después de la ventana de auto-recovery.

En el dashboard, `skill_route_plan` significa **recomendada**, la tabla de decisión del host muestra **accepted/skipped por skill y firma semántica**, y cada evento de carga significa **contexto procedural entregado**. El observatorio agrega los learning digests por firma exacta para producir tasas empíricas/priores de skill, transición y contexto con umbral mínimo de evidencia. El learning permanece explícitamente `observe-only` con `routingInfluence=false`: `minEvidence` sólo habilita análisis, no activación. Antes de cualquier influencia futura deben pasar colección representativa, auditoría del dataset, replay/holdout, calibración y shadow evaluation. Sólo después una configuración versionada podría habilitar un peso histórico secundario y reversible; required skills, invariantes, permisos y routing determinista siguen siendo autoridad.

El discovery no bloqueante puede reutilizar metadata Roblox `cached` sin tratarla como una degradación global. Las rutas estructuradas que no incluyen el dominio `roblox` omiten esa fuente opcional; una ruta Roblox sí exige catálogo vivo antes de cargar o ejecutar capacidades de Studio.

Codex puede compactar una conversación larga. Bridge no recibe un evento privado
de compactación y no debe adivinarlo. La recuperación durable es conservar en el
resumen operativo el objetivo aceptado, proyecto, fase, restricciones, trabajo
completado, referencias pendientes y `traceId`; al continuar, usar
`project_context_load` cuando corresponda y replanificar con `stage=resume`,
pasando ese contexto acotado y el `traceId` explícito. Sólo se recargan las skills
activas que ya no estén disponibles en el contexto; no se vuelve a cargar todo el
grafo. Tras un reinicio del Bridge, el coordinador reconstruye desde SQLite la
ruta y las cargas observables de una traza explícita, pero no puede reconstruir
texto de skill que el host haya descartado.

Para ChatGPT Web, las métricas confiables son las llamadas que atravesaron
Bridge, caller, sesión anónima cuando el host la expone, proyecto declarado,
route/load/checkpoints/outcome, errores y duraciones. El chat completo, la salida
final de UI, tools nativas del host y el razonamiento privado no son observables;
no se copian ni se infieren. Los silencios se estudian como intervalos entre
eventos: tiempo hasta primera ruta, desvíos de descubrimiento, duración de tools
y pausa desde la última tool hasta un cierre observable.

## Modelo de uso desde laptop

Si ChatGPT se usa desde la laptop pero el conector apunta al tunel que corre en MauroPrime, las tools se ejecutan en MauroPrime.

```text
Laptop con ChatGPT UI
  -> OpenAI
  -> Secure MCP Tunnel activo en MauroPrime
  -> bridge-mcp ejecutado en MauroPrime
```

Para ejecutar tools en la laptop, la laptop necesita su propio bridge/tunnel/profile local.

## Seguridad

No commitear:

```text
node_modules/
dist/
binarios del tunnel-client
.env / claves / tokens
logs/
data/*.sqlite*
sandbox local
```

Mantener secretos como variables de entorno de Windows o perfiles locales fuera de Git.

La politica de rutas limita las tools explicitas a roots permitidos y bloquea rutas sensibles, enlaces simbolicos que escapen y archivos como `.env*`, credenciales de Git, claves SSH y tokens. Se configura con `BRIDGE_MCP_ALLOWED_ROOTS`, `BRIDGE_MCP_DENIED_PATHS` y `BRIDGE_MCP_DENIED_NAMES`; `path_policy_status` muestra la politica efectiva.

Las tools Git filtran archivos sensibles de diffs y commits mostrados. `git_commit_all` se niega a stagear o commitear si detecta una ruta sensible pendiente. Esta politica reduce el blast radius, pero `run_command` y las terminales siguen siendo shell confiable dentro de un cwd permitido, no una sandbox del sistema operativo.

## Docs relacionadas

```text
STATUS_CURRENT.md
docs/REPOSITORY_STRUCTURE.md
TOOLS.md
CONNECTOR_CONTEXT.md
CONNECTOR_PLAYBOOK.md
HTTP_LOCAL_MCP.md
OPENAI_TUNNEL_LOCAL_AUTH.md
RESTART_FLOW.md
BRIDGE_WATCHDOG.md
TROUBLESHOOTING.md
ROADMAP.md
AGENTIC_TOOLS_ROADMAP.md
NEXT_CHAT_PROMPT.md
```

Nota: ChatGPT puede cachear el catalogo de tools. Si una tool nueva no aparece en una conversacion ya abierta, refrescar/reabrir el conector o iniciar un chat nuevo.
