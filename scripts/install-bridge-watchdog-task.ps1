param(
  [string]$TaskName = "BridgeMCP Watchdog",
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$WatchdogScript = "C:\dev\bridge-mcp\scripts\start-bridge-watchdog.ps1"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $WatchdogScript)) {
  throw "Watchdog script not found: $WatchdogScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`" -ProjectRoot `"$ProjectRoot`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Keeps the local OpenAI Secure MCP Tunnel bridge alive for ChatGPT." `
  -Force

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
