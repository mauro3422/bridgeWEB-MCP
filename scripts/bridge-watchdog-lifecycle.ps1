function Get-BridgeWatchdogProcessSnapshot {
  [CmdletBinding()]
  param(
    [System.Diagnostics.Process]$Process,
    [string]$Trigger = "unknown",
    [int]$ReadinessFailures = 0
  )

  $observedAtUtc = (Get-Date).ToUniversalTime()
  $processId = $null
  $processStartedAtUtc = $null
  $uptimeSeconds = $null
  $processAlive = $null
  $processExitCode = $null

  if ($Process) {
    try {
      $Process.Refresh()
      $processId = [int]$Process.Id
    }
    catch {}

    try {
      $processStartedAtUtc = $Process.StartTime.ToUniversalTime().ToString("o")
      $startedAt = [DateTimeOffset]::Parse($processStartedAtUtc)
      $uptimeSeconds = [Math]::Round(($observedAtUtc - $startedAt.UtcDateTime).TotalSeconds, 3)
      if ($uptimeSeconds -lt 0) { $uptimeSeconds = 0 }
    }
    catch {}

    try {
      $processAlive = -not $Process.HasExited
      if (-not $processAlive) {
        $processExitCode = [int]$Process.ExitCode
      }
    }
    catch {}
  }

  return [ordered]@{
    observedAtUtc = $observedAtUtc.ToString("o")
    processId = $processId
    processStartedAtUtc = $processStartedAtUtc
    uptimeSecondsAtObservation = $uptimeSeconds
    processAlive = $processAlive
    processExitCode = $processExitCode
    trigger = $Trigger
    readinessFailures = $ReadinessFailures
  }
}

function Write-BridgeWatchdogLifecycleEvent {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("bridge-http", "tunnel-client")]
    [string]$Component,
    [Parameter(Mandatory = $true)]
    [ValidateSet("process-started", "process-adopted", "process-stop", "process-exit-observed", "process-recovery")]
    [string]$EventType,
    [System.Diagnostics.Process]$Process,
    [System.Diagnostics.Process]$ReplacementProcess,
    [int]$Port = 0,
    [string]$Trigger = "unknown",
    [string]$RecoveryAction = "none",
    [string]$RecoveryId = "",
    [int]$ReadinessFailures = 0,
    [string]$StopRequestedAtUtc = "",
    [object]$TerminationConfirmed = $null
  )

  # DryRun is strictly observational, including persistence of diagnostic events.
  if ($DryRun) { return }

  $processSnapshot = Get-BridgeWatchdogProcessSnapshot -Process $Process -Trigger $Trigger -ReadinessFailures $ReadinessFailures
  $replacementSnapshot = Get-BridgeWatchdogProcessSnapshot -Process $ReplacementProcess -Trigger "replacement"
  if ($null -eq $TerminationConfirmed -and $processSnapshot.processAlive -eq $false) {
    $TerminationConfirmed = $true
  }

  $record = [ordered]@{
    schemaVersion = 1
    eventId = [guid]::NewGuid().ToString("N")
    recoveryId = if ($RecoveryId) { $RecoveryId } else { $null }
    eventType = $EventType
    observedAtUtc = $processSnapshot.observedAtUtc
    watchdogPid = [int]$PID
    component = $Component
    port = $Port
    processId = $processSnapshot.processId
    processStartedAtUtc = $processSnapshot.processStartedAtUtc
    uptimeSecondsAtObservation = $processSnapshot.uptimeSecondsAtObservation
    processAlive = $processSnapshot.processAlive
    processExitCode = $processSnapshot.processExitCode
    stopRequestedAtUtc = if ($StopRequestedAtUtc) { $StopRequestedAtUtc } else { $null }
    terminationConfirmed = $TerminationConfirmed
    trigger = $Trigger
    recoveryAction = $RecoveryAction
    readinessFailures = $ReadinessFailures
    replacementProcessId = $replacementSnapshot.processId
    replacementProcessStartedAtUtc = $replacementSnapshot.processStartedAtUtc
  }

  try {
    $logsDirectory = Join-Path $ProjectRoot "logs"
    if (-not (Test-Path -LiteralPath $logsDirectory)) {
      New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
    }

    $logPath = Join-Path $logsDirectory "bridge-watchdog-lifecycle.jsonl"
    $line = ($record | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine
    $encoding = [System.Text.UTF8Encoding]::new($false)
    $lineBytes = $encoding.GetByteCount($line)
    $maxSegmentBytes = 5MB

    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length + $lineBytes -gt $maxSegmentBytes)) {
      $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ")
      $archivePath = Join-Path $logsDirectory "bridge-watchdog-lifecycle.$stamp.$([guid]::NewGuid().ToString('N')).jsonl"
      Move-Item -LiteralPath $logPath -Destination $archivePath
    }

    [System.IO.File]::AppendAllText($logPath, $line, $encoding)
  }
  catch {
    $failureType = $_.Exception.GetType().Name
    if (Get-Command Write-BridgeLog -ErrorAction SilentlyContinue) {
      Write-BridgeLog "Could not persist watchdog lifecycle telemetry; exceptionType=$failureType" "warn"
    }
  }
}
