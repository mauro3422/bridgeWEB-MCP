# Bridge MCP HTTP local mode

This is the preparation path for running `bridge-mcp` as a local Streamable HTTP MCP server behind the same OpenAI Secure MCP Tunnel.

Current stable production path remains stdio:

```text
ChatGPT -> OpenAI Secure MCP Tunnel -> tunnel-client -> node dist/index.js
```

Prepared HTTP path:

```text
ChatGPT -> OpenAI Secure MCP Tunnel -> tunnel-client -> http://127.0.0.1:3001/mcp -> node dist/http.js
```

This does not require a Cloudflare Worker, VPS, public port, or external gateway. The port is local-only on `127.0.0.1`.

## Local HTTP server

Build and run manually:

```powershell
Set-Location C:\dev\bridge-mcp
npm run build
.\scripts\start-bridge-http-server.ps1
```

Or directly:

```powershell
Set-Location C:\dev\bridge-mcp
npm run start:http
```

Default local endpoints:

```text
GET  http://127.0.0.1:3001/healthz -> live
GET  http://127.0.0.1:3001/readyz  -> ready
GET  http://127.0.0.1:3001/status  -> JSON status
POST http://127.0.0.1:3001/mcp     -> MCP Streamable HTTP JSON-RPC
GET  http://127.0.0.1:3001/mcp     -> MCP SSE stream when requested with Accept: text/event-stream
```

## Validation

Run the local HTTP smoke test while the HTTP server is running:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\test-bridge-http.ps1
```

The test checks:

```text
/healthz
/readyz
/status
POST /mcp initialize
```

The startup script also refuses to start if the configured port is already in use, and prints the owning process so stale Node instances are easier to find.

## Tunnel profile

Prepared profile:

```text
bridge-local-http
```

Expected target:

```text
http://127.0.0.1:3001/mcp
```

Expected tunnel-client admin listener for this experimental profile:

```text
http://127.0.0.1:8081
```

The existing stable stdio profile remains:

```text
bridge-local
```

Do not run both profiles with the same tunnel id at the same time.

## Current caveat

`tunnel-client doctor --profile bridge-local-http` can reach the MCP HTTP target, but currently reports degraded OAuth metadata because the local MCP server intentionally does not expose OAuth/DCR metadata.

This means the HTTP transport is implemented and locally reachable, but the tunnel profile should remain experimental until we either:

1. confirm `sample_mcp_remote_no_auth` can run ready despite the doctor OAuth metadata warning, or
2. implement the exact metadata contract expected by `tunnel-client`, without pretending to provide auth that does not exist.

## Restart-request flow

The v0.4 restart path is documented in `RESTART_FLOW.md`.

Safe local test:

```powershell
Set-Location C:\dev\bridge-mcp
npm run build
.\scripts\test-restart-request.ps1 -Mode http
.\scripts\start-bridge-http-watchdog.ps1 -NoTunnel -Once
```

This tests request-file restart of the local HTTP MCP process without touching the active OpenAI tunnel.

## Why this mode matters

The HTTP local split lets us evolve toward:

```text
OpenAI tunnel stays up
local MCP HTTP server restarts independently
watchdog observes both tunnel health and local HTTP health
ChatGPT can get clearer status about which layer failed
```

That is the base needed for safer tool iteration, local dashboard, verbose logs, and controlled restart requests.
