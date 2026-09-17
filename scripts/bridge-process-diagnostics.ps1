function Get-BridgeProcessDiagnostics {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,
    [int]$Port = 0,
    [ValidateRange(0, 2000)]
    [int]$SampleMilliseconds = 250
  )

  $observedAt = (Get-Date).ToUniversalTime().ToString("o")
  $listenerOwnerPid = $null
  if ($Port -gt 0) {
    try {
      $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
      if ($listener) { $listenerOwnerPid = [int]$listener.OwningProcess }
    }
    catch {}
  }

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $process.Refresh()
  }
  catch {
    return [ordered]@{
      observedAt = $observedAt
      processId = $ProcessId
      available = $false
      reason = "process-unavailable"
      port = if ($Port -gt 0) { $Port } else { $null }
      listenerOwnerPid = $listenerOwnerPid
      listenerOwnedByProcess = if ($null -ne $listenerOwnerPid) { $listenerOwnerPid -eq $ProcessId } else { $null }
    }
  }

  $parentProcessId = $null
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if ($cim) { $parentProcessId = [int]$cim.ParentProcessId }
  }
  catch {}

  $startTime = $null
  $uptimeSeconds = $null
  try {
    $start = $process.StartTime.ToUniversalTime()
    $startTime = $start.ToString("o")
    $uptimeSeconds = [math]::Max(0, [math]::Round(((Get-Date).ToUniversalTime() - $start).TotalSeconds, 3))
  }
  catch {}

  $cpuBefore = if ($null -ne $process.CPU) { [double]$process.CPU } else { 0.0 }
  if ($SampleMilliseconds -gt 0) { Start-Sleep -Milliseconds $SampleMilliseconds }

  try {
    $process.Refresh()
    if ($process.HasExited) {
      return [ordered]@{
        observedAt = $observedAt
        processId = $ProcessId
        available = $false
        reason = "process-exited-during-sample"
        name = $process.ProcessName
        parentProcessId = $parentProcessId
        port = if ($Port -gt 0) { $Port } else { $null }
        listenerOwnerPid = $listenerOwnerPid
        listenerOwnedByProcess = if ($null -ne $listenerOwnerPid) { $listenerOwnerPid -eq $ProcessId } else { $null }
        cpuSecondsBefore = [math]::Round($cpuBefore, 6)
        cpuSampleWindowMs = $SampleMilliseconds
      }
    }
  }
  catch {
    return [ordered]@{
      observedAt = $observedAt
      processId = $ProcessId
      available = $false
      reason = "process-unavailable-after-sample"
      parentProcessId = $parentProcessId
      port = if ($Port -gt 0) { $Port } else { $null }
      listenerOwnerPid = $listenerOwnerPid
      listenerOwnedByProcess = if ($null -ne $listenerOwnerPid) { $listenerOwnerPid -eq $ProcessId } else { $null }
      cpuSecondsBefore = [math]::Round($cpuBefore, 6)
      cpuSampleWindowMs = $SampleMilliseconds
    }
  }

  $cpuAfter = if ($null -ne $process.CPU) { [double]$process.CPU } else { $cpuBefore }
  $cpuDelta = [math]::Max(0, $cpuAfter - $cpuBefore)
  $logicalProcessors = [math]::Max(1, [Environment]::ProcessorCount)
  $cpuUtilizationEstimatePercent = if ($SampleMilliseconds -gt 0) {
    [math]::Round(($cpuDelta / ($SampleMilliseconds / 1000.0) / $logicalProcessors) * 100.0, 2)
  }
  else { $null }

  return [ordered]@{
    observedAt = $observedAt
    processId = $ProcessId
    available = $true
    name = $process.ProcessName
    parentProcessId = $parentProcessId
    startTime = $startTime
    uptimeSeconds = $uptimeSeconds
    port = if ($Port -gt 0) { $Port } else { $null }
    listenerOwnerPid = $listenerOwnerPid
    listenerOwnedByProcess = if ($null -ne $listenerOwnerPid) { $listenerOwnerPid -eq $ProcessId } else { $null }
    cpuSeconds = [math]::Round($cpuAfter, 6)
    cpuDeltaSeconds = [math]::Round($cpuDelta, 6)
    cpuSampleWindowMs = $SampleMilliseconds
    cpuUtilizationEstimatePercent = $cpuUtilizationEstimatePercent
    workingSetBytes = [int64]$process.WorkingSet64
    privateMemoryBytes = [int64]$process.PrivateMemorySize64
    threadCount = [int]$process.Threads.Count
    handleCount = [int]$process.HandleCount
  }
}
