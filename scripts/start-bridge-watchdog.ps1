param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$Profile = "bridge-local",
  [string]$TunnelClient = "C:\dev\bridge-mcp\tools\tunnel-client\tunnel-client.exe",
  [int]$RestartDelaySeconds = 5,
  [switch]$SkipDoctor
)

$ErrorActionPreference = "Stop"

function Write-BridgeLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] [bridge-watchdog] $Message"
}

Set-Location $ProjectRoot

if (-not (Test-Path -LiteralPath $TunnelClient)) {
  throw "tunnel-client not found: $TunnelClient"
}

Write-BridgeLog "ProjectRoot=$ProjectRoot"
Write-BridgeLog "Profile=$Profile"
Write-BridgeLog "TunnelClient=$TunnelClient"

while ($true) {
  try {
    Set-Location $ProjectRoot

    if (-not $SkipDoctor) {
      Write-BridgeLog "Running tunnel doctor..."
      & $TunnelClient doctor --profile $Profile --explain
      if ($LASTEXITCODE -ne 0) {
        Write-BridgeLog "Doctor failed with exit code $LASTEXITCODE. Waiting before retry."
        Start-Sleep -Seconds $RestartDelaySeconds
        continue
      }
    }

    Write-BridgeLog "Starting tunnel-client run --profile $Profile"
    & $TunnelClient run --profile $Profile
    $exitCode = $LASTEXITCODE
    Write-BridgeLog "tunnel-client exited with code $exitCode"
  }
  catch {
    Write-BridgeLog "ERROR: $($_.Exception.Message)"
  }

  Write-BridgeLog "Restarting in $RestartDelaySeconds seconds..."
  Start-Sleep -Seconds $RestartDelaySeconds
}
