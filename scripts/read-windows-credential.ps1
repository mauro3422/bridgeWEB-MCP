[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateLength(1, 256)][string]$CredentialTarget
)

$ErrorActionPreference = 'Stop'
$nativeSource = @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct BridgeNativeCredential
{
    public UInt32 Flags;
    public UInt32 Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
}

public static class BridgeWinCredentialApi
{
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree(IntPtr credential);
}
'@

$nativeBuffer = [IntPtr]::Zero
$native = $null
$secret = $null
$secretBytes = $null
$encodedBytes = $null
$exitCode = 0
try {
  Add-Type -TypeDefinition $nativeSource -ErrorAction Stop | Out-Null
  if (-not [BridgeWinCredentialApi]::CredRead($CredentialTarget, 1, 0, [ref]$nativeBuffer)) {
    $exitCode = 2
  }
  else {
    $native = [Runtime.InteropServices.Marshal]::PtrToStructure($nativeBuffer, [type][BridgeNativeCredential])
    $size = [int]$native.CredentialBlobSize
    if ($size -lt 2 -or ($size % 2) -ne 0 -or $native.CredentialBlob -eq [IntPtr]::Zero) {
      $exitCode = 3
    }
    else {
      $secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($native.CredentialBlob, [int]($size / 2))
      if ([string]::IsNullOrWhiteSpace($secret) -or $secret.IndexOfAny([char[]]@([char]0, [char]10, [char]13)) -ge 0) {
        $exitCode = 3
      }
      else {
        $secretBytes = [System.Text.Encoding]::Unicode.GetBytes($secret)
        $encodedBytes = [System.Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($secretBytes))
        $stdout = [Console]::OpenStandardOutput()
        $stdout.Write($encodedBytes, 0, $encodedBytes.Length)
        $stdout.Flush()
      }
    }
  }
}
catch {
  $exitCode = 4
}
finally {
  if ($null -ne $native -and $native.CredentialBlob -ne [IntPtr]::Zero -and $native.CredentialBlobSize -gt 0) {
    for ($offset = 0; $offset -lt [int]$native.CredentialBlobSize; $offset++) {
      [Runtime.InteropServices.Marshal]::WriteByte($native.CredentialBlob, $offset, [byte]0)
    }
  }
  if ($nativeBuffer -ne [IntPtr]::Zero) { [BridgeWinCredentialApi]::CredFree($nativeBuffer) }
  if ($null -ne $secretBytes) { [Array]::Clear($secretBytes, 0, $secretBytes.Length) }
  if ($null -ne $encodedBytes) { [Array]::Clear($encodedBytes, 0, $encodedBytes.Length) }
  $secret = $null
}
exit $exitCode
