param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$ExpectedTunnelAdminBaseUrl = "http://127.0.0.1:8081"
)

$ErrorActionPreference = "Stop"

function Invoke-Check {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  Write-Host "[bridge-regression-test] $Name"
  & $Check
}

Set-Location -LiteralPath $ProjectRoot

Invoke-Check "version bump is consistent" {
  $packageJson = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
  $configText = Get-Content -LiteralPath "src\config.ts" -Raw
  if ($packageJson.version -ne "0.4.1") { throw "package.json version is $($packageJson.version), expected 0.4.1" }
  if ($configText -notmatch 'SERVER_VERSION = "0\.4\.1"') { throw "src/config.ts does not report SERVER_VERSION 0.4.1" }
  Write-Host "  OK 0.4.1"
}

Invoke-Check "tunnel admin default stays on HTTP profile port" {
  $configText = Get-Content -LiteralPath "src\config.ts" -Raw
  $expectedLine = 'DEFAULT_TUNNEL_ADMIN_BASE_URL = "' + $ExpectedTunnelAdminBaseUrl + '"'
  if (-not $configText.Contains($expectedLine)) {
    throw "DEFAULT_TUNNEL_ADMIN_BASE_URL is not $ExpectedTunnelAdminBaseUrl"
  }
  Write-Host "  OK $ExpectedTunnelAdminBaseUrl"
}

Invoke-Check "restart ack JSON accepts UTF-8 BOM" {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-regression-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $ackPath = Join-Path $tmp ".bridge-restart-ack"
    $ackJson = '{"id":"bom-test","action":"restart-http","acknowledgedAt":"2026-06-28T00:00:00.000Z","watchdogPid":1}'
    [System.IO.File]::WriteAllText($ackPath, $ackJson, [System.Text.UTF8Encoding]::new($true))

    $nodeScript = @'
import { pathToFileURL } from "node:url";
const bridgeModuleUrl = pathToFileURL(process.argv[3]).href;
const { bridgeRestartStatus } = await import(bridgeModuleUrl);
const status = await bridgeRestartStatus(process.argv[2]);
if (!status.lastAck || status.lastAck.parseError) {
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}
if (status.lastAck.id !== "bom-test" || status.lastAck.action !== "restart-http") {
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}
'@
    $scriptPath = Join-Path $tmp "check-bom.mjs"
    $bridgeModulePath = (Resolve-Path -LiteralPath ".\dist\bridge-server.js").Path
    Set-Content -LiteralPath $scriptPath -Value $nodeScript -Encoding utf8
    node $scriptPath $tmp $bridgeModulePath
    if ($LASTEXITCODE -ne 0) { throw "BOM restart ack parsing failed" }
    Write-Host "  OK BOM-safe ack parsing"
  }
  finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "[bridge-regression-test] all checks passed"

