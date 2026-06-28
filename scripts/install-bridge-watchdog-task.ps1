param(
  [ValidateSet("Auto", "ScheduledTask", "Startup")]
  [string]$InstallMode = "Auto",
  [string]$TaskName = "BridgeMCP Watchdog",
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$WatchdogScript = "C:\dev\bridge-mcp\scripts\start-bridge-watchdog.ps1",
  [string]$StartupFileName = "BridgeMCP-Watchdog.cmd",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $WatchdogScript)) {
  throw "Watchdog script not found: $WatchdogScript"
}

function Install-BridgeScheduledTask {
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

  if ($DryRun) {
    Write-Host "Dry run: would install scheduled task: $TaskName"
    return
  }

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Keeps the local OpenAI Secure MCP Tunnel bridge alive for ChatGPT." `
    -Force | Out-Null

  Write-Host "Installed scheduled task: $TaskName"
  Write-Host "Start now with: Start-ScheduledTask -TaskName '$TaskName'"
}

function Install-BridgeStartupCommand {
  $startupFolder = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startupFolder)) {
    throw "Could not resolve the current user's Startup folder."
  }

  New-Item -ItemType Directory -Force -Path $startupFolder | Out-Null
  $startupCmd = Join-Path $startupFolder $StartupFileName

  $cmd = @"
@echo off
REM Starts the Bridge MCP watchdog at user logon without requiring admin rights.
cd /d "$ProjectRoot"
start "BridgeMCP Watchdog" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WatchdogScript" -ProjectRoot "$ProjectRoot"
"@

  if ($DryRun) {
    Write-Host "Dry run: would install no-admin Startup fallback: $startupCmd"
    return
  }

  Set-Content -LiteralPath $startupCmd -Value $cmd -Encoding ASCII

  Write-Host "Installed no-admin Startup fallback: $startupCmd"
  Write-Host "It will start at the next user logon."
  Write-Host "Start now with: powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`" -ProjectRoot `"$ProjectRoot`""
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
