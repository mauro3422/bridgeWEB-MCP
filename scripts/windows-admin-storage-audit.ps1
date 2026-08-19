param(
  [Parameter(Mandatory = $true)]
  [string]$ResultPath
)

$ErrorActionPreference = 'Stop'

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  $lines = @()
  $exitCode = $null
  try {
    $lines = @(& $FilePath @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{
      ok = ($exitCode -eq 0)
      exitCode = $exitCode
      lines = $lines
      error = $null
    }
  }
  catch {
    return [pscustomobject]@{
      ok = $false
      exitCode = $exitCode
      lines = $lines
      error = $_.Exception.Message
    }
  }
}

function Get-DirectorySummary {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{ exists = $false; files = 0; bytes = 0; errors = @() }
  }

  $files = 0L
  $bytes = 0L
  $errors = @()
  try {
    Get-ChildItem -LiteralPath $Path -File -Force -Recurse -ErrorAction SilentlyContinue -ErrorVariable +scanErrors | ForEach-Object {
      $files++
      $bytes += [int64]$_.Length
    }
    foreach ($scanError in @($scanErrors)) {
      $errors += $scanError.Exception.Message
    }
  }
  catch {
    $errors += $_.Exception.Message
  }

  return [pscustomobject]@{
    exists = $true
    files = $files
    bytes = $bytes
    errors = @($errors | Select-Object -Unique | Select-Object -First 20)
  }
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())
$isElevated = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isElevated) { throw 'Administrative elevation is required for this read-only audit helper.' }

$resultDir = Split-Path -Parent $ResultPath
if ($resultDir) { New-Item -ItemType Directory -Force -Path $resultDir | Out-Null }

$drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object -First 1
$pagefiles = @(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    name = $_.Name
    allocatedBytes = [int64]$_.AllocatedBaseSize * 1MB
    currentUsageBytes = [int64]$_.CurrentUsage * 1MB
    peakUsageBytes = [int64]$_.PeakUsage * 1MB
  }
})

$shadowStorage = Invoke-CapturedCommand -FilePath 'vssadmin.exe' -Arguments @('list', 'shadowstorage')
$shadows = Invoke-CapturedCommand -FilePath 'vssadmin.exe' -Arguments @('list', 'shadows')
$reservedStorage = Invoke-CapturedCommand -FilePath 'dism.exe' -Arguments @('/Online', '/Get-ReservedStorageState', '/English')
$storageReserve = Invoke-CapturedCommand -FilePath 'fsutil.exe' -Arguments @('storagereserve', 'query', 'C:')
$recovery = Invoke-CapturedCommand -FilePath 'reagentc.exe' -Arguments @('/info')

$result = [ordered]@{
  schemaVersion = 1
  elevatedIdentity = $identity
  startedElevated = $isElevated
  completedAt = (Get-Date).ToString('o')
  drive = if ($drive) {
    [pscustomobject]@{
      name = $drive.DeviceID
      sizeBytes = [int64]$drive.Size
      freeBytes = [int64]$drive.FreeSpace
      usedBytes = [int64]($drive.Size - $drive.FreeSpace)
    }
  } else { $null }
  pagefiles = $pagefiles
  systemVolumeInformation = Get-DirectorySummary -Path 'C:\System Volume Information'
  recoveryDirectory = Get-DirectorySummary -Path 'C:\Recovery'
  shadowStorage = $shadowStorage
  shadows = $shadows
  reservedStorage = $reservedStorage
  storageReserve = $storageReserve
  recovery = $recovery
}

$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
exit 0
