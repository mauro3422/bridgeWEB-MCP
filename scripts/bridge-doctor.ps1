param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$Profile = "bridge-local-http",
  [string]$BridgeHost = "127.0.0.1",
  [int]$BridgePort = 3001,
  [string]$TunnelBaseUrl = "http://127.0.0.1:8081",
  [string]$StartupFileName = "BridgeMCP-Watchdog.cmd",
  [string]$ExpectedServerVersion = "0.6.2"
)

$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "=== $Title ==="
}

function Write-RecoveryHint {
  param([string]$Message)
  Write-Host "  hint: $Message"
}

function Test-HttpText {
  param([string]$Url, [string]$Expected)
  try {
    $value = Invoke-RestMethod -Uri $Url -TimeoutSec 3
    return [pscustomobject]@{ ok = ([string]$value -eq $Expected); value = [string]$value; error = $null }
  }
  catch {
    return [pscustomobject]@{ ok = $false; value = $null; error = $_.Exception.Message }
  }
}

function Get-JsonStatus {
  param([string]$Url)
  try {
    $value = Invoke-RestMethod -Uri $Url -TimeoutSec 3
    return [pscustomobject]@{ ok = $true; value = $value; error = $null }
  }
  catch {
    return [pscustomobject]@{ ok = $false; value = $null; error = $_.Exception.Message }
  }
}

function Get-ListenPid {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  }
  catch {}
  return $null
}

function Get-BridgeProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match 'node|powershell|tunnel-client' -and
      [string]$_.CommandLine -match 'bridge-mcp|tunnel-client|start-bridge|dist\\http|dist/http|BRIDGE_MCP_HTTP'
    } |
    Sort-Object ProcessId
}

Set-Location -LiteralPath $ProjectRoot
$ProjectRoot = (Get-Location).Path
$bridgeBaseUrl = "http://$BridgeHost`:$BridgePort"
$tunnelUri = [Uri]$TunnelBaseUrl
$tunnelPort = $tunnelUri.Port
$warnings = New-Object System.Collections.Generic.List[string]

Write-Section "Bridge doctor"
Write-Host "ProjectRoot: $ProjectRoot"
Write-Host "Profile:     $Profile"
Write-Host "Bridge:      $bridgeBaseUrl/mcp"
Write-Host "Tunnel:      $TunnelBaseUrl"
Write-Host "Expected:    server=$ExpectedServerVersion profile=$Profile bridgePort=$BridgePort tunnelPort=$tunnelPort"

Write-Section "HTTP health"
$bridgeStatus = Get-JsonStatus -Url "$bridgeBaseUrl/status"
if ($bridgeStatus.ok) {
  $status = $bridgeStatus.value
  Write-Host "bridge /status: OK server=$($status.server.name) version=$($status.server.version) pid=$($status.pid) sessions=$($status.sessions) uptimeSeconds=$($status.uptimeSeconds)"
  if ([string]$status.server.version -ne $ExpectedServerVersion) {
    $warnings.Add("bridge server version is $($status.server.version), expected $ExpectedServerVersion") | Out-Null
    Write-RecoveryHint "run npm run build, then request an HTTP restart through the watchdog."
  }
}
else {
  Write-Host "bridge /status: FAIL $($bridgeStatus.error)"
  Write-RecoveryHint "check the HTTP watchdog and port $BridgePort before changing code."
  $warnings.Add("bridge status is not reachable") | Out-Null
}

$bridgeReady = Test-HttpText -Url "$bridgeBaseUrl/readyz" -Expected "ready"
Write-Host "bridge /readyz: $(if ($bridgeReady.ok) { 'OK ready' } else { 'FAIL ' + $bridgeReady.error })"
if (-not $bridgeReady.ok) { $warnings.Add("bridge readyz is not ready") | Out-Null }

$tunnelHealth = Test-HttpText -Url "$TunnelBaseUrl/healthz" -Expected "live"
Write-Host "tunnel /healthz: $(if ($tunnelHealth.ok) { 'OK live' } else { 'FAIL ' + $tunnelHealth.error })"
if (-not $tunnelHealth.ok) {
  Write-RecoveryHint "the active HTTP profile uses tunnel admin $TunnelBaseUrl; do not fall back to 8080 unless you intentionally changed profiles."
  $warnings.Add("tunnel healthz is not live") | Out-Null
}

$tunnelReady = Test-HttpText -Url "$TunnelBaseUrl/readyz" -Expected "ready"
Write-Host "tunnel /readyz: $(if ($tunnelReady.ok) { 'OK ready' } else { 'FAIL ' + $tunnelReady.error })"
if (-not $tunnelReady.ok) {
  Write-RecoveryHint "check tunnel-client, the Startup watchdog launcher, and the profile name before restarting manually."
  $warnings.Add("tunnel readyz is not ready") | Out-Null
}

Write-Section "Listening ports"
$interestingPorts = @($BridgePort, $tunnelPort, 3002, 3004, 8080, 8094) | Sort-Object -Unique
$portRows = foreach ($port in $interestingPorts) {
  $ownerPid = Get-ListenPid -Port $port
  if ($ownerPid) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    [pscustomobject]@{ Port = $port; Pid = $ownerPid; Name = $proc.Name; CommandLine = $proc.CommandLine }
  }
}
if ($portRows) { $portRows | Format-Table Port,Pid,Name,CommandLine -Wrap }
else { Write-Host "No interesting bridge ports are listening." }

foreach ($testPort in @(3002, 3004, 8094)) {
  $ownerPid = Get-ListenPid -Port $testPort
  if ($ownerPid) { $warnings.Add("dev/test port $testPort is still listening on pid $ownerPid") | Out-Null }
}

Write-Section "Bridge-related processes"
$processes = @(Get-BridgeProcesses)
if ($processes.Count -gt 0) {
  $processes | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-List
}
else {
  Write-Host "No bridge-related processes found."
}

$productionWatchdogs = @($processes | Where-Object {
  $_.Name -like 'powershell*' -and
  [string]$_.CommandLine -match 'start-bridge-http-watchdog.ps1' -and
  [string]$_.CommandLine -notmatch '(?i)(?:^|\s)-NoTunnel(?:\s|$)'
})
if ($productionWatchdogs.Count -gt 1) {
  $warnings.Add("multiple production HTTP watchdogs found: $($productionWatchdogs.ProcessId -join ', ')") | Out-Null
}

$tunnels = @($processes | Where-Object {
  $_.Name -eq 'tunnel-client.exe' -and [string]$_.CommandLine -match "run --profile $([regex]::Escape($Profile))"
})
if ($tunnels.Count -gt 1) {
  $warnings.Add("multiple tunnel-client processes found for profile ${Profile}: $($tunnels.ProcessId -join ', ')") | Out-Null
}

Write-Section "Startup launcher"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupCmd = Join-Path $startupFolder $StartupFileName
Write-Host "Startup folder: $startupFolder"
if (Test-Path -LiteralPath $startupCmd) {
  Write-Host "Startup launcher: $startupCmd"
  Get-Content -LiteralPath $startupCmd | ForEach-Object { Write-Host "  $_" }
}
else {
  Write-Host "Startup launcher: not found"
  $warnings.Add("Startup launcher not found") | Out-Null
}

Write-Section "Restart coordination"
$requestPath = Join-Path $ProjectRoot ".bridge-restart-request"
$ackPath = Join-Path $ProjectRoot ".bridge-restart-ack"
Write-Host "request exists: $(Test-Path -LiteralPath $requestPath) path=$requestPath"
Write-Host "ack exists:     $(Test-Path -LiteralPath $ackPath) path=$ackPath"
if (Test-Path -LiteralPath $ackPath) {
  try {
    $ackText = Get-Content -LiteralPath $ackPath -Raw
    $ack = $ackText -replace '^\uFEFF', '' | ConvertFrom-Json
    Write-Host "last ack: action=$($ack.action) acknowledgedAt=$($ack.acknowledgedAt) watchdogPid=$($ack.watchdogPid)"
  }
  catch {
    Write-RecoveryHint "ack parse failures are usually stale/corrupt restart metadata, not a live bridge failure."
    $warnings.Add("restart ack exists but could not be parsed") | Out-Null
  }
}

Write-Section "Git"
git status --short --branch

Write-Section "Doctor result"
if ($warnings.Count -eq 0) {
  Write-Host "OK: no obvious bridge issues detected."
  exit 0
}

Write-Host "WARNINGS:"
foreach ($warning in $warnings) { Write-Host "- $warning" }
exit 1
