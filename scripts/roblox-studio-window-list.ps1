$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BridgeTopLevelWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@

$rows = New-Object System.Collections.Generic.List[object]
$callback = [BridgeTopLevelWindows+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $length = [BridgeTopLevelWindows]::GetWindowTextLength($hWnd)
  if ($length -le 0) { return $true }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][BridgeTopLevelWindows]::GetWindowText($hWnd, $builder, $builder.Capacity)
  $title = $builder.ToString()
  $windowProcessId = [uint32]0
  [void][BridgeTopLevelWindows]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId)
  $process = Get-Process -Id $windowProcessId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'RobloxStudioBeta') {
    $rect = New-Object BridgeTopLevelWindows+RECT
    [void][BridgeTopLevelWindows]::GetWindowRect($hWnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $rows.Add([pscustomobject]@{
      handle = $hWnd.ToInt64()
      pid = [int]$windowProcessId
      title = $title
      visible = [BridgeTopLevelWindows]::IsWindowVisible($hWnd)
      left = $rect.Left
      top = $rect.Top
      right = $rect.Right
      bottom = $rect.Bottom
      width = $width
      height = $height
      area = [int64]$width * [int64]$height
    })
  }
  return $true
}
[void][BridgeTopLevelWindows]::EnumWindows($callback, [IntPtr]::Zero)
$rows | Sort-Object area -Descending | ConvertTo-Json -Depth 4
