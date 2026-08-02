param(
  [Parameter(Mandatory = $true)]
  [string]$PlacePath,

  [int]$SettleMs = 350
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PlacePath -PathType Leaf)) {
  throw "Place file does not exist: $PlacePath"
}

$fullPlacePath = [System.IO.Path]::GetFullPath($PlacePath)
$placeName = [System.IO.Path]::GetFileName($fullPlacePath)
$expectedTitle = "$fullPlacePath - Roblox Studio"
$processes = @(Get-Process -Name 'RobloxStudioBeta' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($processes.Count -eq 0) {
  throw 'No visible Roblox Studio window was found.'
}

$matches = @($processes | Where-Object {
  [string]::Equals($_.MainWindowTitle, $expectedTitle, [System.StringComparison]::OrdinalIgnoreCase)
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

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BridgeStudioKeyboard {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$VK_CONTROL = 0x11
$VK_S = 0x53
$KEYEVENTF_KEYUP = 0x0002
$handle = [IntPtr]$target.MainWindowHandle

[void][BridgeStudioKeyboard]::ShowWindow($handle, 9)
[void][BridgeStudioKeyboard]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds $SettleMs

if ([BridgeStudioKeyboard]::GetForegroundWindow() -ne $handle) {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($target.Id)
  Start-Sleep -Milliseconds $SettleMs
}

if ([BridgeStudioKeyboard]::GetForegroundWindow() -ne $handle) {
  [uint32]$targetProcessId = 0
  $targetThreadId = [BridgeStudioKeyboard]::GetWindowThreadProcessId($handle, [ref]$targetProcessId)
  $currentThreadId = [BridgeStudioKeyboard]::GetCurrentThreadId()
  $attached = $false
  try {
    if ($targetThreadId -ne 0 -and $targetProcessId -eq [uint32]$target.Id -and $currentThreadId -ne $targetThreadId) {
      $attached = [BridgeStudioKeyboard]::AttachThreadInput($currentThreadId, $targetThreadId, $true)
    }
    [void][BridgeStudioKeyboard]::BringWindowToTop($handle)
    [void][BridgeStudioKeyboard]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds $SettleMs
  } finally {
    if ($attached) {
      [void][BridgeStudioKeyboard]::AttachThreadInput($currentThreadId, $targetThreadId, $false)
    }
  }
}

if ([BridgeStudioKeyboard]::GetForegroundWindow() -ne $handle) {
  throw "Roblox Studio window could not be confirmed as foreground after bounded thread-input fallback; Ctrl+S was not sent. PID=$($target.Id) TITLE=$($target.MainWindowTitle)"
}

try {
  [BridgeStudioKeyboard]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero)
  [BridgeStudioKeyboard]::keybd_event($VK_S, 0, 0, [UIntPtr]::Zero)
  [BridgeStudioKeyboard]::keybd_event($VK_S, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
} finally {
  [BridgeStudioKeyboard]::keybd_event($VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}

Start-Sleep -Milliseconds $SettleMs

[pscustomobject]@{
  ok = $true
  placePath = [System.IO.Path]::GetFullPath($PlacePath)
  pid = $target.Id
  windowTitle = $target.MainWindowTitle
  foregroundConfirmed = ([BridgeStudioKeyboard]::GetForegroundWindow() -eq $handle)
  action = 'Ctrl+S'
} | ConvertTo-Json -Compress
