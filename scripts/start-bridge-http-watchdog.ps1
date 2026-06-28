param(
  [string]$ProjectRoot = ".",
  [string]$Profile = "bridge-local-http",
  [string]$TunnelClient = ".\tools\tunnel-client\tunnel-client.exe",
  [string]$BridgeHost = "127.0.0.1",
  [int]$BridgePort = 3001,
  [string]$McpPath = "/mcp",
  [string]$TunnelBaseUrl = "http://127.0.0.1:8081",
  [string]$RestartRequestFile = ".bridge-restart-request",
  [string]$RestartAckFile = ".bridge-restart-ack",
  [int]$CheckIntervalSeconds = 5,
  [int]$RestartDelaySeconds = 2,
  [switch]$Build,
  [switch]$NoTunnel,
  [switch]$Once,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-BridgeLog {
  param([string]$Message, [string]$Level = "info")
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] [bridge-http-watchdog] [$Level] $Message"
}

function Test-HttpText {
  param([string]$Url, [string]$Expected)
  try {
    $value = Invoke-RestMethod -Uri $Url -TimeoutSec 3
    return [string]$value -eq $Expected
  }
  catch {
    return $false
  }
}

function Stop-ChildProcess {
  param([System.Diagnostics.Process]$Process, [string]$Name)
  if ($null -eq $Process) { return }
  if ($Process.HasExited) { return }

  Write-BridgeLog "Stopping $Name pid=$($Process.Id)"
  try {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
  }
  catch {
    Write-BridgeLog "Failed to stop $Name pid=$($Process.Id): $($_.Exception.Message)" "warn"
  }
}

function Start-BridgeHttp {
  if ($DryRun) {
    Write-BridgeLog "Dry run: would start bridge HTTP server on http://$BridgeHost`:$BridgePort$McpPath"
    return $null
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ".\dist\http.js"
  $psi.WorkingDirectory = $ProjectRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false
  $psi.Environment["BRIDGE_MCP_HTTP_HOST"] = $BridgeHost
  $psi.Environment["BRIDGE_MCP_HTTP_PORT"] = [string]$BridgePort
  $psi.Environment["BRIDGE_MCP_HTTP_PATH"] = $McpPath

  $process = [System.Diagnostics.Process]::Start($psi)
  Write-BridgeLog "Started bridge HTTP pid=$($process.Id)"
  return $process
}

function Start-TunnelClient {
  if ($NoTunnel) { return $null }
  if ($DryRun) {
    Write-BridgeLog "Dry run: would start tunnel-client run --profile $Profile"
    return $null
  }

  if (-not (Test-Path -LiteralPath $TunnelClient)) {
    throw "tunnel-client not found: $TunnelClient"
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $TunnelClient
  $psi.Arguments = "run --profile $Profile"
  $psi.WorkingDirectory = $ProjectRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false

  $process = [System.Diagnostics.Process]::Start($psi)
  Write-BridgeLog "Started tunnel-client profile=$Profile pid=$($process.Id)"
  return $process
}

function Write-RestartAck {
  param([object]$Request, [string]$Action)

  $ackPath = Join-Path $ProjectRoot $RestartAckFile
  $ack = [ordered]@{
    id = if ($Request -and $Request.id) { $Request.id } else { [guid]::NewGuid().ToString() }
    action = $Action
    acknowledgedAt = (Get-Date).ToUniversalTime().ToString("o")
    watchdogPid = $PID
    profile = $Profile
    bridgeBaseUrl = "http://$BridgeHost`:$BridgePort"
    tunnelBaseUrl = $TunnelBaseUrl
    request = $Request
  }
  $ack | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ackPath -Encoding UTF8
}

function Read-RestartRequest {
  $requestPath = Join-Path $ProjectRoot $RestartRequestFile
  if (-not (Test-Path -LiteralPath $requestPath)) { return $null }

  try {
    $request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
  }
  catch {
    $request = [pscustomobject]@{ id = [guid]::NewGuid().ToString(); parseError = $_.Exception.Message }
  }

  Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue
  return $request
}

Set-Location $ProjectRoot
$ProjectRoot = (Get-Location).Path
$bridgeBaseUrl = "http://$BridgeHost`:$BridgePort"

Write-BridgeLog "ProjectRoot=$ProjectRoot"
Write-BridgeLog "Bridge HTTP=$bridgeBaseUrl$McpPath"
Write-BridgeLog "Tunnel profile=$Profile admin=$TunnelBaseUrl"
Write-BridgeLog "Restart request file=$(Join-Path $ProjectRoot $RestartRequestFile)"

$bridgeProcess = $null
$tunnelProcess = $null

try {
  if ($Build -and -not $DryRun) {
    Write-BridgeLog "Running npm run build before startup"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
  }

  $bridgeProcess = Start-BridgeHttp
  Start-Sleep -Seconds 1
  $tunnelProcess = Start-TunnelClient

  do {
    $bridgeReady = Test-HttpText -Url "$bridgeBaseUrl/readyz" -Expected "ready"
    $tunnelReady = if ($NoTunnel) { $true } else { Test-HttpText -Url "$TunnelBaseUrl/readyz" -Expected "ready" }
    $request = Read-RestartRequest

    if ($request) {
      $mode = if ($request.mode) { [string]$request.mode } else { "http" }
      Write-BridgeLog "Restart requested id=$($request.id) mode=$mode reason=$($request.reason)"

      if ($mode -eq "http" -or $mode -eq "full") {
        Stop-ChildProcess -Process $bridgeProcess -Name "bridge HTTP"
        Start-Sleep -Seconds $RestartDelaySeconds
        $bridgeProcess = Start-BridgeHttp
      }

      if (($mode -eq "tunnel" -or $mode -eq "full") -and -not $NoTunnel) {
        Stop-ChildProcess -Process $tunnelProcess -Name "tunnel-client"
        Start-Sleep -Seconds $RestartDelaySeconds
        $tunnelProcess = Start-TunnelClient
      }

      Write-RestartAck -Request $request -Action "restart-$mode"
    }
    elseif (-not $bridgeReady) {
      Write-BridgeLog "Bridge HTTP not ready; restarting local bridge" "warn"
      Stop-ChildProcess -Process $bridgeProcess -Name "bridge HTTP"
      Start-Sleep -Seconds $RestartDelaySeconds
      $bridgeProcess = Start-BridgeHttp
      Write-RestartAck -Request $null -Action "auto-restart-http-not-ready"
    }
    elseif (-not $tunnelReady) {
      Write-BridgeLog "Tunnel not ready; restarting tunnel-client" "warn"
      Stop-ChildProcess -Process $tunnelProcess -Name "tunnel-client"
      Start-Sleep -Seconds $RestartDelaySeconds
      $tunnelProcess = Start-TunnelClient
      Write-RestartAck -Request $null -Action "auto-restart-tunnel-not-ready"
    }

    if ($Once) { break }
    Start-Sleep -Seconds $CheckIntervalSeconds
  } while ($true)
}
finally {
  if ($Once -or $DryRun) {
    Stop-ChildProcess -Process $tunnelProcess -Name "tunnel-client"
    Stop-ChildProcess -Process $bridgeProcess -Name "bridge HTTP"
  }
}
