param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('amd-dxc-cache', 'windows-update-download', 'edgecore-stale')]
  [string]$Profile,

  [Parameter(Mandatory = $true)]
  [string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
if ([string]::IsNullOrWhiteSpace($programFilesX86)) { $programFilesX86 = 'C:\Program Files (x86)' }

function Get-ProfilePath {
  param([string]$Name)
  switch ($Name) {
    'amd-dxc-cache' { return [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AMD\DxcCache')) }
    'windows-update-download' { return [System.IO.Path]::GetFullPath((Join-Path $env:WINDIR 'SoftwareDistribution\Download')) }
    'edgecore-stale' { return [System.IO.Path]::GetFullPath((Join-Path $programFilesX86 'Microsoft\EdgeCore')) }
    default { throw "Unsupported cache profile: $Name" }
  }
}

function Get-TreeSummary {
  param([string]$Target)
  if (-not (Test-Path -LiteralPath $Target)) {
    return [pscustomobject]@{ exists = $false; files = 0; bytes = 0 }
  }
  [int64]$bytes = 0
  [int64]$fileCount = 0
  Get-ChildItem -LiteralPath $Target -File -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $fileCount++
    $bytes += [int64]$_.Length
  }
  return [pscustomobject]@{ exists = $true; files = $fileCount; bytes = $bytes }
}

function Assert-ApprovedTarget {
  param([string]$Name, [string]$Target)
  $approved = switch ($Name) {
    'amd-dxc-cache' { [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AMD\DxcCache')) }
    'windows-update-download' { [System.IO.Path]::GetFullPath((Join-Path $env:WINDIR 'SoftwareDistribution\Download')) }
    'edgecore-stale' { [System.IO.Path]::GetFullPath((Join-Path $programFilesX86 'Microsoft\EdgeCore')) }
  }
  if (-not $Target.Equals($approved, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved target escaped approved profile boundary.'
  }
}

function Get-EdgeInstalledVersion {
  $edgeExe = Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path -LiteralPath $edgeExe)) { throw "Microsoft Edge executable not found: $edgeExe" }
  $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($edgeExe).ProductVersion
  if (-not $version) { throw 'Could not resolve installed Microsoft Edge version.' }
  return $version
}

$target = Get-ProfilePath -Name $Profile
Assert-ApprovedTarget -Name $Profile -Target $target

$resultDir = Split-Path -Parent $ResultPath
if ($resultDir) { New-Item -ItemType Directory -Force -Path $resultDir | Out-Null }

$before = Get-TreeSummary -Target $target
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())
$isElevated = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
$deleted = @()
$failures = @()
$ownershipOutput = @()
$aclOutput = @()
$serviceState = @()
$protectedVersions = @()

try {
  if (-not $isElevated) { throw 'Administrative elevation is required for this helper.' }

  switch ($Profile) {
    'amd-dxc-cache' {
      if ($before.exists -and $before.files -gt 0) {
        $ownershipOutput = @(& takeown.exe /F (Join-Path $target '*') /A 2>&1 | ForEach-Object { $_.ToString() })
        $aclOutput = @(& icacls.exe (Join-Path $target '*') /grant:r "${identity}:F" /C 2>&1 | ForEach-Object { $_.ToString() })
        Get-ChildItem -LiteralPath $target -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
          try {
            $size = $_.Length
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
            $deleted += [pscustomobject]@{ name = $_.Name; bytes = $size }
          }
          catch {
            $failures += [pscustomobject]@{ name = $_.Name; bytes = $_.Length; error = $_.Exception.Message }
          }
        }
      }
    }

    'windows-update-download' {
      $serviceNames = @('wuauserv', 'bits')
      foreach ($serviceName in $serviceNames) {
        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($service) {
          $wasRunning = $service.Status -eq 'Running'
          $serviceState += [pscustomobject]@{ name = $serviceName; wasRunning = $wasRunning }
          if ($wasRunning) {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
            (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
          }
        }
      }
      try {
        if (Test-Path -LiteralPath $target) {
          Get-ChildItem -LiteralPath $target -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $itemSummary = Get-TreeSummary -Target $_.FullName
            try {
              Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
              $deleted += [pscustomobject]@{ name = $_.Name; bytes = [int64]$itemSummary.bytes }
            }
            catch {
              $failures += [pscustomobject]@{ name = $_.Name; bytes = [int64]$itemSummary.bytes; error = $_.Exception.Message }
            }
          }
        }
      }
      finally {
        foreach ($state in $serviceState) {
          if ($state.wasRunning) {
            try { Start-Service -Name $state.name -ErrorAction Stop } catch {
              $failures += [pscustomobject]@{ name = "service:$($state.name)"; bytes = 0; error = $_.Exception.Message }
            }
          }
        }
      }
    }

    'edgecore-stale' {
      $currentVersion = Get-EdgeInstalledVersion
      $protectedVersions = @($currentVersion)
      if (Test-Path -LiteralPath $target) {
        Get-ChildItem -LiteralPath $target -Directory -Force -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and $_.Name -ne $currentVersion } |
          ForEach-Object {
            $itemSummary = Get-TreeSummary -Target $_.FullName
            try {
              Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
              $deleted += [pscustomobject]@{ name = $_.Name; bytes = [int64]$itemSummary.bytes }
            }
            catch {
              $failures += [pscustomobject]@{ name = $_.Name; bytes = [int64]$itemSummary.bytes; error = $_.Exception.Message }
            }
          }
      }
    }
  }
}
catch {
  $failures += [pscustomobject]@{ name = '<helper>'; bytes = 0; error = $_.Exception.Message }
}

$after = Get-TreeSummary -Target $target
$result = [ordered]@{
  schemaVersion = 2
  profile = $Profile
  target = $target
  elevatedIdentity = $identity
  startedElevated = $isElevated
  before = $before
  after = $after
  freedBytes = [int64]([math]::Max(0, $before.bytes - $after.bytes))
  deletedCount = $deleted.Count
  failureCount = $failures.Count
  deleted = $deleted
  failures = $failures
  serviceState = $serviceState
  protectedVersions = $protectedVersions
  ownershipOutput = $ownershipOutput
  aclOutput = $aclOutput
  completedAt = (Get-Date).ToString('o')
}

$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
if ($failures.Count -gt 0) { exit 2 }
exit 0
