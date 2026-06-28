param(
  [string]$ProjectRoot = ".",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 3001,
  [switch]$Build
)

$ErrorActionPreference = "Stop"

function Write-BridgeLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] [bridge-http] $Message"
}

Set-Location $ProjectRoot
$resolvedRoot = (Get-Location).Path

if ($Build) {
  Write-BridgeLog "Running npm run build..."
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
  }
}

$env:BRIDGE_MCP_HTTP_HOST = $HostName
$env:BRIDGE_MCP_HTTP_PORT = [string]$Port

Write-BridgeLog "ProjectRoot=$resolvedRoot"
Write-BridgeLog "Starting bridge-mcp HTTP server on http://$HostName`:$Port/mcp"
Write-BridgeLog "Health: http://$HostName`:$Port/healthz"
Write-BridgeLog "Ready:  http://$HostName`:$Port/readyz"
Write-BridgeLog "Status: http://$HostName`:$Port/status"

node .\dist\http.js
