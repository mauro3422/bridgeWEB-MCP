param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$ExpectedServerVersion = "0.5.3",
  [switch]$StrictGit
)

$ErrorActionPreference = "Stop"

function Convert-ToTailText {
  param([string]$Text, [int]$MaxChars = 4000)
  if ($null -eq $Text) { return "" }
  if ($Text.Length -gt $MaxChars) { return $Text.Substring($Text.Length - $MaxChars) }
  return $Text
}

function Invoke-VerifyStep {
  param(
    [string]$Name,
    [scriptblock]$Script,
    [bool]$Required = $true
  )

  Write-Host "[bridge-verify-all] $Name"
  $started = Get-Date
  $outputText = ""
  try {
    $outputText = (& $Script 2>&1 | Out-String)
    $code = if ($global:LASTEXITCODE -is [int]) { $global:LASTEXITCODE } else { 0 }
    $durationMs = [int]((Get-Date) - $started).TotalMilliseconds
    if ($outputText.Trim().Length -gt 0) { Write-Host (Convert-ToTailText $outputText 1200).TrimEnd() }
    if ($code -ne 0 -and $Required) {
      throw "$Name failed with exit code $code"
    }
    Write-Host "  OK durationMs=$durationMs"
    return [pscustomobject]@{ name = $Name; ok = ($code -eq 0); code = $code; required = $Required; durationMs = $durationMs; stdoutTail = Convert-ToTailText $outputText 4000 }
  }
  catch {
    $durationMs = [int]((Get-Date) - $started).TotalMilliseconds
    Write-Host "  FAIL durationMs=$durationMs error=$($_.Exception.Message)"
    return [pscustomobject]@{ name = $Name; ok = $false; code = 1; required = $Required; durationMs = $durationMs; error = $_.Exception.Message; stdoutTail = Convert-ToTailText $outputText 4000 }
  }
  finally {
    $global:LASTEXITCODE = 0
  }
}

Set-Location -LiteralPath $ProjectRoot

$steps = @()
$steps += Invoke-VerifyStep "doctor" { powershell -NoProfile -File .\scripts\bridge-doctor.ps1 -ExpectedServerVersion $ExpectedServerVersion }
$steps += Invoke-VerifyStep "check" { npm run check }
$steps += Invoke-VerifyStep "build" { npm run build }
$steps += Invoke-VerifyStep "smoke:http" { powershell -NoProfile -File .\scripts\test-bridge-http.ps1 }
$steps += Invoke-VerifyStep "test:regressions" { powershell -NoProfile -File .\scripts\test-bridge-regressions.ps1 }
$steps += Invoke-VerifyStep "docs:tools:check" { npm run docs:tools:check }
$steps += Invoke-VerifyStep "tools:list sanity" {
  node -e "const base='http://127.0.0.1:3001/mcp'; const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'verify-all',version:'0.1.0'}}}; const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify(init)}); const sid=r.headers.get('mcp-session-id'); await r.text(); const rr=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','Mcp-Session-Id':sid},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})}); const txt=await rr.text(); const names=['system_info','run_command','git_status','bridge_self_check','bridge_metrics_status','bridge_verify_all','read_file_lines','edit_lines','impact_analysis','dependency_graph','import_graph','find_dead_code','python_validate','python_import_graph','python_dead_code']; const missing=names.filter(n=>!txt.includes(n)); if(missing.length){ console.error('missing tools: '+missing.join(',')); process.exit(1); } console.log('tools present: '+names.join(','));"
}
$steps += Invoke-VerifyStep "git status" {
  git status --short --branch
  if ($StrictGit -and ((git status --porcelain) | Out-String).Trim().Length -gt 0) {
    throw "working tree is dirty"
  }
} -Required:$false

$failedRequired = @($steps | Where-Object { $_.required -and -not $_.ok })
$ok = $failedRequired.Count -eq 0

$result = [pscustomobject]@{
  ok = $ok
  projectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
  expectedServerVersion = $ExpectedServerVersion
  strictGit = [bool]$StrictGit
  steps = $steps
  failedRequired = $failedRequired.Count
}

Write-Host "[bridge-verify-all] summary"
$result | ConvertTo-Json -Depth 6

if (-not $ok) { exit 1 }



