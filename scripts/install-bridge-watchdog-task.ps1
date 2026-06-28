param(
  [ValidateSet("Auto", "ScheduledTask", "Startup")]
  [string]$InstallMode = "Auto",
  [ValidateSet("Stdio", "Http")]
  [string]$WatchdogMode = "Stdio",
  [string]$TaskName = "BridgeMCP Watchdog",
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$WatchdogScript = "",
  [string]$StartupFileName = "BridgeMCP-Watchdog.cmd",
  [string]$HttpProfile = "bridge-local-http",
  [string]$HttpTunnelBaseUrl = "http://127.0.0.1:8081",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WatchdogScript)) {
  if ($WatchdogMode -eq "Http") {
    $WatchdogScript = Join-Path $ProjectRoot "scripts\start-bridge-http-watchdog.ps1"
  }
  else {
    $WatchdogScript = Join-Path $ProjectRoot "scripts\start-bridge-watchdog.ps1"
  }
}

if (-not (Test-Path -LiteralPath $WatchdogScript)) {
  throw "Watchdog script not found: $WatchdogScript"
}

function Get-WatchdogArgumentString {
  if ($WatchdogMode -eq "Http") {
    return "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`" -ProjectRoot `"$ProjectRoot`" -Profile `"$HttpProfile`" -TunnelBaseUrl `"$HttpTunnelBaseUrl`""
  }

  return "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`" -ProjectRoot `"$ProjectRoot`""
}

function Install-BridgeScheduledTask {
  $arguments = Get-WatchdogArgumentString
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $arguments

  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

  if ($DryRun) {
    Write-Host "Dry run: would install scheduled task: $TaskName mode=$WatchdogMode"
    Write-Host "powershell.exe $arguments"
    return
  }

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Keeps the local OpenAI Secure MCP Tunnel bridge alive for ChatGPT. Mode: $WatchdogMode." `
    -Force | Out-Null

  Write-Host "Installed scheduled task: $TaskName mode=$WatchdogMode"
  Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
}

function Install-BridgeStartupCommand {
  $startupFolder = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startupFolder)) {
    throw "Could not resolve the current user's Startup folder."
  }

  New-Item -ItemType Directory -Force -Path $startupFolder | Out-Null
  $startupCmd = Join-Path $startupFolder $StartupFileName
  $arguments = Get-WatchdogArgumentString

  $cmd = @"
@echo off
REM Starts the Bridge MCP watchdog at user logon without requiring admin rights.
REM Mode: $WatchdogMode
cd /d "$ProjectRoot"
start "BridgeMCP Watchdog ($WatchdogMode)" powershell.exe $arguments
"@

  if ($DryRun) {
    Write-Host "Dry run: would install no-admin Startup fallback: $startupCmd mode=$WatchdogMode"
    Write-Host $cmd
    return
  }

  Set-Content -LiteralPath $startupCmd -Value $cmd -Encoding ASCII

  Write-Host "Installed no-admin Startup fallback: $startupCmd mode=$WatchdogMode"
  Write-Host "It will start at the next user logon."
  Write-Host "Start now with: powershell.exe $arguments"
}

switch ($InstallMode) {
  "ScheduledTask" {
    Install-BridgeScheduledTask
  }
  "Startup" {
    Install-BridgeStartupCommand
  }
  "Auto" {
    try {
      Install-BridgeScheduledTask
    }
    catch {
      Write-Warning "Scheduled task install failed: $($_.Exception.Message)"
      Write-Warning "Falling back to the current user's Startup folder."
      Install-BridgeStartupCommand
    }
  }
}
