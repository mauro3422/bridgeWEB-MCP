param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [int]$BridgePort = 3001,
  [int]$TunnelPort = 8081,
  [int[]]$DevPorts = @(3002, 3004, 8094),
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

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

function Add-Candidate {
  param(
    [System.Collections.Generic.Dictionary[int, object]]$Map,
    [int]$ProcessId,
    [string]$Reason
  )

  if ($ProcessId -eq $PID) { return }
  if ($Map.ContainsKey($ProcessId)) { return }

  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $proc) { return }

  $Map[$ProcessId] = [pscustomobject]@{
    ProcessId = $ProcessId
    Name = $proc.Name
    Reason = $Reason
    CommandLine = $proc.CommandLine
  }
}

Set-Location -LiteralPath $ProjectRoot
$ProjectRoot = (Get-Location).Path
$candidates = New-Object 'System.Collections.Generic.Dictionary[int, object]'

foreach ($port in $DevPorts) {
  if ($port -eq $BridgePort -or $port -eq $TunnelPort) { continue }
  $ownerPid = Get-ListenPid -Port $port
  if ($ownerPid) {
    Add-Candidate -Map $candidates -ProcessId $ownerPid -Reason "listening on dev/test port $port"
  }
}

$bridgeProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match 'powershell|node|tunnel-client' -and
    [string]$_.CommandLine -match 'bridge-mcp|start-bridge-http-watchdog|dist\\http|dist/http|BRIDGE_MCP_HTTP|tunnel-client'
  }

foreach ($proc in $bridgeProcesses) {
  $cmd = [string]$proc.CommandLine

  if ($proc.ProcessId -eq $PID) { continue }

  if ($cmd -match '(?i)(?:^|\s)-NoTunnel(?:\s|$)') {
    Add-Candidate -Map $candidates -ProcessId ([int]$proc.ProcessId) -Reason "NoTunnel dev watchdog"
    continue
  }

  $bridgePortMatch = [regex]::Match($cmd, '(?i)(?:^|\s)-BridgePort\s+(\d+)')
  if ($bridgePortMatch.Success -and [int]$bridgePortMatch.Groups[1].Value -ne $BridgePort) {
    Add-Candidate -Map $candidates -ProcessId ([int]$proc.ProcessId) -Reason "watchdog with non-production BridgePort $($bridgePortMatch.Groups[1].Value)"
    continue
  }

  $envPortMatch = [regex]::Match($cmd, "BRIDGE_MCP_HTTP_PORT='?(\d+)'?")
  if ($envPortMatch.Success -and [int]$envPortMatch.Groups[1].Value -ne $BridgePort) {
    Add-Candidate -Map $candidates -ProcessId ([int]$proc.ProcessId) -Reason "HTTP node shell with non-production BRIDGE_MCP_HTTP_PORT $($envPortMatch.Groups[1].Value)"
    continue
  }

  foreach ($port in $DevPorts) {
    if ($cmd -match [regex]::Escape(":$port")) {
      Add-Candidate -Map $candidates -ProcessId ([int]$proc.ProcessId) -Reason "command references dev/test port $port"
      break
    }
  }
}

$rows = @($candidates.Values | Sort-Object ProcessId)

if ($rows.Count -eq 0) {
  Write-Host "No dev/test bridge processes found. Production ports preserved: bridge=$BridgePort tunnel=$TunnelPort"
  exit 0
}

Write-Host "Dev/test bridge process candidates:"
$rows | Format-Table ProcessId,Name,Reason,CommandLine -Wrap

if (-not $Apply) {
  Write-Host "Dry run only. Re-run with -Apply to stop these processes."
  exit 0
}

foreach ($row in $rows) {
  Write-Host "Stopping PID=$($row.ProcessId) Name=$($row.Name) Reason=$($row.Reason)"
  Stop-Process -Id $row.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1
Write-Host "Cleanup complete. Run scripts\\bridge-doctor.ps1 to verify."
