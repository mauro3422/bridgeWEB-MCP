param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$Profile = "bridge-local-http",
  [string]$BridgeHost = "127.0.0.1",
  [int]$BridgePort = 3001,
  [string]$TunnelBaseUrl = "http://127.0.0.1:8081",
  [string]$StartupFileName = "BridgeMCP-Watchdog.cmd"
)

$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "=== $Title ==="
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

Write-Section "HTTP health"
$bridgeStatus = Get-JsonStatus -Url "$bridgeBaseUrl/status"
if ($bridgeStatus.ok) {
  $status = $bridgeStatus.value
  Write-Host "bridge /status: OK server=$($status.server.name) version=$($status.server.version) pid=$($status.pid) sessions=$($status.sessions) uptimeSeconds=$($status.uptimeSeconds)"
}
else {
  Write-Host "bridge /status: FAIL $($bridgeStatus.error)"
  $warnings.Add("bridge status is not reachable") | Out-Null
}

$bridgeReady = Test-HttpText -Url "$bridgeBaseUrl/readyz" -Expected "ready"
Write-Host "bridge /readyz: $(if ($bridgeReady.ok) { 'OK ready' } else { 'FAIL ' + $bridgeReady.error })"
if (-not $bridgeReady.ok) { $warnings.Add("bridge readyz is not ready") | Out-Null }

$tunnelReady = Test-HttpText -Url "$TunnelBaseUrl/readyz" -Expected "ready"
Write-Host "tunnel /readyz: $(if ($tunnelReady.ok) { 'OK ready' } else { 'FAIL ' + $tunnelReady.error })"
if (-not $tunnelReady.ok) { $warnings.Add("tunnel readyz is not ready") | Out-Null }

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
    $ack = Get-Content -LiteralPath $ackPath -Raw | ConvertFrom-Json
    Write-Host "last ack: action=$($ack.action) acknowledgedAt=$($ack.acknowledgedAt) watchdogPid=$($ack.watchdogPid)"
  }
  catch {
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

