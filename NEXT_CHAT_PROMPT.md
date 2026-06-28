# Prompt for the next ChatGPT chat

Paste this into a new ChatGPT chat after selecting the `BrigdeMCP-WEB` connector from Developer Mode/tools.

```txt
Context: we are working on my local Windows MCP bridge project at C:\dev\bridge-mcp.

Use the BrigdeMCP-WEB connector.

Project summary:
- Repo: https://github.com/mauro3422/bridgeWEB-MCP
- Stack: Node.js / TypeScript / @modelcontextprotocol/sdk / zod / MCP over stdio.
- Tunnel: OpenAI Secure MCP Tunnel through tunnel-client.
- Tunnel id: tunnel_6a410d99e808819196c5137c59cc0f9e
- Tunnel profile: bridge-local
- tunnel-client path: C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe
- profile path: C:\Users\mauro\AppData\Roaming\tunnel-client\bridge-local.yaml
- CONTROL_PLANE_API_KEY is stored as a Windows User environment variable; do not ask me to paste it.
- Current server should report bridge-mcp v0.3.0.

Important current state:
- The bridge was upgraded from v0.2.0 to v0.3.0.
- v0.3.0 added Git and diagnostic tools in src/index.ts and dist/index.js:
  - git_status
  - git_set_remote
  - git_commit_all
  - git_push_current_branch
  - tunnel_health
  - bridge_self_check
- Some old chats only show the original 11 tools due to connector/tool catalog cache. In this new chat, first verify whether the new tools appear.
- If new tools do not appear, use system_info and run_command as fallback, but do not assume the server code is wrong. Check dist/index.js for those tool names.

Start by running:
1. system_info
2. list available BrigdeMCP-WEB tools if possible
3. tunnel_health if visible, otherwise use run_command to check http://127.0.0.1:8080/healthz and /readyz
4. bridge_self_check if visible
5. git_status if visible, otherwise run_command git status --short --branch

Known good previous checks:
- system_info returned bridge-mcp v0.3.0.
- npm run check passed.
- npm run build passed.
- healthz returned 200 live.
- readyz returned 200 ready.

Files recently created/updated:
- ROADMAP.md
- NEXT_CHAT_PROMPT.md
- BRIDGE_WATCHDOG.md
- scripts/start-bridge-watchdog.ps1
- scripts/install-bridge-watchdog-task.ps1
- .gitignore

Watchdog issue:
- install-bridge-watchdog-task.ps1 failed with Access Denied on Register-ScheduledTask because Windows permissions did not allow registering the task.
- The script initially printed success incorrectly after failure; it should be fixed if not already committed.
- We need a no-admin fallback using the user's Startup folder, for example creating BridgeMCP-Watchdog.cmd in [Environment]::GetFolderPath('Startup').

Next desired work:
1. Verify the new v0.3.0 tools are visible in this chat.
2. Fix or create a no-admin watchdog startup installer.
3. Add bridge_request_restart design/implementation later: MCP writes a restart-request file, external watchdog restarts the tunnel/MCP safely.
4. Commit and push changes after validation.

Safety rules:
- Never print or request secrets/API keys in chat.
- Do not commit node_modules, dist, tunnel-client binaries, sandbox, logs, .env, or keys.
- Prefer explicit MCP tools over raw run_command.
- Avoid restarting the active tunnel from inside a tool call; use external watchdog/restart-request pattern.
```
