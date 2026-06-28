# Prompt for the next ChatGPT chat

Paste this into a new ChatGPT chat after selecting the `BrigdeMCP-WEB` connector from Developer Mode/tools.

```txt
Context: we are working on my local Windows MCP bridge project at C:\dev\bridge-mcp.

Use the BrigdeMCP-WEB connector.

Project summary:
- Repo: https://github.com/mauro3422/bridgeWEB-MCP
- Stack: Node.js / TypeScript / @modelcontextprotocol/sdk / zod / node:sqlite metrics.
- Current mode: HTTP production-candidate through OpenAI Secure MCP Tunnel.
- Bridge HTTP: http://127.0.0.1:3001/mcp
- Bridge status: http://127.0.0.1:3001/status
- Tunnel admin: http://127.0.0.1:8081
- Tunnel profile: bridge-local-http
- Server should report bridge-mcp v0.4.2.
- CONTROL_PLANE_API_KEY is stored locally as a Windows User environment variable; do not ask me to paste it.

Important state:
- HTTP is the recommended active profile.
- stdio remains the rollback profile only.
- Use scripts/start-bridge-http-watchdog.ps1 for the active HTTP watchdog.
- Use scripts/start-bridge-watchdog.ps1 only for rollback to stdio.
- Do not kill node.exe or tunnel-client.exe directly from the active MCP call.
- If a restart is needed, use bridge_request_restart. If wrapper blocks it, write .bridge-restart-request and let the external watchdog process it.
- Current tunnel admin is 8081. Treat 8080 references as stale unless we intentionally changed profiles.

Start by running:
1. bridge_self_check if visible.
2. bridge_restart_status if visible.
3. git_status if visible.
4. If needed, run_command "powershell -NoProfile -File .\scripts\bridge-doctor.ps1".
5. Before committing any code: npm run check, npm run build, .\scripts\test-bridge-http.ps1, .\scripts\test-bridge-regressions.ps1.

Known good checks:
- bridge_self_check ok true.
- tunnel.baseUrl http://127.0.0.1:8081.
- tunnel healthz live / readyz ready.
- test-bridge-http.ps1 passes.
- test-bridge-regressions.ps1 passes.

Key files:
- README.md
- HTTP_LOCAL_MCP.md
- AGENTS.md
- TROUBLESHOOTING.md
- ROADMAP.md
- src/config.ts
- src/http.ts
- src/bridge-server.ts
- src/metrics.ts
- src/visualizations.ts
- scripts/bridge-doctor.ps1
- scripts/start-bridge-http-watchdog.ps1
- scripts/test-bridge-http.ps1
- scripts/test-bridge-regressions.ps1

Safety rules:
- Never print or request secrets/API keys in chat.
- Do not commit node_modules, dist, tunnel-client binaries, sandbox, logs, .env, keys, or metrics SQLite files.
- Prefer explicit MCP tools over raw run_command.
- Keep changes small and testable.
- Do not break stdio rollback.
```
