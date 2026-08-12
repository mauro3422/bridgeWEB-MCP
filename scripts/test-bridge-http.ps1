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
  if ($status.transport -ne "streamable-http-dual-era") { throw "Unexpected transport: $($status.transport)" }
  if ($status.protocols.legacy.sessionful -ne $true) { throw "Legacy MCP route must remain sessionful" }
  if ($status.protocols.modern.revision -ne "2026-07-28") { throw "Unexpected modern MCP revision: $($status.protocols.modern.revision)" }
  if ($status.protocols.modern.sessionful -ne $false) { throw "Modern MCP route must remain stateless at the session layer" }
  if ([string]$status.runtimeBootId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw "Status runtimeBootId is not a UUID: $($status.runtimeBootId)" }
  Write-Host "  OK $($status.server.name) $($status.server.version) pid=$($status.pid) boot=$($status.runtimeBootId) uptime=$($status.uptimeSeconds)s sessions=$($status.sessions) active=$($status.activeSessions)"
}

Invoke-Check "MSSR dashboard" {
  $dashboard = Invoke-WebRequest -UseBasicParsing "$BaseUrl/dashboard"
  if ($dashboard.Content -notmatch 'id="mssr-structured"' -or $dashboard.Content -notmatch 'id="mssr-continuity"' -or $dashboard.Content -notmatch 'id="mssr-skill-outcomes"' -or $dashboard.Content -notmatch 'id="mssr-selected-skills"' -or $dashboard.Content -notmatch 'id="mssr-loaded-skills"' -or $dashboard.Content -notmatch 'id="agent-profiles"' -or $dashboard.Content -notmatch 'id="mssr-agent-activation"' -or $dashboard.Content -notmatch 'id="mssr-agent-results"' -or $dashboard.Content -notmatch 'id="current-runtime-boot"' -or $dashboard.Content -notmatch 'Cobertura MSSR' -or $dashboard.Content -notmatch 'Conexiones MCP' -or $dashboard.Content -notmatch 'modelo no expuesto' -or $dashboard.Content -notmatch 'pendiente' -or $dashboard.Content -notmatch 'Herramientas MCP' -or $dashboard.Content -notmatch 'cargarla no demuestra') {
    throw "Dashboard does not expose MSSR and per-agent profile sections"
  }
  if (-not $dashboard.Content.Contains("replace(/\s+/g") -or $dashboard.Content.Contains("replace(/s+/g")) {
    throw "Dashboard error compaction regex lost its whitespace escape in the served HTML"
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

Invoke-Check "authenticated external MSSR telemetry" {
  $tokenPath = Join-Path (Get-Location) "data\mssr-ingest.token"
  if (-not (Test-Path -LiteralPath $tokenPath)) { throw "MSSR ingest token was not created at $tokenPath" }
  $eventId = "__test_opencode_" + [Guid]::NewGuid().ToString("N")
  $traceId = "__test_opencode_trace_" + [Guid]::NewGuid().ToString("N")
  $body = @{
    protocolVersion = "mssr-telemetry-v1"
    eventId = $eventId
    emittedAt = [DateTime]::UtcNow.ToString("o")
    source = "opencode-cli"
    traceId = $traceId
    caller = "opencode-local"
    event = @{
      kind = "route"
      action = "plan"
      taskHash = "a" * 64
      route = @{
        caller = "opencode-local"; stage = "start"; classificationMode = "structured-semantic"
        workflowKey = "__test_opencode"; agentProfile = @{ model = "unknown"; reasoningEffort = "unknown" }
        contextUsed = $false; contextCharacters = 0; workflows = @(); activeSkills = @(); deferredSkills = @()
        loadOrder = @(); deferredLoadOrder = @(); signals = @("nominal"); ambiguity = "low"
        requiredPhases = @(); completedPhases = @(); missingRequiredPhases = @()
      }
    }
  } | ConvertTo-Json -Depth 12 -Compress
  $unauthorized = 0
  try { Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/mssr/events" -Method Post -ContentType "application/json" -Body $body | Out-Null }
  catch { $unauthorized = [int]$_.Exception.Response.StatusCode }
  if ($unauthorized -ne 401) { throw "External MSSR ingest without token must return 401, got $unauthorized" }
  $token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
  $accepted = Invoke-RestMethod -Uri "$BaseUrl/api/mssr/events" -Method Post -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -Body $body
  if ($accepted.accepted -ne $true -or $accepted.traceId -ne $traceId -or $accepted.duplicate -ne $false) { throw "External MSSR event was not accepted" }
  $duplicate = Invoke-RestMethod -Uri "$BaseUrl/api/mssr/events" -Method Post -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -Body $body
  if ($duplicate.duplicate -ne $true) { throw "External MSSR ingest is not idempotent" }
  Write-Host "  OK authenticated, bounded and idempotent trace=$traceId"
}
Invoke-Check "Tools portfolio dashboard" {
  $dashboard = Invoke-WebRequest -UseBasicParsing "$BaseUrl/dashboard"
  if ($dashboard.Content -notmatch 'id="panel-tools"' -or $dashboard.Content -notmatch 'id="tools-portfolio-body"' -or $dashboard.Content -notmatch '/api/tools/audit' -or $dashboard.Content -notmatch 'Tool Portfolio') {
    throw "Dashboard does not expose the tools portfolio contract"
  }

  $audit = Invoke-RestMethod "$BaseUrl/api/tools/audit?view=all&limit=200&days=30&scope=active"
  if ([int]$audit.summary.registeredTools -ne 143 -or [int]$audit.items.Count -ne 143) {
    throw "Tools audit endpoint did not return the full 143-tool registry"
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
