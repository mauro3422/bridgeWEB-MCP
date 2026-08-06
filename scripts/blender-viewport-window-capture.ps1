param(
  [Parameter(Mandatory = $true)]
  [int]$TargetProcessId,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [int]$ViewportX,

  [Parameter(Mandatory = $true)]
  [int]$ViewportY,

  [Parameter(Mandatory = $true)]
  [int]$ViewportWidth,

  [Parameter(Mandatory = $true)]
  [int]$ViewportHeight,

  [int]$SettleMs = 650,

  [int]$MaxSize = 1200
)

$ErrorActionPreference = 'Stop'

if ([System.IO.Path]::GetExtension($OutputPath).ToLowerInvariant() -ne '.png') {
  throw "OutputPath must use the .png extension: $OutputPath"
}
if ($ViewportX -lt 0 -or $ViewportY -lt 0 -or $ViewportWidth -lt 64 -or $ViewportHeight -lt 64) {
  throw "Invalid Blender viewport bounds: x=$ViewportX y=$ViewportY width=$ViewportWidth height=$ViewportHeight"
}
if ($SettleMs -lt 100 -or $SettleMs -gt 5000) {
  throw "SettleMs must be between 100 and 5000."
}
if ($MaxSize -lt 200 -or $MaxSize -gt 4096) {
  throw "MaxSize must be between 200 and 4096."
}

$target = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($target.ProcessName -ne 'blender' -or $target.MainWindowHandle -eq 0) {
  throw "PID $TargetProcessId is not a visible Blender window. Process=$($target.ProcessName) Title=$($target.MainWindowTitle)"
}

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BridgeBlenderViewportCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
}
"@

$handle = [IntPtr]$target.MainWindowHandle
[void][BridgeBlenderViewportCapture]::ShowWindow($handle, 9)
[void][BridgeBlenderViewportCapture]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds ([Math]::Min($SettleMs, 300))

if ([BridgeBlenderViewportCapture]::GetForegroundWindow() -ne $handle) {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($target.Id)
  Start-Sleep -Milliseconds ([Math]::Min($SettleMs, 300))
}

if ([BridgeBlenderViewportCapture]::GetForegroundWindow() -ne $handle) {
  $foregroundHandle = [BridgeBlenderViewportCapture]::GetForegroundWindow()
  $currentThread = [BridgeBlenderViewportCapture]::GetCurrentThreadId()
  $targetProcessIdResult = [uint32]0
  $targetThread = [BridgeBlenderViewportCapture]::GetWindowThreadProcessId($handle, [ref]$targetProcessIdResult)
  $foregroundProcessId = [uint32]0
  $foregroundThread = if ($foregroundHandle -ne [IntPtr]::Zero) {
    [BridgeBlenderViewportCapture]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
  } else { [uint32]0 }
  $attachedTarget = $false
  $attachedForeground = $false
  try {
    if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
      $attachedTarget = [BridgeBlenderViewportCapture]::AttachThreadInput($currentThread, $targetThread, $true)
    }
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread -and $foregroundThread -ne $targetThread) {
      $attachedForeground = [BridgeBlenderViewportCapture]::AttachThreadInput($currentThread, $foregroundThread, $true)
    }
    $flags = [uint32](0x0002 -bor 0x0001 -bor 0x0040)
    [void][BridgeBlenderViewportCapture]::BringWindowToTop($handle)
    [void][BridgeBlenderViewportCapture]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, $flags)
    [void][BridgeBlenderViewportCapture]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, $flags)
    [void][BridgeBlenderViewportCapture]::SetForegroundWindow($handle)
  } finally {
    if ($attachedForeground) { [void][BridgeBlenderViewportCapture]::AttachThreadInput($currentThread, $foregroundThread, $false) }
    if ($attachedTarget) { [void][BridgeBlenderViewportCapture]::AttachThreadInput($currentThread, $targetThread, $false) }
  }
}

Start-Sleep -Milliseconds $SettleMs
if ([BridgeBlenderViewportCapture]::GetForegroundWindow() -ne $handle) {
  throw "Could not focus the exact Blender window. PID=$TargetProcessId TITLE=$($target.MainWindowTitle)"
}

$clientRect = New-Object BridgeBlenderViewportCapture+RECT
if (-not [BridgeBlenderViewportCapture]::GetClientRect($handle, [ref]$clientRect)) {
  throw "Could not read Blender client bounds. PID=$TargetProcessId"
}
$clientWidth = $clientRect.Right - $clientRect.Left
$clientHeight = $clientRect.Bottom - $clientRect.Top
if ($ViewportX + $ViewportWidth -gt $clientWidth -or $ViewportY + $ViewportHeight -gt $clientHeight) {
  throw "Viewport bounds exceed Blender client area. Viewport=$ViewportX,$ViewportY ${ViewportWidth}x${ViewportHeight}; client=${clientWidth}x${clientHeight}"
}

$clientOrigin = New-Object BridgeBlenderViewportCapture+POINT
$clientOrigin.X = 0
$clientOrigin.Y = 0
if (-not [BridgeBlenderViewportCapture]::ClientToScreen($handle, [ref]$clientOrigin)) {
  throw "Could not convert Blender client coordinates to screen coordinates."
}

$sourceX = $clientOrigin.X + $ViewportX
$sourceY = $clientOrigin.Y + ($clientHeight - ($ViewportY + $ViewportHeight))
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolvedOutput)) | Out-Null

$bitmap = New-Object System.Drawing.Bitmap($ViewportWidth, $ViewportHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$outputWidth = $ViewportWidth
$outputHeight = $ViewportHeight
$resized = $null
$resizedGraphics = $null
try {
  $sourcePoint = New-Object System.Drawing.Point($sourceX, $sourceY)
  $destinationPoint = New-Object System.Drawing.Point(0, 0)
  $captureSize = New-Object System.Drawing.Size($ViewportWidth, $ViewportHeight)
  $graphics.CopyFromScreen($sourcePoint, $destinationPoint, $captureSize, [System.Drawing.CopyPixelOperation]::SourceCopy)

  if ([Math]::Max($ViewportWidth, $ViewportHeight) -gt $MaxSize) {
    $scale = $MaxSize / [double][Math]::Max($ViewportWidth, $ViewportHeight)
    $outputWidth = [Math]::Max(1, [int][Math]::Round($ViewportWidth * $scale))
    $outputHeight = [Math]::Max(1, [int][Math]::Round($ViewportHeight * $scale))
    $resized = New-Object System.Drawing.Bitmap($outputWidth, $outputHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $resizedGraphics = [System.Drawing.Graphics]::FromImage($resized)
    $resizedGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizedGraphics.DrawImage($bitmap, 0, 0, $outputWidth, $outputHeight)
    $resized.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  }
} finally {
  if ($resizedGraphics) { $resizedGraphics.Dispose() }
  if ($resized) { $resized.Dispose() }
  $graphics.Dispose()
  $bitmap.Dispose()
}

$file = Get-Item -LiteralPath $resolvedOutput
[pscustomobject]@{
  ok = $true
  outputPath = $resolvedOutput
  pid = $target.Id
  windowTitle = $target.MainWindowTitle
  foregroundConfirmed = $true
  captureMethod = 'CopyFromScreen(exact-Blender-client-viewport)'
  settleMs = $SettleMs
  maxSize = $MaxSize
  client = [pscustomobject]@{ width = $clientWidth; height = $clientHeight; screenX = $clientOrigin.X; screenY = $clientOrigin.Y }
  viewport = [pscustomobject]@{ x = $ViewportX; y = $ViewportY; width = $ViewportWidth; height = $ViewportHeight; screenX = $sourceX; screenY = $sourceY }
  image = [pscustomobject]@{ width = $outputWidth; height = $outputHeight; sourceWidth = $ViewportWidth; sourceHeight = $ViewportHeight; bytes = $file.Length; mtime = $file.LastWriteTimeUtc.ToString('o') }
} | ConvertTo-Json -Depth 5 -Compress
