param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [int]$MaxEntries = 250000,
  [string]$RootsFile = ''
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [System.IO.Path]::GetFullPath($Root)
$rootInfo = New-Object System.IO.DirectoryInfo($resolvedRoot)
if (-not $rootInfo.Exists) {
  throw "Directory does not exist: $resolvedRoot"
}

$stack = New-Object 'System.Collections.Generic.Stack[System.IO.DirectoryInfo]'
if ($RootsFile) {
  foreach ($relativeRoot in [System.IO.File]::ReadAllLines([System.IO.Path]::GetFullPath($RootsFile))) {
    if ([string]::IsNullOrWhiteSpace($relativeRoot)) { continue }
    $candidate = New-Object System.IO.DirectoryInfo((Join-Path $resolvedRoot $relativeRoot))
    if ($candidate.Exists) { $stack.Push($candidate) }
  }
} else {
  $stack.Push($rootInfo)
}
$count = 0
$scannedDirectories = 0
$skippedLinks = 0
$readErrors = 0
$complete = $true
$unixEpochTicks = 621355968000000000

while ($stack.Count -gt 0) {
  if ($count -ge $MaxEntries) {
    $complete = $false
    break
  }

  $current = $stack.Pop()
  $scannedDirectories++
  try {
    $entries = $current.EnumerateFileSystemInfos()
    foreach ($entry in $entries) {
      if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        $skippedLinks++
        continue
      }
      if (($entry.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
        $stack.Push([System.IO.DirectoryInfo]$entry)
        continue
      }
      if ($count -ge $MaxEntries) {
        $complete = $false
        break
      }
      $file = [System.IO.FileInfo]$entry
      $relative = $file.FullName.Substring($resolvedRoot.Length).TrimStart('\').Replace('\','/')
      $mtimeMs = [math]::Floor(($file.LastWriteTimeUtc.Ticks - $unixEpochTicks) / 10000)
      [Console]::Out.WriteLine("F`t{0}`t{1}`t{2}", $file.Length, $mtimeMs, $relative)
      $count++
    }
  } catch {
    $readErrors++
  }
}

[Console]::Error.WriteLine("SUMMARY`t{0}`t{1}`t{2}`t{3}`t{4}", $count, $scannedDirectories, $skippedLinks, $readErrors, $(if ($complete) { 1 } else { 0 }))
