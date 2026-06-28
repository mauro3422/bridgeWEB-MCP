# Bridge MCP restart flow

This document describes the v0.4 restart-request pattern.

## Goal

Avoid restarting or killing the active MCP/tunnel process from inside the same tool call that ChatGPT is using.

The MCP tool layer only writes a request file. An external watchdog performs the restart later.

## Files

Request file:

```text
.bridge-restart-request
```

Ack file:

```text
.bridge-restart-ack
```

Both are runtime coordination files and are ignored by Git.

## MCP system tools

Added in v0.4.0:

```text
bridge_request_restart
bridge_restart_status
```

`bridge_request_restart` writes JSON to `.bridge-restart-request` and returns immediately. It does not kill, restart, or stop any process.

Supported modes:

```text
http   -> restart only the local HTTP MCP server
tunnel -> restart only tunnel-client
full   -> restart HTTP MCP server and tunnel-client
```

Note: `tunnel` mode is intentionally for the external watchdog path. Avoid using it against the currently active stdio tunnel profile from inside the live connector.

## Experimental HTTP watchdog

Script:

```powershell
.\scripts\start-bridge-http-watchdog.ps1
```

Safe local-only test mode:

```powershell
Set-Location C:\dev\bridge-mcp
npm run build
.\scripts\test-restart-request.ps1 -Mode http
.\scripts\start-bridge-http-watchdog.ps1 -NoTunnel -Once
```

What this validates:

1. writes `.bridge-restart-request`
2. starts local HTTP MCP on `127.0.0.1:3001`
3. watchdog reads the request
4. watchdog restarts only the HTTP MCP process
5. watchdog writes `.bridge-restart-ack`
6. watchdog exits cleanly in `-Once` mode

## Dual mode design

Future experimental path:

```text
watchdog
  -> bridge HTTP MCP on 127.0.0.1:3001
  -> tunnel-client profile bridge-local-http on 127.0.0.1:8081
```

Stable current path remains:

```text
ChatGPT -> OpenAI tunnel -> tunnel-client bridge-local -> node dist/index.js over stdio
```

Do not run `bridge-local` and `bridge-local-http` at the same time while they share the same tunnel id.

## Current caveat

The HTTP profile is still experimental because `tunnel-client doctor --profile bridge-local-http` reaches the MCP target but reports OAuth metadata as degraded. Keep using the stable stdio tunnel until the HTTP profile is fully validated.
