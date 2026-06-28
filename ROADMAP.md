# bridge-mcp Roadmap

Local MCP bridge for MauroPrime. The goal is to let ChatGPT operate MauroPrime through a controlled OpenAI Secure MCP Tunnel with explicit diagnostics, safe restart flow, Git workflow, metrics, and rollback.

## Current status

```txt
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.4.6
Mode: HTTP production-candidate
Bridge HTTP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Rollback profile: stdio through scripts/start-bridge-watchdog.ps1
```

Stack:

```txt
Node.js / TypeScript
@modelcontextprotocol/sdk
zod
node:sqlite metrics
MCP Streamable HTTP local
OpenAI Secure MCP Tunnel through tunnel-client
```

Do not commit keys, tunnel secrets, `node_modules`, `dist`, logs, SQLite metrics, sandbox files, or tunnel-client binaries.

## Confirmed working checks

Known-good checks for v0.4.6:

```txt
bridge_self_check -> ok true
npm run check -> OK
npm run build -> OK
scripts/test-bridge-http.ps1 -> OK
scripts/test-bridge-regressions.ps1 -> OK
http://127.0.0.1:3001/status -> bridge-mcp v0.4.6
http://127.0.0.1:8081/healthz -> live
http://127.0.0.1:8081/readyz -> ready
```

If anything points at `8080`, treat it as stale context unless the active profile was intentionally changed.

## Current tool groups

Base tools:

```txt
system_info
list_dir
list_files_smart
read_text_file
read_file_lines
read_many_files
search_files
write_text_file
apply_patch
edit_lines
analyze_code
impact_analysis
find_duplicate_symbols
bridge_verify_all
run_command
```

Persistent terminal tools:

```txt
terminal_start
terminal_write
terminal_read
terminal_stop
terminal_list
```

Git, tunnel, restart and self-check tools:

```txt
git_status
git_set_remote
git_commit_all
git_push_current_branch
tunnel_health
bridge_self_check
bridge_request_restart
bridge_restart_status
```

Metrics and visualization tools:

```txt
bridge_metrics_status
bridge_metrics_summary
bridge_metrics_recent
bridge_visualization_catalog
bridge_visualize_metrics
```

Note: some ChatGPT chats may show an old cached tool catalog. Reopen/refresh the connector if tools are missing.

## Git repository

```txt
Remote: https://github.com/mauro3422/bridgeWEB-MCP
Expected branch: main
Expected clean state: ## main...origin/main
```

Operational flow:

```txt
plan -> patch -> check -> build -> smoke -> regression -> commit -> push
```

## Watchdog and restart status

Active watchdog:

```powershell
.\scripts\start-bridge-http-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp -Profile bridge-local-http -TunnelBaseUrl http://127.0.0.1:8081
```

Safe restart flow:

```txt
1. MCP writes C:\dev\bridge-mcp\.bridge-restart-request
2. Tool returns success
3. External watchdog sees the file
4. Watchdog restarts HTTP MCP and/or tunnel-client
5. Watchdog writes .bridge-restart-ack and deletes the request file
```

Preferred tool:

```txt
bridge_request_restart
```

If the wrapper blocks that tool, use `write_text_file` to create `.bridge-restart-request`. Do not kill the active MCP/tunnel process directly from the same tool call.

## Current completed v0.4 work

- HTTP local production-candidate profile.
- No-admin Startup launcher for the HTTP watchdog.
- Restart request/ack flow through external watchdog.
- BOM-tolerant restart ack parsing.
- Tunnel health default aligned to `8081`.
- Bridge metrics in SQLite/logs.
- Chat-renderable metrics visualization specs.
- HTTP smoke test.
- Regression test for version/defaults/BOM ack parsing.
- Agentic file navigation tools: `read_file_lines`, `read_many_files`, `search_files`, `list_files_smart`.
- Modular registry foundation for `file-navigation` and `file-writing`.
- Shared text-file helpers for hash verification, binary refusal, line endings, and line-range edits.
- Surgical `edit_lines` tool with context and postflight verification.
- Code intelligence tools: `analyze_code`, `impact_analysis`, `find_duplicate_symbols`.
- Bridge verification workflow: `bridge_verify_all`, `scripts/verify-all.ps1`, and `npm run verify:all`.
- Shared project scanner and lightweight symbol/reference extraction helpers.
- Troubleshooting notes for wrapper blocks and stale `8080` context.

## Next recommended work

### Agentic tool evolution

Detailed plan: `AGENTIC_TOOLS_ROADMAP.md`.

Completed implementation package for v0.4.2:

```txt
read_file_lines
read_many_files
search_files
list_files_smart
```

These tools are inspired by K-Chat/Kairos and reduce raw shell usage by giving ChatGPT line-numbered reading, grep-like search with context, smart directory summaries, and batch file reads.

### Diagnostics hardening

- Keep improving `scripts/bridge-doctor.ps1` messages when a failure occurs.
- Add stale-ack age warnings.
- Add explicit detection of wrong tunnel profile.
- Add a single command that runs doctor + check + build + smoke + regressions.

### Test coverage

- Add tests for duplicate watchdog/tunnel detection.
- Add tests for restart-request lifecycle.
- Add tests for metrics SQLite availability without leaking arguments.

### Workflow polish

- Add a short `RELEASE.md` checklist.
- Add npm script aliases for smoke/regression tests.
- Consider tagging stable versions after clean push.

### Later safety work

Allowed roots / denied path policy is intentionally not part of this change. Keep it as a later design item so it does not destabilize the active bridge.

## Rollback

`stdio` rollback remains available:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```


