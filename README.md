# bridge-mcp

MCP local propio para conectar ChatGPT/Kairos/KChat con MauroPrime y, más adelante, la laptop u otros clientes.

El objetivo no es depender de un runner genérico: este repo es el puente local controlado por nosotros para filesystem, shell, Git, diagnósticos, reinicio seguro y métricas.

## Estado actual

Versión esperada del servidor:

```text
bridge-mcp v0.4.2
```

Modo recomendado actual:

```text
Production-candidate: HTTP local + OpenAI Secure MCP Tunnel
```

Ruta activa recomendada:

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> tunnel-client profile bridge-local-http
  -> http://127.0.0.1:3001/mcp
  -> bridge-mcp Streamable HTTP en MauroPrime
  -> filesystem / shell / git / procesos
```

`stdio` sigue siendo el rollback estable.

## Stack

- Node.js / TypeScript
- Node v24.x
- `node:sqlite` para métricas locales
- `@modelcontextprotocol/sdk`
- `zod`
- MCP Streamable HTTP local
- OpenAI Secure MCP Tunnel mediante `tunnel-client`

## Tools actuales

Base local:

- `system_info`: datos básicos de la máquina.
- `list_dir`: lista carpetas con profundidad limitada.
- `list_files_smart`: lista archivos con lenguaje, líneas y símbolos livianos.
- `read_text_file`: lee texto UTF-8 con límite de tamaño.
- `read_file_lines`: lee archivos con líneas numeradas y paginación.
- `read_many_files`: lee hasta 10 archivos o rangos en una llamada.
- `search_files`: busca texto literal con líneas, contexto y contenedor aproximado.
- `write_text_file`: escribe o agrega texto UTF-8.
- `apply_patch`: reemplazo exacto y controlado en archivos de texto.
- `run_command`: ejecuta comandos con `cwd`, timeout y salida capturada.

Terminal persistente:

- `terminal_start`
- `terminal_write`
- `terminal_read`
- `terminal_stop`
- `terminal_list`

Git, túnel y diagnóstico:

- `git_status`
- `git_set_remote`
- `git_commit_all`
- `git_push_current_branch`
- `tunnel_health`
- `bridge_self_check`
- `bridge_request_restart`
- `bridge_restart_status`

Métricas de tools:

- `bridge_metrics_status`
- `bridge_metrics_summary`
- `bridge_metrics_recent`
- `bridge_visualization_catalog`
- `bridge_visualize_metrics`

Nota: puede que ChatGPT no muestre tools nuevas en una conversación ya abierta hasta refrescar el conector/reabrir el chat, pero el runtime ya las expone.

## Scripts principales

```powershell
npm install
npm run check
npm run build
npm run smoke:http
npm run test:regressions
npm run start
npm run start:http
```

## HTTP local production-candidate

Endpoints locales:

```text
http://127.0.0.1:3001/healthz
http://127.0.0.1:3001/readyz
http://127.0.0.1:3001/status
http://127.0.0.1:3001/mcp
```

Perfil de túnel:

```text
bridge-local-http -> http://127.0.0.1:3001/mcp
```

Validación:

```powershell
.\scripts\test-bridge-http.ps1
Invoke-RestMethod http://127.0.0.1:3001/status
Invoke-RestMethod http://127.0.0.1:8081/readyz
```

El modo HTTP ya valida:

- `initialize`
- `Mcp-Session-Id`
- `notifications/initialized` con respuesta 202
- limpieza de sesiones idle
- limpieza de transports anónimos
- límite máximo de sesiones
- watchdog para reinicio de HTTP
- watchdog para reinicio de `tunnel-client`

Ver `HTTP_LOCAL_MCP.md`, `TROUBLESHOOTING.md` y `AGENTIC_TOOLS_ROADMAP.md`.

## Watchdog local

Modo HTTP recomendado:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-http-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp -Profile bridge-local-http -TunnelBaseUrl http://127.0.0.1:8081
```

Instalación al inicio de sesión de Windows sin permisos de administrador:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\install-bridge-watchdog-task.ps1 -InstallMode Startup -WatchdogMode Http
```

Esto crea:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BridgeMCP-Watchdog.cmd
```

Rollback stdio:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```

## Métricas y logs

Runtime local:

```text
logs/bridge-events.jsonl
 data/bridge-metrics.sqlite
```

Consultas rápidas:

```powershell
node .\scripts\query-bridge-metrics.mjs status
node .\scripts\query-bridge-metrics.mjs summary 50
node .\scripts\query-bridge-metrics.mjs recent 25
node .\scripts\query-bridge-metrics.mjs errors 25
```

Variables útiles:

```text
BRIDGE_MCP_METRICS_ENABLED=0
BRIDGE_MCP_METRICS_DIR=...
BRIDGE_MCP_LOG_DIR=...
BRIDGE_MCP_METRICS_SQLITE=...
BRIDGE_MCP_EVENTS_JSONL=...
```

Las métricas guardan nombres de tools, duración, éxito/error, claves de input y tamaño de salida. No guardan argumentos completos.

## Modelo de uso desde laptop

Si usás ChatGPT desde la laptop pero el conector apunta al túnel que corre en MauroPrime, las tools se ejecutan en MauroPrime.

```text
Laptop con ChatGPT UI
  -> OpenAI
  -> Secure MCP Tunnel activo en MauroPrime
  -> tools ejecutadas en MauroPrime
```

Para que las tools se ejecuten en la laptop, la laptop necesitaría su propio bridge/tunnel/profile corriendo localmente.

## Seguridad

No commitear:

- `node_modules/`
- `dist/`
- binarios del tunnel-client
- `.env` / claves / tokens
- logs
- base SQLite de métricas
- sandbox local

Mantener secretos como variables de entorno de Windows o en perfiles locales fuera de Git.

## Local auth model

El perfil HTTP local es intencionalmente loopback-only y no-auth en el listener MCP. La barrera de seguridad real es el OpenAI Secure MCP Tunnel + runtime key + permisos del workspace.

Ver `OPENAI_TUNNEL_LOCAL_AUTH.md`.
