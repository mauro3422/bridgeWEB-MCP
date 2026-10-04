$ErrorActionPreference = "Stop"

$watchdogPath = Join-Path $PSScriptRoot "start-bridge-http-watchdog.ps1"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$powershellPath = (Get-Command powershell -ErrorAction Stop).Source
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$prefix = $tempBase.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$bridgeExitRoot = Join-Path $tempBase ("bridge-watchdog-bridge-exit-" + [guid]::NewGuid().ToString("N"))
$tunnelExitRoot = Join-Path $tempBase ("bridge-watchdog-tunnel-exit-" + [guid]::NewGuid().ToString("N"))
$bridgeExitProcess = $null
$tunnelFixtureProcess = $null
$previousCaMarker = [Environment]::GetEnvironmentVariable("BRIDGE_WATCHDOG_TEST_CA_MARKER", "Process")

foreach ($root in @($bridgeExitRoot, $tunnelExitRoot)) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($root)
  if (-not $resolvedRoot.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use test root outside the temporary directory: $resolvedRoot"
  }
}

function New-TestRoot {
  param([string]$Root, [string]$Version)
  New-Item -ItemType Directory -Path (Join-Path $Root "dist") -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $Root "package.json") -Value (@{ version = $Version } | ConvertTo-Json -Compress) -Encoding UTF8
}

function Get-FreeLoopbackPort {
  $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  try {
    $probe.Start()
    return [int]$probe.LocalEndpoint.Port
  }
  finally {
    $probe.Stop()
  }
}

function Wait-ForListener {
  param([int]$Port, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 10)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process) {
      $Process.Refresh()
      if ($Process.HasExited) { throw "Bridge fixture exited before listening on port $Port with code $($Process.ExitCode)" }
    }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1) {
      return
    }
    Start-Sleep -Milliseconds 100
  }
  throw "Fixture did not listen on port $Port"
}

function Read-LifecycleEvents {
  param([string]$Root)
  $path = Join-Path $Root "logs\bridge-watchdog-lifecycle.jsonl"
  if (-not (Test-Path -LiteralPath $path)) { throw "Lifecycle log was not written under test root $Root" }
  $raw = Get-Content -LiteralPath $path -Raw
  if ($raw -match '(?i)"(commandLine|command_line|arguments|rawOutput|prompt|token)"') {
    throw "Lifecycle log contains a disallowed raw process field"
  }
  return @($raw -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_ | ConvertFrom-Json })
}

function Assert-BridgeProcessIdentityPattern {
  $patternLine = Get-Content -LiteralPath $watchdogPath | Where-Object { $_ -match '^\$bridgeCommandPattern\s*=' } | Select-Object -First 1
  if (-not $patternLine) { throw "Bridge process identity pattern was not found in the watchdog" }
  $pattern = $patternLine.Substring($patternLine.IndexOf("= '") + 3).TrimEnd("'").Replace("''", "'")
  $fixtures = @(
    @{ label = "bare node command with quoted entrypoint"; commandLine = '"node" "D:\Dev\bridge-mcp\dist\http.js"'; expected = $true },
    @{ label = "Node executable under Program Files"; commandLine = '"C:\Program Files\nodejs\node.exe" "D:\Dev\bridge-mcp\dist\http.js"'; expected = $true },
    @{ label = "Node source entrypoint"; commandLine = 'node D:\Dev\bridge-mcp\src\http.ts'; expected = $true },
    @{ label = "unrelated Python process"; commandLine = '"C:\Python\python.exe" "D:\Dev\bridge-mcp\dist\http.js"'; expected = $false }
  )
  foreach ($fixture in $fixtures) {
    $actual = [regex]::IsMatch($fixture.commandLine, $pattern)
    if ($actual -ne $fixture.expected) { throw "Bridge process identity regression failed for $($fixture.label)" }
  }
}

function Assert-RecoveryRecord {
  param(
    [object]$Record,
    [string]$Component,
    [string]$Trigger,
    [string]$Action,
    [object]$ExitCode
  )
  if (-not $Record) { throw "No recovery event for $Component" }
  if ($Record.component -ne $Component) { throw "Wrong component in recovery event: $($Record.component)" }
  if ($Record.eventType -ne "process-recovery") { throw "Wrong event type: $($Record.eventType)" }
  if ($Record.trigger -ne $Trigger) { throw "Wrong trigger for ${Component}: $($Record.trigger)" }
  if ($Record.recoveryAction -ne $Action) { throw "Wrong recovery action for ${Component}: $($Record.recoveryAction)" }
  if (-not $Record.recoveryId) { throw "Recovery event has no correlation id for $Component" }
  if (-not $Record.processId -or -not $Record.replacementProcessId) { throw "Recovery event is missing old or replacement PID for $Component" }
  if (-not $Record.processStartedAtUtc -or -not $Record.observedAtUtc) { throw "Recovery event is missing timestamps for $Component" }
  if ($null -eq $Record.uptimeSecondsAtObservation) { throw "Recovery event is missing uptime for $Component" }
  if ($null -eq $Record.terminationConfirmed -or -not $Record.terminationConfirmed) { throw "Recovery event did not confirm the old process termination for $Component" }
  if ($null -eq $Record.processExitCode -or [int]$Record.processExitCode -ne [int]$ExitCode) {
    throw "Wrong process exit code for ${Component}: $($Record.processExitCode)"
  }
}

try {
  Assert-BridgeProcessIdentityPattern
  New-TestRoot -Root $bridgeExitRoot -Version "0.0.0-watchdog-bridge-exit-test"
  $bridgeExitPort = Get-FreeLoopbackPort
  $caMarker = Join-Path $bridgeExitRoot "node-system-ca-mode.txt"
  Set-Content -LiteralPath (Join-Path $bridgeExitRoot "dist\http.js") -Value @'
const fs = require("node:fs");
fs.writeFileSync(process.env.BRIDGE_WATCHDOG_TEST_CA_MARKER, process.env.NODE_USE_SYSTEM_CA || "unset");
setTimeout(() => process.exit(23), 25);
'@ -Encoding UTF8

  $bridgeArgs = @(
    "-ProjectRoot", $bridgeExitRoot,
    "-Profile", "watchdog-lifecycle-bridge-test",
    "-TunnelClient", $nodePath,
    "-TunnelProfileDir", $bridgeExitRoot,
    "-TunnelBaseUrl", "http://127.0.0.1:$(Get-FreeLoopbackPort)",
    "-BridgeHost", "127.0.0.1",
    "-BridgePort", [string]$bridgeExitPort,
    "-RestartDelaySeconds", "0",
    "-ProbeTimeoutSeconds", "2",
    "-ConsecutiveFailureThreshold", "2",
    "-AliveReadinessGraceSeconds", "15",
    "-CheckIntervalSeconds", "1",
    "-NoTunnel", "-Once", "-AllowDuplicate"
  )
  [Environment]::SetEnvironmentVariable("BRIDGE_WATCHDOG_TEST_CA_MARKER", $caMarker, "Process")
  & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $watchdogPath @bridgeArgs
  if ($LASTEXITCODE -ne 0) { throw "Bridge exit scenario watchdog failed with code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $caMarker)) { throw "Watchdog bridge fixture did not write the CA-mode readback" }
  if ((Get-Content -LiteralPath $caMarker -Raw).Trim() -ne "1") { throw "Watchdog did not enable the Node system CA store for its HTTP child" }

  $bridgeEvents = Read-LifecycleEvents -Root $bridgeExitRoot
  $bridgeRecovery = $bridgeEvents | Where-Object { $_.component -eq "bridge-http" -and $_.eventType -eq "process-recovery" } | Select-Object -First 1
  Assert-RecoveryRecord -Record $bridgeRecovery -Component "bridge-http" -Trigger "process-exited" -Action "restart-http" -ExitCode 23
  $bridgeAck = Get-Content -LiteralPath (Join-Path $bridgeExitRoot ".bridge-restart-ack") -Raw | ConvertFrom-Json
  if ([int]$bridgeAck.evidence.processExitCode -ne 23) { throw "Bridge restart ack did not preserve the process exit code" }
  if ($bridgeAck.evidence.processLifecycle.trigger -ne "process-exited") { throw "Bridge restart ack did not preserve the recovery trigger" }

  New-TestRoot -Root $tunnelExitRoot -Version "0.0.0-watchdog-tunnel-exit-test"
  $tunnelProfile = "watchdog-lifecycle-tunnel-test"
  Set-Content -LiteralPath (Join-Path $tunnelExitRoot "$tunnelProfile.yaml") -Value "profile: fixture" -Encoding UTF8
  $tunnelBridgePort = Get-FreeLoopbackPort
  do {
    $tunnelAdminPort = Get-FreeLoopbackPort
  } while ($tunnelAdminPort -eq $tunnelBridgePort)
  $bridgeFixturePath = Join-Path $tunnelExitRoot "dist\http.js"
  Set-Content -LiteralPath $bridgeFixturePath -Value @'
const http = require("node:http");
const port = Number(process.argv[2]);
const version = "0.0.0-watchdog-tunnel-exit-test";
http.createServer((req, res) => {
  if (req.url === "/readyz") {
    res.end("ready");
    return;
  }
  if (req.url === "/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      server: { name: "bridge-mcp", version },
      port,
      transport: "streamable-http-dual-era"
    }));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
}).listen(port, "127.0.0.1");
'@ -Encoding UTF8

  $bridgeFixtureStart = [System.Diagnostics.ProcessStartInfo]::new()
  $bridgeFixtureStart.FileName = "node"
  $bridgeFixtureStart.Arguments = ('"{0}" {1}' -f $bridgeFixturePath, $tunnelBridgePort)
  $bridgeFixtureStart.WorkingDirectory = $tunnelExitRoot
  $bridgeFixtureStart.UseShellExecute = $false
  $bridgeFixtureStart.CreateNoWindow = $true
  $bridgeFixtureProcess = [System.Diagnostics.Process]::Start($bridgeFixtureStart)
  Wait-ForListener -Port $tunnelBridgePort -Process $bridgeFixtureProcess

  $tunnelArgs = @(
    "-ProjectRoot", $tunnelExitRoot,
    "-Profile", $tunnelProfile,
    "-TunnelClient", $nodePath,
    "-TunnelProfileDir", $tunnelExitRoot,
    "-TunnelBaseUrl", "http://127.0.0.1:$tunnelAdminPort",
    "-BridgeHost", "127.0.0.1",
    "-BridgePort", [string]$tunnelBridgePort,
    "-RestartDelaySeconds", "0",
    "-ProbeTimeoutSeconds", "2",
    "-ConsecutiveFailureThreshold", "2",
    "-AliveReadinessGraceSeconds", "15",
    "-CheckIntervalSeconds", "1",
    "-Once", "-AllowDuplicate"
  )
  & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $watchdogPath @tunnelArgs
  if ($LASTEXITCODE -ne 0) { throw "Tunnel exit scenario watchdog failed with code $LASTEXITCODE" }

  $tunnelEvents = Read-LifecycleEvents -Root $tunnelExitRoot
  $tunnelRecovery = $tunnelEvents | Where-Object { $_.component -eq "tunnel-client" -and $_.eventType -eq "process-recovery" } | Select-Object -First 1
  $tunnelAck = Get-Content -LiteralPath (Join-Path $tunnelExitRoot ".bridge-restart-ack") -Raw | ConvertFrom-Json
  $tunnelExitCode = $tunnelAck.evidence.processAfterRecovery.processExitCode
  if ($null -eq $tunnelExitCode) { throw "Tunnel restart ack did not preserve the exited tunnel process code" }
  Assert-RecoveryRecord -Record $tunnelRecovery -Component "tunnel-client" -Trigger "process-exited" -Action "restart-tunnel" -ExitCode $tunnelExitCode
  if ($tunnelAck.evidence.recoveryReason -ne "process-exited") { throw "Tunnel restart ack did not preserve the recovery trigger" }

  Write-Output (@{
    ok = $true
    bridgeExitCode = [int]$bridgeRecovery.processExitCode
    bridgeRecoveryId = $bridgeRecovery.recoveryId
    tunnelExitCode = [int]$tunnelExitCode
    tunnelRecoveryId = $tunnelRecovery.recoveryId
    liveProductionProcessesTouched = $false
    rawProcessArgumentsPersisted = $false
  } | ConvertTo-Json -Compress)
}
finally {
  [Environment]::SetEnvironmentVariable("BRIDGE_WATCHDOG_TEST_CA_MARKER", $previousCaMarker, "Process")
  foreach ($process in @($bridgeFixtureProcess)) {
    if ($process) {
      try {
        $process.Refresh()
        if (-not $process.HasExited) {
          $process.Kill()
          $process.WaitForExit(5000) | Out-Null
        }
      }
      catch {}
    }
  }

  foreach ($root in @($bridgeExitRoot, $tunnelExitRoot)) {
    if (Test-Path -LiteralPath $root) {
      $resolvedRoot = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $root).Path)
      if (-not $resolvedRoot.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected test root: $resolvedRoot"
      }
      Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    }
  }
}
