$ErrorActionPreference = "Stop"

$watchdogPath = Join-Path $PSScriptRoot "start-bridge-http-watchdog.ps1"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$powershellPath = (Get-Command powershell -ErrorAction Stop).Source
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase ("bridge-watchdog-dry-run-" + [guid]::NewGuid().ToString("N"))
$testRoot = [System.IO.Path]::GetFullPath($testRoot)
$prefix = $tempBase.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $testRoot.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use test root outside the temporary directory: $testRoot"
}

$probeProcess = $null
$previousPortEnv = [Environment]::GetEnvironmentVariable("BRIDGE_WATCHDOG_TEST_PORT", "Process")
$portProbe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
try {
  $portProbe.Start()
  $testPort = [int]$portProbe.LocalEndpoint.Port
}
finally {
  $portProbe.Stop()
}

try {
  New-Item -ItemType Directory -Path (Join-Path $testRoot "dist") -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $testRoot "package.json") -Value '{"version":"0.0.0-dry-run-test"}' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testRoot "dist\http.js") -Value @'
const http = require("node:http");
const port = Number(process.env.BRIDGE_WATCHDOG_TEST_PORT);
http.createServer((_req, res) => {
  res.statusCode = 503;
  res.end("not ready");
}).listen(port, "127.0.0.1");
'@ -Encoding UTF8

  $requestPath = Join-Path $testRoot ".bridge-restart-request"
  $ackPath = Join-Path $testRoot ".bridge-restart-ack"
  $requestJson = '{"id":"dry-run-preserve-request","mode":"http","reason":"watchdog regression fixture"}'
  Set-Content -LiteralPath $requestPath -Value $requestJson -Encoding UTF8

  [Environment]::SetEnvironmentVariable("BRIDGE_WATCHDOG_TEST_PORT", [string]$testPort, "Process")
  $probeProcess = Start-Process -FilePath $nodePath -ArgumentList ('"{0}"' -f (Join-Path $testRoot "dist\http.js")) -WorkingDirectory $testRoot -PassThru
  $listenerDeadline = (Get-Date).AddSeconds(10)
  $listenerReady = $false
  while ((Get-Date) -lt $listenerDeadline) {
    $listenerReady = [bool](Get-NetTCPConnection -LocalPort $testPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($listenerReady) { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $listenerReady) { throw "Probe server did not listen on port $testPort" }

  & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $watchdogPath `
    -ProjectRoot $testRoot `
    -Profile "bridge-watchdog-dry-run-regression" `
    -BridgeHost "127.0.0.1" `
    -BridgePort $testPort `
    -TunnelProfileDir $tempBase `
    -NoTunnel -Once -DryRun -AllowDuplicate `
    -RestartRequestFile ".bridge-restart-request" `
    -RestartAckFile ".bridge-restart-ack"
  if ($LASTEXITCODE -ne 0) { throw "Watchdog dry-run exited with code $LASTEXITCODE" }

  $probeProcess.Refresh()
  if ($probeProcess.HasExited) { throw "Dry run stopped the externally started probe process" }
  if (-not (Test-Path -LiteralPath $requestPath)) { throw "Dry run consumed the restart request" }
  if ((Get-Content -LiteralPath $requestPath -Raw).Trim() -ne $requestJson) { throw "Dry run changed the restart request" }
  if (Test-Path -LiteralPath $ackPath) { throw "Dry run wrote a restart acknowledgement" }

  Write-Output (@{ ok = $true; bridgePort = $testPort; externalProcessPreserved = $true; restartRequestPreserved = $true; restartAckWritten = $false } | ConvertTo-Json -Compress)
}
finally {
  if ($probeProcess) {
    try {
      $probeProcess.Refresh()
      if (-not $probeProcess.HasExited) {
        $probeProcess.Kill()
        $probeProcess.WaitForExit(5000) | Out-Null
      }
    }
    catch {}
  }
  [Environment]::SetEnvironmentVariable("BRIDGE_WATCHDOG_TEST_PORT", $previousPortEnv, "Process")
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $testRoot).Path)
    if (-not $resolvedTestRoot.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected test root: $resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
