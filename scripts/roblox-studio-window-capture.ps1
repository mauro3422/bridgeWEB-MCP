param(
  [Parameter(Mandatory = $true)]
  [string]$PlacePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [int]$SettleMs = 650,

  [int]$CropLeft = 0,
  [int]$CropTop = 0,
  [int]$CropRight = 0,
  [int]$CropBottom = 0
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PlacePath -PathType Leaf)) {
  throw "Place file does not exist: $PlacePath"
}

if ([System.IO.Path]::GetExtension($OutputPath).ToLowerInvariant() -ne '.png') {
  throw "OutputPath must use the .png extension: $OutputPath"
}

foreach ($value in @($CropLeft, $CropTop, $CropRight, $CropBottom)) {
  if ($value -lt 0) { throw 'Crop values must be zero or positive.' }
}

$placeName = [System.IO.Path]::GetFileName($PlacePath)
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($PlacePath)
$processes = @(Get-Process -Name 'RobloxStudioBeta' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($processes.Count -eq 0) {
  throw 'No visible Roblox Studio window was found.'
}

$matches = @($processes | Where-Object {
  $_.MainWindowTitle -like "*$placeName*" -or $_.MainWindowTitle -like "*$baseName*"
})

if ($matches.Count -eq 0) {
  $titles = ($processes | ForEach-Object { "PID=$($_.Id) TITLE=$($_.MainWindowTitle)" }) -join '; '
  throw "No Roblox Studio window title matched '$placeName'. Open windows: $titles"
}
if ($matches.Count -gt 1) {
  $titles = ($matches | ForEach-Object { "PID=$($_.Id) TITLE=$($_.MainWindowTitle)" }) -join '; '
  throw "Multiple Roblox Studio windows matched '$placeName': $titles"
}

$target = $matches[0]

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BridgeStudioCaptureWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
}
"@

$handle = [IntPtr]$target.MainWindowHandle
[void][BridgeStudioCaptureWindow]::ShowWindow($handle, 9)
[void][BridgeStudioCaptureWindow]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds $SettleMs

if ([BridgeStudioCaptureWindow]::GetForegroundWindow() -ne $handle) {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($target.Id)
  Start-Sleep -Milliseconds $SettleMs
}

if ([BridgeStudioCaptureWindow]::GetForegroundWindow() -ne $handle) {
  $foregroundHandle = [BridgeStudioCaptureWindow]::GetForegroundWindow()
  $currentThread = [BridgeStudioCaptureWindow]::GetCurrentThreadId()
  $targetProcessId = [uint32]0
  $targetThread = [BridgeStudioCaptureWindow]::GetWindowThreadProcessId($handle, [ref]$targetProcessId)
  $foregroundProcessId = [uint32]0
  $foregroundThread = if ($foregroundHandle -ne [IntPtr]::Zero) {
    [BridgeStudioCaptureWindow]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
  } else {
    [uint32]0
  }
  $attachedTarget = $false
  $attachedForeground = $false
  try {
    if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
      $attachedTarget = [BridgeStudioCaptureWindow]::AttachThreadInput($currentThread, $targetThread, $true)
    }
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread -and $foregroundThread -ne $targetThread) {
      $attachedForeground = [BridgeStudioCaptureWindow]::AttachThreadInput($currentThread, $foregroundThread, $true)
    }
    $HWND_TOPMOST = [IntPtr](-1)
    $HWND_NOTOPMOST = [IntPtr](-2)
    $SWP_NOMOVE = [uint32]0x0002
    $SWP_NOSIZE = [uint32]0x0001
    $SWP_SHOWWINDOW = [uint32]0x0040
    $flags = $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW
    [void][BridgeStudioCaptureWindow]::BringWindowToTop($handle)
    [void][BridgeStudioCaptureWindow]::SetWindowPos($handle, $HWND_TOPMOST, 0, 0, 0, 0, $flags)
    [void][BridgeStudioCaptureWindow]::SetWindowPos($handle, $HWND_NOTOPMOST, 0, 0, 0, 0, $flags)
    [void][BridgeStudioCaptureWindow]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds $SettleMs
  } finally {
    if ($attachedForeground) {
      [void][BridgeStudioCaptureWindow]::AttachThreadInput($currentThread, $foregroundThread, $false)
    }
    if ($attachedTarget) {
      [void][BridgeStudioCaptureWindow]::AttachThreadInput($currentThread, $targetThread, $false)
    }
  }
}

$foregroundConfirmed = ([BridgeStudioCaptureWindow]::GetForegroundWindow() -eq $handle)

$rect = New-Object BridgeStudioCaptureWindow+RECT
if (-not [BridgeStudioCaptureWindow]::GetWindowRect($handle, [ref]$rect)) {
  throw "Could not read Roblox Studio window bounds. PID=$($target.Id)"
}

$sourceWidth = $rect.Right - $rect.Left
$sourceHeight = $rect.Bottom - $rect.Top
$width = $sourceWidth - $CropLeft - $CropRight
$height = $sourceHeight - $CropTop - $CropBottom
if ($width -lt 64 -or $height -lt 64) {
  throw "Crop values leave an invalid capture area: ${width}x${height} from ${sourceWidth}x${sourceHeight}"
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
if ([string]::IsNullOrWhiteSpace($outputDirectory)) {
  throw "OutputPath has no parent directory: $resolvedOutput"
}
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$fullBitmap = New-Object System.Drawing.Bitmap($sourceWidth, $sourceHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
$bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$captureMethod = $null
try {
  if ($foregroundConfirmed) {
    $sourcePoint = New-Object System.Drawing.Point($rect.Left, $rect.Top)
    $destinationPoint = New-Object System.Drawing.Point(0, 0)
    $captureSize = New-Object System.Drawing.Size($sourceWidth, $sourceHeight)
    $fullGraphics.CopyFromScreen($sourcePoint, $destinationPoint, $captureSize, [System.Drawing.CopyPixelOperation]::SourceCopy)
    $captureMethod = 'CopyFromScreen(full-window)-then-crop'
  } else {
    $hdc = [IntPtr]::Zero
    try {
      $hdc = $fullGraphics.GetHdc()
      $PW_RENDERFULLCONTENT = [uint32]2
      if (-not [BridgeStudioCaptureWindow]::PrintWindow($handle, $hdc, $PW_RENDERFULLCONTENT)) {
        throw "PrintWindow failed for the exact Roblox Studio window. PID=$($target.Id) TITLE=$($target.MainWindowTitle)"
      }
      $captureMethod = 'PrintWindow(PW_RENDERFULLCONTENT)-then-crop'
    } finally {
      if ($hdc -ne [IntPtr]::Zero) {
        $fullGraphics.ReleaseHdc($hdc)
      }
    }
  }

  $sourceRect = New-Object System.Drawing.Rectangle($CropLeft, $CropTop, $width, $height)
  $destinationRect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
  $graphics.DrawImage($fullBitmap, $destinationRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
  $fullGraphics.Dispose()
  $fullBitmap.Dispose()
}

$file = Get-Item -LiteralPath $resolvedOutput
[pscustomobject]@{
  ok = $true
  placePath = [System.IO.Path]::GetFullPath($PlacePath)
  outputPath = $resolvedOutput
  pid = $target.Id
  windowTitle = $target.MainWindowTitle
  foregroundConfirmed = $foregroundConfirmed
  captureMethod = $captureMethod
  windowBounds = [pscustomobject]@{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    width = $sourceWidth
    height = $sourceHeight
  }
  crop = [pscustomobject]@{
    left = $CropLeft
    top = $CropTop
    right = $CropRight
    bottom = $CropBottom
  }
  image = [pscustomobject]@{
    width = $width
    height = $height
    bytes = $file.Length
    mtime = $file.LastWriteTimeUtc.ToString('o')
  }
  action = 'Scoped Roblox Studio window capture'
} | ConvertTo-Json -Depth 5 -Compress

