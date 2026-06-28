param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$McpPath = "/mcp"
)

$ErrorActionPreference = "Stop"

function Invoke-Check {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  Write-Host "[bridge-http-test] $Name"
  & $Check
}

Invoke-Check "healthz" {
  $health = Invoke-RestMethod "$BaseUrl/healthz"
  if ($health -ne "live") { throw "Expected healthz=live, got: $health" }
  Write-Host "  OK live"
}

Invoke-Check "readyz" {
  $ready = Invoke-RestMethod "$BaseUrl/readyz"
  if ($ready -ne "ready") { throw "Expected readyz=ready, got: $ready" }
  Write-Host "  OK ready"
}

Invoke-Check "status" {
  $status = Invoke-RestMethod "$BaseUrl/status"
  if ($status.server.name -ne "bridge-mcp") { throw "Unexpected server name: $($status.server.name)" }
  if ($status.transport -ne "streamable-http") { throw "Unexpected transport: $($status.transport)" }
  Write-Host "  OK $($status.server.name) $($status.server.version) pid=$($status.pid) uptime=$($status.uptimeSeconds)s"
}

Invoke-Check "mcp initialize" {
  $body = @{
    jsonrpc = "2.0"
    id = 1
    method = "initialize"
    params = @{
      protocolVersion = "2024-11-05"
      capabilities = @{}
      clientInfo = @{ name = "bridge-http-test"; version = "0.1.0" }
    }
  } | ConvertTo-Json -Depth 10 -Compress

  $response = Invoke-WebRequest `
    -Uri "$BaseUrl$McpPath" `
    -Method POST `
    -ContentType "application/json" `
    -Headers @{ Accept = "application/json, text/event-stream" } `
    -Body $body

  $content = $response.Content
  if ($content -notmatch '"serverInfo"' -or $content -notmatch '"bridge-mcp"') {
    throw "Initialize response did not include expected serverInfo: $content"
  }

  Write-Host "  OK initialize"
}

Write-Host "[bridge-http-test] all checks passed"
