# bridge-mcp

MCP local propio para conectar ChatGPT con MauroPrime mediante OpenAI Secure MCP Tunnel.

El objetivo es tener un puente local controlado por nosotros para operar filesystem, shell, Git, diagnosticos, reinicio seguro, metricas e inteligencia de codigo sin depender de un runner generico.

## Estado actual

```text
bridge-mcp v0.6.3
Mode: HTTP production-candidate
Project root: C:\dev\bridge-mcp
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
bridge-workflow
```

## Contexto de proyecto y guias reutilizables

Para trabajo sustancial en un repositorio, ChatGPT debe llamar una vez a `project_context_load` con `projectRoot` y la tarea actual. La tool puede cargar:

```text
<project>/AGENTS.override.md o AGENTS.md
<project>/.bridge/PROJECT_CONTEXT.md
<project>/.bridge/PROJECT_MEMORY.md
<project>/.bridge/PROJECT_STATE.md
<project>/.bridge/workflow-guides/*
```

`AGENTS.md` sigue siendo la entrada nativa para Codex. En ChatGPT web, la carga ocurre por instrucciones MCP y `project_context_load`; las guias aplicables se detectan con `workflow_guide_recommend` y se incorporan con `workflow_guide_load`.

Las guias globales viven en `integrations/workflow-guides/`. Las guias del proyecto tienen prioridad sobre una global con el mismo nombre.

## Tools expuestas

El runtime actual expone 83 tools.

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
server.version = 0.6.3
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
POST http://127.0.0.1:3001/mcp
```

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
```

Las metricas guardan nombres de tools, duracion, exito/error, claves de input y tamano de salida. No guardan argumentos completos.

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
