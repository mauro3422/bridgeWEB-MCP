# bridge-mcp

MCP local propio para conectar ChatGPT con MauroPrime mediante OpenAI Secure MCP Tunnel.

El objetivo es tener un puente local controlado por nosotros para operar filesystem, shell, Git, diagnosticos, reinicio seguro, metricas e inteligencia de codigo sin depender de un runner generico.

## Estado actual

```text
bridge-mcp v0.5.1
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
process
git
bridge-ops
metrics
code-intelligence
code-graph
bridge-workflow
```

## Tools expuestas

El runtime actual expone 36 tools.

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
```

### Git

```text
git_status
git_set_remote
git_commit_all
git_push_current_branch
```

### Bridge / salud / restart

```text
tunnel_health
bridge_self_check
bridge_verify_all
bridge_request_restart
bridge_restart_status
```

### Metricas / visualizaciones

```text
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
server.version = 0.5.1
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

## Docs relacionadas

```text
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
