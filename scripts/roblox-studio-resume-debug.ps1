param(
  [Parameter(Mandatory = $true)]
  [string]$PlacePath,

  [int]$RelativeX = 216,
  [int]$RelativeY = 70,
  [int]$SettleMs = 900
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PlacePath -PathType Leaf)) {
  throw "Place file does not exist: $PlacePath"
}

$placeName = [System.IO.Path]::GetFileName($PlacePath)
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($PlacePath)
$processes = @(Get-Process -Name 'RobloxStudioBeta' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
$matches = @($processes | Where-Object {
  $_.MainWindowTitle -like "*$placeName*" -or $_.MainWindowTitle -like "*$baseName*"
})
if ($matches.Count -ne 1) {
  $titles = ($processes | ForEach-Object { "PID=$($_.Id) TITLE=$($_.MainWindowTitle)" }) -join '; '
  throw "Expected exactly one Roblox Studio window matching '$placeName'. Matches=$($matches.Count). Open windows: $titles"
}

$target = $matches[0]

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BridgeStudioScopedClick {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$handle = [IntPtr]$target.MainWindowHandle
[void][BridgeStudioScopedClick]::ShowWindow($handle, 3)
[void][BridgeStudioScopedClick]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds $SettleMs

$rect = New-Object BridgeStudioScopedClick+RECT
if (-not [BridgeStudioScopedClick]::GetWindowRect($handle, [ref]$rect)) {
  throw "Could not read Roblox Studio window bounds. PID=$($target.Id)"
}

$windowWidth = $rect.Right - $rect.Left
$windowHeight = $rect.Bottom - $rect.Top
if ($RelativeX -lt 0 -or $RelativeY -lt 0 -or $RelativeX -ge $windowWidth -or $RelativeY -ge $windowHeight) {
  throw "Relative click position is outside the restored Roblox Studio window: ($RelativeX,$RelativeY) in ${windowWidth}x${windowHeight}"
}

if ([BridgeStudioScopedClick]::GetForegroundWindow() -ne $handle) {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($target.Id)
  Start-Sleep -Milliseconds $SettleMs
}

if ([BridgeStudioScopedClick]::GetForegroundWindow() -ne $handle) {
  throw "Roblox Studio window could not be confirmed as foreground; no click was sent. PID=$($target.Id) TITLE=$($target.MainWindowTitle)"
}

$screenX = $rect.Left + $RelativeX
$screenY = $rect.Top + $RelativeY
[void][BridgeStudioScopedClick]::SetCursorPos($screenX, $screenY)
Start-Sleep -Milliseconds 150
$MOUSEEVENTF_LEFTDOWN = [uint32]0x0002
$MOUSEEVENTF_LEFTUP = [uint32]0x0004
[BridgeStudioScopedClick]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[BridgeStudioScopedClick]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{
  ok = $true
  placePath = [System.IO.Path]::GetFullPath($PlacePath)
  pid = $target.Id
  windowTitle = $target.MainWindowTitle
  foregroundConfirmed = ([BridgeStudioScopedClick]::GetForegroundWindow() -eq $handle)
  relativePosition = [pscustomobject]@{ x = $RelativeX; y = $RelativeY }
  screenPosition = [pscustomobject]@{ x = $screenX; y = $screenY }
  action = 'Scoped click on Roblox Studio Resume Scripts toolbar position'
} | ConvertTo-Json -Depth 4 -Compress
