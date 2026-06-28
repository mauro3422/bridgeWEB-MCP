# Bridge MCP Watchdog

This project uses OpenAI Secure MCP Tunnel with a local stdio MCP server.

Important limitation: the MCP server cannot safely restart its own tunnel from inside a tool call. If the tunnel process exits, ChatGPT loses the transport used to call the tool. The robust pattern is to run `tunnel-client` under an external Windows supervisor/watchdog.

## Manual watchdog

Open PowerShell and run:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1
```

The script runs:

```powershell
C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe doctor --profile bridge-local --explain
C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe run --profile bridge-local
```

If `tunnel-client run` exits, the watchdog waits a few seconds and starts it again.

## Install at Windows logon

Run PowerShell as your normal Windows user and execute:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\install-bridge-watchdog-task.ps1
```

By default the installer runs in `Auto` mode. It first tries to install a Windows Scheduled Task. If Windows denies permission, it falls back to a no-admin Startup folder launcher named `BridgeMCP-Watchdog.cmd`.

To force the no-admin Startup installer:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\install-bridge-watchdog-task.ps1 -InstallMode Startup
```

To validate without changing Windows startup settings:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\install-bridge-watchdog-task.ps1 -InstallMode Startup -DryRun
.\scripts\install-bridge-watchdog-task.ps1 -InstallMode ScheduledTask -DryRun
```

If the Scheduled Task path succeeds, start it manually with:

```powershell
Start-ScheduledTask -TaskName "BridgeMCP Watchdog"
```

Both install modes start the watchdog at user logon. The watchdog restarts `tunnel-client run` if it exits.

## Updating bridge-mcp code

After changing TypeScript code:

```powershell
Set-Location C:\dev\bridge-mcp
npm run check
npm run build
```

Then restart the watchdog/tunnel process. Existing ChatGPT calls may briefly disconnect, but the watchdog should bring the bridge back automatically.

## Longer-term zero-ish downtime path

For cleaner restarts, split the local MCP server into an HTTP MCP server supervised separately. Then `tunnel-client` can stay running against `http://127.0.0.1:<port>/mcp` while the local MCP HTTP process restarts under its own supervisor.
