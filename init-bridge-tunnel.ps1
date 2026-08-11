param(
  [Parameter(Mandatory=$true)]
  [string]$TunnelId
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$TunnelClient = Join-Path $Root "tools\tunnel-client\tunnel-client.exe"
$ProfileDir = Join-Path $env:APPDATA "tunnel-client"
$McpEntry = (Join-Path $Root "dist\index.js").Replace("\", "/")
$McpCommand = "node `"$McpEntry`""

if (-not (Test-Path $TunnelClient)) {
  throw "tunnel-client.exe not found at $TunnelClient"
}
if (-not (Test-Path (Join-Path $Root "dist\index.js"))) {
  throw "bridge-mcp build not found. Run: npm run build"
}

if (-not $env:CONTROL_PLANE_API_KEY) {
  $env:CONTROL_PLANE_API_KEY = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "User")
}
if (-not $env:CONTROL_PLANE_API_KEY) {
  throw "CONTROL_PLANE_API_KEY is not configured for this user."
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
Set-Location $Root

Write-Host "Using tunnel-client: $TunnelClient"
Write-Host "Using tunnel id: $TunnelId"
Write-Host "Using MCP command: $McpCommand"
& $TunnelClient init `
  --sample sample_mcp_stdio_local `
  --profile bridge-local `
  --profile-dir $ProfileDir `
  --tunnel-id $TunnelId `
  --mcp-command $McpCommand

& $TunnelClient doctor --profile-dir $ProfileDir --profile bridge-local --explain

Write-Host ""
Write-Host "Ready. To start the tunnel, run:"
Write-Host "& '$TunnelClient' run --profile bridge-local --profile-dir '$ProfileDir'"
