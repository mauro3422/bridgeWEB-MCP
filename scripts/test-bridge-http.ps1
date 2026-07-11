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

function New-InitializeBody {
  param([string]$ClientName = "bridge-http-test")

  return @{
    jsonrpc = "2.0"
    id = 1
    method = "initialize"
    params = @{
      protocolVersion = "2024-11-05"
      capabilities = @{}
      clientInfo = @{ name = $ClientName; version = "0.1.0" }
    }
  } | ConvertTo-Json -Depth 10 -Compress
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
  Write-Host "  OK $($status.server.name) $($status.server.version) pid=$($status.pid) uptime=$($status.uptimeSeconds)s sessions=$($status.sessions) active=$($status.activeSessions)"
}

Invoke-Check "mcp session lifecycle" {
  $baselineSessions = [int](Invoke-RestMethod "$BaseUrl/status").sessions
  $sessionId = $null
  try {
    $initializeResponse = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "$BaseUrl$McpPath" `
      -Method POST `
      -ContentType "application/json" `
      -Headers @{ Accept = "application/json, text/event-stream" } `
      -Body (New-InitializeBody -ClientName "bridge-http-session-test")

    $content = $initializeResponse.Content
    if ($content -notmatch '"serverInfo"' -or $content -notmatch '"bridge-mcp"') {
      throw "Initialize response did not include expected serverInfo: $content"
    }

    $sessionId = $initializeResponse.Headers["Mcp-Session-Id"]
    if (-not $sessionId) { throw "Initialize response did not include Mcp-Session-Id" }

    $initializedBody = @{
      jsonrpc = "2.0"
      method = "notifications/initialized"
      params = @{}
    } | ConvertTo-Json -Depth 10 -Compress

    $notifyResponse = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "$BaseUrl$McpPath" `
      -Method POST `
      -ContentType "application/json" `
      -Headers @{ Accept = "application/json, text/event-stream"; "Mcp-Session-Id" = $sessionId } `
      -Body $initializedBody

    if ([int]$notifyResponse.StatusCode -ne 202) {
      throw "Expected initialized notification status 202, got: $([int]$notifyResponse.StatusCode)"
    }
  }
  finally {
    if ($sessionId) {
      $closeResponse = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "$BaseUrl$McpPath" `
        -Method DELETE `
        -Headers @{ Accept = "application/json, text/event-stream"; "Mcp-Session-Id" = $sessionId }
      if (@(200, 202, 204) -notcontains [int]$closeResponse.StatusCode) {
        throw "Expected session close status 200/202/204, got: $([int]$closeResponse.StatusCode)"
      }
    }
  }

  $afterSessions = -1
  foreach ($attempt in 1..20) {
    $afterSessions = [int](Invoke-RestMethod "$BaseUrl/status").sessions
    if ($afterSessions -le $baselineSessions) { break }
    Start-Sleep -Milliseconds 100
  }
  if ($afterSessions -gt $baselineSessions) {
    throw "MCP session was not released: before=$baselineSessions after=$afterSessions session=$sessionId"
  }

  Write-Host "  OK initialize/initialized/delete session=$sessionId before=$baselineSessions after=$afterSessions"
}

Write-Host "[bridge-http-test] all checks passed"
