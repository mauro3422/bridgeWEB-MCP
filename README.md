# bridge-mcp

MCP local propio para conectar ChatGPT/Kairos/KChat con MauroPrime y, después, la laptop.

El objetivo no es depender de un runner genérico: este repo es el puente local controlado por nosotros para filesystem, shell, Git, diagnósticos y futuros flujos de reinicio seguro.

## Estado actual

Versión esperada del servidor:

```text
bridge-mcp v0.3.0
```

Stack:

- Node.js / TypeScript
- `@modelcontextprotocol/sdk`
- `zod`
- MCP sobre `stdio`
- OpenAI Secure MCP Tunnel mediante `tunnel-client`

Ruta principal actual:

```text
ChatGPT Developer Mode
  -> OpenAI Secure MCP Tunnel
  -> bridge-mcp en la PC Windows
  -> filesystem / shell / git / procesos
```

## Tools actuales

Base local:

- `system_info`: datos básicos de la máquina.
- `list_dir`: lista carpetas con profundidad limitada.
- `read_text_file`: lee texto UTF-8 con límite de tamaño.
- `write_text_file`: escribe o agrega texto UTF-8.
- `apply_patch`: reemplazo exacto y controlado en archivos de texto.
- `run_command`: ejecuta comandos con `cwd`, timeout y salida capturada.

Terminal persistente:

- `terminal_start`
- `terminal_write`
- `terminal_read`
- `terminal_stop`
- `terminal_list`

Git y diagnóstico agregados en `v0.3.0`:

- `git_status`
- `git_set_remote`
- `git_commit_all`
- `git_push_current_branch`
- `tunnel_health`
- `bridge_self_check`

## Scripts principales

```powershell
npm install
npm run check
npm run build
npm run start
```

## HTTP local mode experimental

A local Streamable HTTP MCP entrypoint now exists in parallel to the stable `stdio` entrypoint:

```powershell
npm run build
npm run start:http
```

Default endpoints:

```text
http://127.0.0.1:3001/healthz
http://127.0.0.1:3001/readyz
http://127.0.0.1:3001/status
http://127.0.0.1:3001/mcp
```

Prepared experimental tunnel profile:

```text
bridge-local-http -> http://127.0.0.1:3001/mcp
```

The stable connector still uses the `bridge-local` stdio profile. Do not run both profiles with the same tunnel id at the same time. See `HTTP_LOCAL_MCP.md`.

HTTP validation helper:

```powershell
.\scripts\test-bridge-http.ps1
```

Restart-request flow:

```powershell
.\scripts\test-restart-request.ps1 -Mode http
.\scripts\start-bridge-http-watchdog.ps1 -NoTunnel -Once
```

See `RESTART_FLOW.md`.

## Watchdog local

El túnel no debe reiniciarse desde adentro de una tool MCP porque ChatGPT perdería el transporte que está usando para llamar esa tool.

La solución actual es un watchdog externo:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1
```

Para instalarlo al inicio de sesión de Windows sin permisos de administrador:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\install-bridge-watchdog-task.ps1 -InstallMode Startup
```

Esto crea:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BridgeMCP-Watchdog.cmd
```

El launcher de Startup abre una ventana normal de PowerShell para que el estado quede visible por ahora. Más adelante se puede reemplazar por un gateway visual con modo verbose, bandeja de sistema, logs y controles de reinicio.

## Mercado / alternativas MCP

La foto actual del ecosistema es esta:

- **OpenAI Secure MCP Tunnel**: mejor opción actual para ChatGPT cuando se quiere conectar un MCP local de forma directa y oficial.
- **mcp-remote**: proxy local para que clientes que sólo hablan `stdio` puedan conectarse a servidores MCP remotos HTTP/SSE con OAuth. Es útil del lado cliente, pero no reemplaza por sí solo nuestro puente local Windows -> ChatGPT.
- **supergateway**: conversor entre MCP `stdio`, SSE, WebSocket y Streamable HTTP. Sirve para exponer un servidor `stdio` como HTTP/SSE o para debug/transporte alternativo. Sigue necesitando una capa segura de publicación si se expone fuera de localhost.
- **Cloudflare Remote MCP / Workers / Agents**: buena ruta para MCP remoto hospedado, con Streamable HTTP y autenticación. Encaja mejor para servicios cloud que para controlar una PC Windows local, salvo que lo combinemos con un agente/túnel local.
- **MCP Inspector**: herramienta visual de testing y debugging de servidores MCP. No es runner de producción; sirve para inspeccionar tools, requests y errores.
- **Desktop Commander u otros runners locales**: útiles como bootstrap temporal, pero este repo busca reemplazarlos con una implementación propia, auditable y ajustada a nuestras reglas.

Conclusión práctica: no apareció una alternativa mágica que reemplace todo el flujo local con la misma integración directa en ChatGPT. Sí hay piezas útiles para fases futuras: `supergateway` para transporte HTTP/Streamable HTTP, `mcp-remote` para clientes stdio, Cloudflare para remote MCP hospedado, e Inspector para UI/debug.

## Próximos pasos técnicos

1. Diseñar `bridge_request_restart`: la tool MCP sólo escribe un archivo de solicitud de reinicio.
2. Hacer que el watchdog externo lea esa solicitud y reinicie túnel/MCP de forma segura.
3. Agregar modo verbose/log estructurado.
4. Diseñar gateway visual local para usuario: estado del túnel, health checks, logs, botón de restart y diagnóstico.

## Seguridad

No commitear:

- `node_modules/`
- `dist/`
- binarios del tunnel-client
- `.env` / claves / tokens
- logs
- sandbox local

Mantener secretos como variables de entorno de Windows o en perfiles locales fuera de Git.
