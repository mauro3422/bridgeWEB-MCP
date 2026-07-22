param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$ExpectedServerVersion = "0.6.6",
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
$steps += Invoke-VerifyStep "test:regressions" { npm run test:regressions }
$steps += Invoke-VerifyStep "test:skill-routing" { npm run test:skill-routing }
$steps += Invoke-VerifyStep "docs:tools:check" { npm run docs:tools:check }
$steps += Invoke-VerifyStep "watchdog restart status" {
  node .\scripts\verify-mcp-call.mjs bridge_restart_status "{}" lastAck pending
}
$steps += Invoke-VerifyStep "metrics status" {
  node .\scripts\verify-mcp-call.mjs bridge_metrics_status "{}" sqliteAvailable jsonlPath
}
$steps += Invoke-VerifyStep "tools:list sanity" {
  node .\scripts\verify-mcp-tools-list.mjs system_info run_command git_status bridge_self_check bridge_metrics_status bridge_verify_all read_file_lines edit_lines impact_analysis dependency_graph import_graph call_graph find_dead_code python_validate python_symbols python_impact_analysis python_import_graph python_dead_code python_test_plan pytest_testmon project_context_load workflow_guide_recommend workflow_guide_load workflow_guide_create skill_catalog skill_route_audit skill_route_plan skill_bootstrap binary_file_info binary_file_read_chunk binary_file_write binary_upload_begin binary_upload_append binary_upload_status binary_upload_finish binary_upload_abort image_asset_save image_character_views_prepare blender_status blender_open blender_scene_info blender_viewport_screenshot blender_execute_code blender_batch_script blender_store_reference_image blender_setup_character_references blender_character_loop_status
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
