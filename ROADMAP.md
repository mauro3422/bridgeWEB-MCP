# bridge-mcp Roadmap

Local MCP bridge for MauroPrime. The goal is to let ChatGPT operate a Windows PC through a controlled OpenAI Secure MCP Tunnel, similar to a small local Codex bridge, but with explicit safety boundaries.

## Current status

Project root:

```txt
C:\dev\bridge-mcp
```

Stack:

```txt
Node.js / TypeScript
@modelcontextprotocol/sdk
zod
MCP over stdio
OpenAI tunnel-client for Secure MCP Tunnel
```

Current local server version:

```txt
bridge-mcp v0.3.0
```

Tunnel profile:

```txt
bridge-local
```

Tunnel id:

```txt
tunnel_6a410d99e808819196c5137c59cc0f9e
```

Tunnel client path:

```txt
C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe
```

Profile path:

```txt
C:\Users\mauro\AppData\Roaming\tunnel-client\bridge-local.yaml
```

The profile reads the runtime key from:

```txt
env:CONTROL_PLANE_API_KEY
```

Do not commit keys or tunnel secrets.

## Confirmed working checks

Known-good checks after v0.3.0 build:

```txt
system_info -> bridge-mcp v0.3.0
npm run check -> OK
npm run build -> OK
http://127.0.0.1:8080/healthz -> 200 live
http://127.0.0.1:8080/readyz -> 200 ready
```

## Existing tools

Original tools:

```txt
system_info
list_dir
read_text_file
write_text_file
apply_patch
run_command
terminal_start
terminal_write
terminal_read
terminal_stop
terminal_list
```

Added in v0.3.0 source/build:

```txt
git_status
git_set_remote
git_commit_all
git_push_current_branch
tunnel_health
bridge_self_check
```

Note: some ChatGPT chats may still show the old 11-tool catalog due to connector/tool cache. Open a new chat with the BrigdeMCP-WEB connector selected to refresh the tool list.

## Git repository

Remote:

```txt
https://github.com/mauro3422/bridgeWEB-MCP
```

Known pushed commits:

```txt
879102f feat: add git and bridge self-check tools
7d6b22d chore: harden gitignore for bridge artifacts
```

Pending local commits may exist after edits. Use:

```powershell
git status --short --branch
git push
```

## Watchdog status

Created files:

```txt
BRIDGE_WATCHDOG.md
scripts/start-bridge-watchdog.ps1
scripts/install-bridge-watchdog-task.ps1
```

`install-bridge-watchdog-task.ps1` may fail without Windows task permissions. If Scheduled Task registration fails, use a user Startup shortcut/cmd fallback.

Manual tunnel recovery:

```powershell
Set-Location C:\dev\bridge-mcp
& "C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe" doctor --profile bridge-local --explain
& "C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe" run --profile bridge-local
```

## Immediate next steps

1. Open a new ChatGPT chat with the BrigdeMCP-WEB connector selected.
2. Verify the new tool catalog includes 17 tools.
3. Run `system_info` and confirm `bridge-mcp v0.3.0`.
4. Run `tunnel_health` and `bridge_self_check` if visible.
5. Fix the watchdog install script so it does not print success after failure and add a no-admin Startup fallback.
6. Commit and push the watchdog/context updates.

## v0.4 roadmap

### Safer restart flow

Add a restart request mechanism instead of restarting the bridge from inside a tool call.

Proposed tool:

```txt
bridge_request_restart
```

Behavior:

```txt
1. MCP writes C:\dev\bridge-mcp\.bridge-restart-request
2. Tool returns success
3. External watchdog sees the file
4. Watchdog restarts tunnel-client/MCP
5. Watchdog deletes the request file
```

This avoids the MCP killing the same tunnel ChatGPT is using for the active call.

### Watchdog improvements

- Add no-admin Startup installer.
- Add log file output under ignored `logs/`.
- Add restart-request detection.
- Add duplicate tunnel detection to avoid two `tunnel-client run` processes for the same profile.
- Make install script fail loudly and truthfully.

### Safety and policy improvements

- Add allowed roots, for example `C:\dev\bridge-mcp`, `C:\dev\Kairos`.
- Add denied paths/globs: `.env`, keys, AppData, Windows, System32, node_modules.
- Add secret redaction in command output.
- Add max terminal age and max terminal count.
- Add safer file operations: `rename_path`, `copy_path`, `delete_path_to_trash`.

### Mini-Codex workflow

Goal: explicit high-level operation flow:

```txt
plan -> patch -> check -> build -> smoke -> commit -> push
```

Prefer declarative tools over raw shell commands whenever possible.

## v0.5 roadmap

Consider migrating from stdio MCP target to a local HTTP MCP server. Current architecture:

```txt
ChatGPT -> tunnel-client -> node dist/index.js over stdio
```

More robust architecture:

```txt
ChatGPT -> tunnel-client always running -> MCP HTTP server on 127.0.0.1
```

This would allow cleaner local MCP server restarts while keeping the tunnel process more stable.

## Operational notes

- If the tunnel is down, ChatGPT cannot operate the PC through BrigdeMCP-WEB.
- If `doctor` says `CONTROL_PLANE_API_KEY` is missing, set it as a User environment variable and open a new PowerShell.
- Do not paste API keys into chat.
- Do not commit tunnel-client binaries, secrets, logs, sandbox output, or node_modules.
- Prefer Git commits after each stable change.
