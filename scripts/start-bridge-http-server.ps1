param(
  [string]$ProjectRoot = ".",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 3001,
  [string]$McpPath = "/mcp",
  [switch]$Build,
  [switch]$AllowRemote,
  [switch]$SkipPortCheck
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

if (-not $SkipPortCheck) {
  $existing = Get-NetTCPConnection -LocalAddress $HostName -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($existing) {
    $owners = $existing | Select-Object -ExpandProperty OwningProcess -Unique
    $details = foreach ($owner in $owners) {
      Get-Process -Id $owner -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path
    }

    Write-BridgeLog "Port is already in use: $HostName`:$Port"
    $details | Format-Table -AutoSize
    throw "Refusing to start bridge HTTP server because port $HostName`:$Port is already in use."
  }
}

$env:BRIDGE_MCP_HTTP_HOST = $HostName
$env:BRIDGE_MCP_HTTP_PORT = [string]$Port
$env:BRIDGE_MCP_HTTP_PATH = $McpPath
if ($AllowRemote) {
  $env:BRIDGE_MCP_HTTP_ALLOW_REMOTE = "true"
}
else {
  Remove-Item Env:\BRIDGE_MCP_HTTP_ALLOW_REMOTE -ErrorAction SilentlyContinue
}

Write-BridgeLog "ProjectRoot=$resolvedRoot"
Write-BridgeLog "Starting bridge-mcp HTTP server on http://$HostName`:$Port$McpPath"
Write-BridgeLog "Health: http://$HostName`:$Port/healthz"
Write-BridgeLog "Ready:  http://$HostName`:$Port/readyz"
Write-BridgeLog "Status: http://$HostName`:$Port/status"

node .\dist\http.js
