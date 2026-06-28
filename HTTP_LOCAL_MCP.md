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

## Local auth decision

The HTTP profile is local-only and no-auth at the MCP listener layer. The intended boundary is the managed tunnel plus a loopback-only bridge HTTP listener.

Use the `sample_mcp_remote_no_auth` profile family. Do not add fake auth metadata just to silence diagnostics. See `OPENAI_TUNNEL_LOCAL_AUTH.md`.

## Current production-candidate status

HTTP mode is now production-candidate for local use.

Active runtime shape:

```text
ChatGPT -> OpenAI Secure MCP Tunnel -> bridge-local-http -> http://127.0.0.1:3001/mcp -> bridge-mcp Streamable HTTP
```

Validated behavior:

- `/healthz`, `/readyz`, and `/status` return successfully.
- MCP `initialize` returns server info and an `Mcp-Session-Id`.
- MCP `notifications/initialized` succeeds with HTTP 202 when sent with the session id.
- HTTP sessions are tracked per `Mcp-Session-Id`.
- Stale anonymous transports are cleaned automatically.
- Idle sessions are cleaned automatically.
- The HTTP watchdog can restart the local HTTP bridge if the bridge process dies.
- The HTTP watchdog can restart `tunnel-client` if the tunnel process dies.
- Startup fallback now supports `-WatchdogMode Http` and is installed for the current user.

Current startup command installed in the user Startup folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\dev\bridge-mcp\scripts\start-bridge-http-watchdog.ps1" -ProjectRoot "C:\dev\bridge-mcp" -Profile "bridge-local-http" -TunnelBaseUrl "http://127.0.0.1:8081"
```

Useful checks:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/status
Invoke-RestMethod http://127.0.0.1:8081/readyz
.\scripts\test-bridge-http.ps1
.\scripts\bridge-doctor.ps1
```

If dev/test processes are left behind on alternate ports, inspect first and only then apply cleanup:

```powershell
.\scripts\clean-bridge-dev-processes.ps1
.\scripts\clean-bridge-dev-processes.ps1 -Apply
```

The HTTP watchdog is now protected by a singleton guard keyed by project root, profile, bridge port, tunnel URL, and tunnel mode. It also checks for an already-running production watchdog before launching new bridge or tunnel processes.

Rollback to stdio remains available with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```

## Metrics and logs

Production-candidate HTTP mode now records persistent telemetry without adding extra npm dependencies.

Runtime files:

```text
logs/bridge-events.jsonl          # append-only event log, redacted where possible
data/bridge-metrics.sqlite        # SQLite metrics database
data/bridge-metrics.sqlite-wal    # SQLite WAL file
data/bridge-metrics.sqlite-shm    # SQLite shared memory file
```

The database is created with Node's built-in `node:sqlite` module on Node v24.

Recorded per tool call:

- tool name
- start/end time
- duration in milliseconds
- success/error flag
- redacted error text
- input key names only, not raw arguments
- output size in characters
- server version, PID, host, platform, cwd

Useful queries:

```powershell
node .\scripts\query-bridge-metrics.mjs status
node .\scripts\query-bridge-metrics.mjs summary 50
node .\scripts\query-bridge-metrics.mjs recent 25
node .\scripts\query-bridge-metrics.mjs errors 25
```

Environment overrides:

```text
BRIDGE_MCP_METRICS_ENABLED=0       # disable metrics
BRIDGE_MCP_METRICS_DIR=...         # default: ./data
BRIDGE_MCP_LOG_DIR=...             # default: ./logs
BRIDGE_MCP_METRICS_SQLITE=...      # default: ./data/bridge-metrics.sqlite
BRIDGE_MCP_EVENTS_JSONL=...        # default: ./logs/bridge-events.jsonl
```

The runtime metrics database and logs are intentionally ignored by Git.

## Chat visualizations module

The bridge now includes a reusable visualization module for ChatGPT-renderable chart specs.

Files:

```text
src/visualizations.ts
```

MCP tools:

```text
bridge_visualization_catalog
bridge_visualize_metrics
```

Supported metric chart kinds:

```text
calls_by_tool
avg_duration_by_tool
errors_by_tool
activity_timeline
success_mix
```

`bridge_visualize_metrics` returns:

```json
{
  "renderer": "charts_widget_v2",
  "language": "recharts-json",
  "chartSpec": { "chartType": "bar", "meta": {}, "data": [] }
}
```

The assistant can use `chartSpec` as the content payload for ChatGPT's chart renderer when a visual card inside the conversation is useful. This is separate from the local `/dashboard` page.
