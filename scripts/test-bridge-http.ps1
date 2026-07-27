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

Invoke-Check "MSSR dashboard" {
  $dashboard = Invoke-WebRequest -UseBasicParsing "$BaseUrl/dashboard"
  if ($dashboard.Content -notmatch 'id="mssr-structured"' -or $dashboard.Content -notmatch 'id="mssr-continuity"' -or $dashboard.Content -notmatch 'id="mssr-skill-outcomes"' -or $dashboard.Content -notmatch 'id="mssr-selected-skills"' -or $dashboard.Content -notmatch 'id="mssr-loaded-skills"' -or $dashboard.Content -notmatch 'id="agent-profiles"' -or $dashboard.Content -notmatch 'id="mssr-agent-activation"' -or $dashboard.Content -notmatch 'id="mssr-agent-results"' -or $dashboard.Content -notmatch 'Cobertura MSSR' -or $dashboard.Content -notmatch 'Conexiones MCP' -or $dashboard.Content -notmatch 'modelo no expuesto' -or $dashboard.Content -notmatch 'pendiente' -or $dashboard.Content -notmatch 'Herramientas MCP' -or $dashboard.Content -notmatch 'cargarla no demuestra') {
    throw "Dashboard does not expose MSSR and per-agent profile sections"
  }
  $mssr = Invoke-RestMethod "$BaseUrl/api/mssr/summary?days=30&scope=active"
  $all = Invoke-RestMethod "$BaseUrl/api/mssr/summary?days=30&scope=all"
  if ($null -eq $mssr.benchmark -or $null -eq $mssr.top.skillOutcomes) {
    throw "MSSR summary endpoint is missing benchmark or per-skill outcomes"
  }
  if ($mssr.scope -ne "active" -or $mssr.observability.contractVersion -ne "trace-contract-v1") {
    throw "MSSR active scope or trace contract is invalid"
  }
  if ([int]$all.eventCount -lt [int]$mssr.eventCount) { throw "All-history scope cannot contain fewer events than active scope" }
  Write-Host "  OK epoch=$($mssr.observability.activeEpoch) routes=$($mssr.benchmark.routeEvents) outcomes=$($mssr.benchmark.attributedOutcomeTraces) allEvents=$($all.eventCount)"
}
Invoke-Check "Tools portfolio dashboard" {
  $dashboard = Invoke-WebRequest -UseBasicParsing "$BaseUrl/dashboard"
  if ($dashboard.Content -notmatch 'id="panel-tools"' -or $dashboard.Content -notmatch 'id="tools-portfolio-body"' -or $dashboard.Content -notmatch '/api/tools/audit' -or $dashboard.Content -notmatch 'Tool Portfolio') {
    throw "Dashboard does not expose the tools portfolio contract"
  }

  $audit = Invoke-RestMethod "$BaseUrl/api/tools/audit?view=all&limit=200&days=30&scope=active"
  if ([int]$audit.summary.registeredTools -ne 125 -or [int]$audit.items.Count -ne 125) {
    throw "Tools audit endpoint did not return the full 125-tool registry"
  }
  if ($null -eq $audit.items[0].metadata.family -or $null -eq $audit.items[0].status -or $null -eq $audit.items[0].evidence.calls) {
    throw "Tools audit endpoint is missing metadata, recommendation status, or evidence"
  }
  if ($audit.privacy.rawArgumentsStored -ne $false -or $audit.privacy.rawPromptsStored -ne $false) {
    throw "Tools audit endpoint violated the privacy contract"
  }

  $invalidStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing "$BaseUrl/api/tools/audit?view=invalid" -ErrorAction Stop | Out-Null
  } catch {
    $invalidStatus = [int]$_.Exception.Response.StatusCode
  }
  if ($invalidStatus -ne 400) { throw "Invalid tools audit view must return HTTP 400, got $invalidStatus" }
  if ($dashboard.Content -notmatch 'id="tools-notices"' -or $dashboard.Content -notmatch '/api/notices') {
    throw "Dashboard does not expose actionable notice reminders"
  }
  $notices = Invoke-RestMethod "$BaseUrl/api/notices?limit=20"
  if ($notices.delivery -ne "recent-history" -or $notices.privacy.rawArgumentsStored -ne $false -or $notices.privacy.rawPromptsStored -ne $false) {
    throw "Notice history endpoint violated its delivery or privacy contract"
  }

  Write-Host "  OK registered=$($audit.summary.registeredTools) observed=$($audit.summary.observedTools) noEvidence=$($audit.summary.toolsWithoutEvidence)"
}

Invoke-Check "active Bridge metrics" {
  $activeMetrics = Invoke-RestMethod "$BaseUrl/api/metrics/overview?scope=active"
  $allMetrics = Invoke-RestMethod "$BaseUrl/api/metrics/overview?scope=all"
  $activeMssr = Invoke-RestMethod "$BaseUrl/api/mssr/summary?days=30&scope=active"
  if ($activeMetrics.scope -ne "active" -or $allMetrics.scope -ne "all") { throw "Bridge metrics scope contract is invalid" }
  if ([int]$allMetrics.totals.calls -lt [int]$activeMetrics.totals.calls) { throw "All-history Bridge metrics cannot contain fewer calls than active scope" }
  if ($null -eq $activeMetrics.agentProfiles -or $null -eq $activeMetrics.surfaces) { throw "Bridge metrics are missing surface/profile attribution" }
  if ($activeMetrics.observability.activeEpoch -ne $activeMssr.observability.activeEpoch) { throw "Bridge and MSSR metrics must share one active epoch" }
  Write-Host "  OK activeCalls=$($activeMetrics.totals.calls) allCalls=$($allMetrics.totals.calls) profiles=$($activeMetrics.agentProfiles.Count)"
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
