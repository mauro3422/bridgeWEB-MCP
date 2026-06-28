param(
  [string]$ProjectRoot = ".",
  [string]$Reason = "smoke-test restart request",
  [string]$Mode = "http"
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot
$resolvedRoot = (Get-Location).Path
$requestPath = Join-Path $resolvedRoot ".bridge-restart-request"
$ackPath = Join-Path $resolvedRoot ".bridge-restart-ack"

Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ackPath -Force -ErrorAction SilentlyContinue

$request = [ordered]@{
  id = [guid]::NewGuid().ToString()
  requestedAt = (Get-Date).ToUniversalTime().ToString("o")
  reason = $Reason
  mode = $Mode
  test = $true
}

$request | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $requestPath -Encoding UTF8

if (-not (Test-Path -LiteralPath $requestPath)) {
  throw "restart request file was not created"
}

Write-Host "[restart-request-test] wrote $requestPath"
Write-Host "[restart-request-test] id=$($request.id) mode=$Mode"
