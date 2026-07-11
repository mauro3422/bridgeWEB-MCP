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
  [int]$SessionIdleMs = 1800000,
  [int]$CapacityReclaimIdleMs = 15000,
  [int]$AnonymousTransportTtlMs = 60000,
  [int]$CleanupIntervalMs = 60000,
  [int]$MaxSessions = 64,
  [int]$MaxBodyBytes = 1048576,
  [switch]$Build,
  [switch]$NoTunnel,
  [switch]$Once,
  [switch]$DryRun,
  [switch]$AllowDuplicate
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

function Get-BridgeStatus {
  param([string]$BaseUrl)
  try {
    return Invoke-RestMethod -Uri "$BaseUrl/status" -TimeoutSec 3
  }
  catch {
    return $null
  }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  try {
    return [string](Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine
  }
  catch {
    return ""
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

function Get-ProcessStateFromPort {
  param([int]$Port, [string]$Name)
  $pidFromPort = Get-ListenPid -Port $Port
  if (-not $pidFromPort) { return $null }
  try {
    $proc = Get-Process -Id $pidFromPort -ErrorAction Stop
    return [pscustomobject]@{ Process = $proc; Managed = $false; Name = $Name; Port = $Port }
  }
  catch {
    return $null
  }
}

function Get-Sha256Hex {
  param([string]$Text)

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return -join ($hash | ForEach-Object { $_.ToString("x2") })
  }
  finally {
    $sha.Dispose()
  }
}

function Get-CommandLineParamValue {
  param([string]$CommandLine, [string]$Name)

  $pattern = "(?i)(?:^|\s)-$([regex]::Escape($Name))\s+(?:`"([^`"]+)`"|'([^']+)'|([^\s]+))"
  $match = [regex]::Match($CommandLine, $pattern)
  if (-not $match.Success) { return $null }

  foreach ($index in 1..3) {
    if ($match.Groups[$index].Success) { return $match.Groups[$index].Value }
  }

  return $null
}

function Assert-NoDuplicateWatchdog {
  if ($AllowDuplicate -or $NoTunnel -or $Once) { return }

  $scriptPattern = [regex]::Escape("start-bridge-http-watchdog.ps1")
  $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.Name -like "powershell*" -and
      [string]$_.CommandLine -match $scriptPattern
    }

  foreach ($candidate in $candidates) {
    $cmd = [string]$candidate.CommandLine
    if ($cmd -match "(?i)(?:^|\s)-NoTunnel(?:\s|$)") { continue }

    $candidateBridgePort = Get-CommandLineParamValue -CommandLine $cmd -Name "BridgePort"
    if ($candidateBridgePort -and [int]$candidateBridgePort -ne $BridgePort) { continue }
    if (-not $candidateBridgePort -and $BridgePort -ne 3001) { continue }

    $candidateProfile = Get-CommandLineParamValue -CommandLine $cmd -Name "Profile"
    if ($candidateProfile -and $candidateProfile -ne $Profile) { continue }

    $candidateTunnelBaseUrl = Get-CommandLineParamValue -CommandLine $cmd -Name "TunnelBaseUrl"
    if ($candidateTunnelBaseUrl -and $candidateTunnelBaseUrl -ne $TunnelBaseUrl) { continue }

    throw "Another bridge HTTP watchdog appears to be running for this production profile: pid=$($candidate.ProcessId) command=$cmd"
  }
}

function Enter-BridgeWatchdogSingleton {
  if ($AllowDuplicate) {
    Write-BridgeLog "AllowDuplicate was set; singleton protection is disabled" "warn"
    return $null
  }

  Assert-NoDuplicateWatchdog

  $identity = "project=$ProjectRoot|profile=$Profile|bridge=$BridgeHost`:$BridgePort|tunnel=$TunnelBaseUrl|notunnel=$NoTunnel"
  $hash = Get-Sha256Hex -Text $identity
  $mutexName = "Local\BridgeMCPHttpWatchdog-$($hash.Substring(0, 32))"
  $createdNew = $false
  $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)

  if (-not $createdNew) {
    $acquired = $false
    try {
      $acquired = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
      Write-BridgeLog "Recovered abandoned watchdog singleton lock: $mutexName" "warn"
    }

    if (-not $acquired) {
      $mutex.Dispose()
      throw "Another bridge HTTP watchdog already holds singleton lock: $mutexName identity=$identity"
    }
  }

  Write-BridgeLog "Acquired watchdog singleton lock: $mutexName"
  return $mutex
}

function Stop-ProcessState {
  param([object]$State, [string]$Name, [switch]$ForceExternal)
  if ($null -eq $State) { return }
  if ($null -eq $State.Process) { return }

  $proc = $State.Process
  if ($proc.HasExited) { return }

  if (-not $State.Managed -and -not $ForceExternal) {
    Write-BridgeLog "Leaving externally-started $Name pid=$($proc.Id) running"
    return
  }

  Write-BridgeLog "Stopping $Name pid=$($proc.Id) managed=$($State.Managed)"
  try {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(5000) | Out-Null
  }
  catch {
    Write-BridgeLog "Failed to stop $Name pid=$($proc.Id): $($_.Exception.Message)" "warn"
  }
}

function Stop-PortOwner {
  param([int]$Port, [string]$Name, [string]$ExpectedCommandPattern)
  $pidFromPort = Get-ListenPid -Port $Port
  if (-not $pidFromPort) { return }

  $commandLine = Get-ProcessCommandLine -ProcessId $pidFromPort
  if (-not $ExpectedCommandPattern -or -not $commandLine -or $commandLine -notmatch $ExpectedCommandPattern) {
    throw "Refusing to stop unknown $Name listener pid=$pidFromPort port=$Port command=$commandLine"
  }

  Write-BridgeLog "Stopping verified $Name listener pid=$pidFromPort port=$Port"
  try {
    Stop-Process -Id $pidFromPort -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 500
  }
  catch {
    Write-BridgeLog "Failed to stop $Name listener pid=$pidFromPort port=${Port}: $($_.Exception.Message)" "warn"
    throw
  }
}

function Start-BridgeHttp {
  $readyUrl = "http://$BridgeHost`:$BridgePort/readyz"
  if (Test-HttpText -Url $readyUrl -Expected "ready") {
    $status = Get-BridgeStatus -BaseUrl "http://$BridgeHost`:$BridgePort"
    if (-not $status -or [string]$status.server.name -ne "bridge-mcp" -or [string]$status.server.version -ne $expectedServerVersion -or [int]$status.port -ne $BridgePort -or [string]$status.transport -ne "streamable-http") {
      throw "Port $BridgePort reports ready but does not identify as the expected bridge-mcp service."
    }

    $state = Get-ProcessStateFromPort -Port $BridgePort -Name "bridge HTTP"
    if ($state) {
      $commandLine = Get-ProcessCommandLine -ProcessId $state.Process.Id
      if (-not $commandLine -or $commandLine -notmatch $bridgeCommandPattern) {
        throw "Bridge endpoint identity matched, but process identity did not: pid=$($state.Process.Id) command=$commandLine"
      }
      Write-BridgeLog "Bridge HTTP already ready on port $BridgePort pid=$($state.Process.Id); adopting verified process"
      return $state
    }
    throw "Bridge HTTP reports ready on port $BridgePort, but its owner pid is unavailable."
  }

  $existingPid = Get-ListenPid -Port $BridgePort
  if ($existingPid) {
    Write-BridgeLog "Bridge HTTP port $BridgePort is occupied but not ready; replacing pid=$existingPid" "warn"
    Stop-PortOwner -Port $BridgePort -Name "bridge HTTP" -ExpectedCommandPattern $bridgeCommandPattern
  }

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
  $psi.Environment["BRIDGE_MCP_HTTP_SESSION_IDLE_MS"] = [string]$SessionIdleMs
  $psi.Environment["BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS"] = [string]$CapacityReclaimIdleMs
  $psi.Environment["BRIDGE_MCP_HTTP_ANON_TTL_MS"] = [string]$AnonymousTransportTtlMs
  $psi.Environment["BRIDGE_MCP_HTTP_CLEANUP_INTERVAL_MS"] = [string]$CleanupIntervalMs
  $psi.Environment["BRIDGE_MCP_HTTP_MAX_SESSIONS"] = [string]$MaxSessions
  $psi.Environment["BRIDGE_MCP_HTTP_MAX_BODY_BYTES"] = [string]$MaxBodyBytes

  $process = [System.Diagnostics.Process]::Start($psi)
  Write-BridgeLog "Started bridge HTTP pid=$($process.Id)"
  return [pscustomobject]@{ Process = $process; Managed = $true; Name = "bridge HTTP"; Port = $BridgePort }
}

function Start-TunnelClient {
  if ($NoTunnel) { return $null }

  $tunnelUri = [Uri]$TunnelBaseUrl
  $tunnelPort = $tunnelUri.Port
  if (Test-HttpText -Url "$TunnelBaseUrl/readyz" -Expected "ready") {
    $state = Get-ProcessStateFromPort -Port $tunnelPort -Name "tunnel-client"
    if ($state) {
      $commandLine = Get-ProcessCommandLine -ProcessId $state.Process.Id
      if ($state.Process.Name -notlike "tunnel-client*" -or -not $commandLine -or $commandLine -notmatch $tunnelCommandPattern) {
        throw "Tunnel admin endpoint is ready, but process identity did not match: pid=$($state.Process.Id) command=$commandLine"
      }
      Write-BridgeLog "Tunnel already ready on port $tunnelPort pid=$($state.Process.Id); adopting verified process"
      return $state
    }
    throw "Tunnel reports ready on port $tunnelPort, but its owner pid is unavailable."
  }

  $existingPid = Get-ListenPid -Port $tunnelPort
  if ($existingPid) {
    Write-BridgeLog "Tunnel admin port $tunnelPort is occupied but not ready; replacing pid=$existingPid" "warn"
    Stop-PortOwner -Port $tunnelPort -Name "tunnel-client" -ExpectedCommandPattern $tunnelCommandPattern
  }

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
  return [pscustomobject]@{ Process = $process; Managed = $true; Name = "tunnel-client"; Port = $tunnelPort }
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
if (-not [System.IO.Path]::IsPathRooted($TunnelClient)) {
  $TunnelClient = Join-Path $ProjectRoot $TunnelClient
}
$bridgeBaseUrl = "http://$BridgeHost`:$BridgePort"
$expectedServerVersion = [string](Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$bridgeCommandPattern = '(?i)(?:^|\s)"?(?:node|node\.exe)"?.*?[\\/]dist[\\/]http\.js(?:\s|$)'
$escapedProfile = [regex]::Escape($Profile)
$tunnelCommandPattern = '(?i)tunnel-client(?:\.exe)?.*\brun\b.*--profile\s+.*' + $escapedProfile + '(?:\s|$)'

Write-BridgeLog "ProjectRoot=$ProjectRoot"
Write-BridgeLog "Bridge HTTP=$bridgeBaseUrl$McpPath"
Write-BridgeLog "Tunnel profile=$Profile admin=$TunnelBaseUrl"
Write-BridgeLog "Session limits: max=$MaxSessions idleMs=$SessionIdleMs reclaimIdleMs=$CapacityReclaimIdleMs anonymousTtlMs=$AnonymousTransportTtlMs cleanupMs=$CleanupIntervalMs maxBodyBytes=$MaxBodyBytes"
Write-BridgeLog "Restart request file=$(Join-Path $ProjectRoot $RestartRequestFile)"

$bridgeProcess = $null
$tunnelProcess = $null
$watchdogMutex = $null

try {
  $watchdogMutex = Enter-BridgeWatchdogSingleton

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
        Stop-ProcessState -State $bridgeProcess -Name "bridge HTTP" -ForceExternal
        Stop-PortOwner -Port $BridgePort -Name "bridge HTTP" -ExpectedCommandPattern $bridgeCommandPattern
        Start-Sleep -Seconds $RestartDelaySeconds
        $bridgeProcess = Start-BridgeHttp
      }

      if (($mode -eq "tunnel" -or $mode -eq "full") -and -not $NoTunnel) {
        $tunnelPort = ([Uri]$TunnelBaseUrl).Port
        Stop-ProcessState -State $tunnelProcess -Name "tunnel-client" -ForceExternal
        Stop-PortOwner -Port $tunnelPort -Name "tunnel-client" -ExpectedCommandPattern $tunnelCommandPattern
        Start-Sleep -Seconds $RestartDelaySeconds
        $tunnelProcess = Start-TunnelClient
      }

      Write-RestartAck -Request $request -Action "restart-$mode"
    }
    elseif (-not $bridgeReady) {
      Write-BridgeLog "Bridge HTTP not ready; restarting local bridge" "warn"
      Stop-ProcessState -State $bridgeProcess -Name "bridge HTTP" -ForceExternal
      Stop-PortOwner -Port $BridgePort -Name "bridge HTTP" -ExpectedCommandPattern $bridgeCommandPattern
      Start-Sleep -Seconds $RestartDelaySeconds
      $bridgeProcess = Start-BridgeHttp
      Write-RestartAck -Request $null -Action "auto-restart-http-not-ready"
    }
    elseif (-not $tunnelReady) {
      Write-BridgeLog "Tunnel not ready; restarting tunnel-client" "warn"
      $tunnelPort = ([Uri]$TunnelBaseUrl).Port
      Stop-ProcessState -State $tunnelProcess -Name "tunnel-client" -ForceExternal
      Stop-PortOwner -Port $tunnelPort -Name "tunnel-client" -ExpectedCommandPattern $tunnelCommandPattern
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
    Stop-ProcessState -State $tunnelProcess -Name "tunnel-client"
    Stop-ProcessState -State $bridgeProcess -Name "bridge HTTP"
  }

  if ($watchdogMutex) {
    try {
      $watchdogMutex.ReleaseMutex() | Out-Null
      Write-BridgeLog "Released watchdog singleton lock"
    }
    catch {
      Write-BridgeLog "Failed to release watchdog singleton lock: $($_.Exception.Message)" "warn"
    }
    finally {
      $watchdogMutex.Dispose()
    }
  }
}
