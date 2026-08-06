param(
  [string]$BlenderExe = 'D:\SteamLibrary\steamapps\common\Blender\blender.exe',
  [string]$BridgeRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Force,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $BlenderExe -PathType Leaf)) {
  throw "Blender executable not found: $BlenderExe"
}

$bridgeSource = Join-Path $BridgeRoot 'integrations\blender\mauro_blender_bridge.py'
if (-not $Uninstall -and -not (Test-Path -LiteralPath $bridgeSource -PathType Leaf)) {
  throw "Bridge Blender source not found: $bridgeSource"
}

$probeExpression = "import bpy; print('MAURO_USER_SCRIPTS=' + bpy.utils.user_resource('SCRIPTS'))"
$probeOutput = & $BlenderExe --background --python-expr $probeExpression 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Could not query Blender user scripts path: $($probeOutput -join [Environment]::NewLine)"
}

$probeLine = $probeOutput | Where-Object { $_ -like 'MAURO_USER_SCRIPTS=*' } | Select-Object -First 1
if (-not $probeLine) {
  throw 'Blender did not report its user scripts path.'
}

$userScripts = [string]$probeLine.Substring('MAURO_USER_SCRIPTS='.Length)
$addonDir = Join-Path $userScripts 'addons\mauro_blender_bridge'
$addonPath = Join-Path $addonDir '__init__.py'
$legacyHookPath = Join-Path $userScripts 'startup\mauro_bridge_autostart.py'
$marker = 'MAURO_BLENDER_BRIDGE_ADDON=1'
$legacyMarker = 'MAURO_BLENDER_BRIDGE_AUTOSTART=1'

function Invoke-BlenderAddonPreference([bool]$Enable) {
  $tempScript = Join-Path $env:TEMP ("mauro-blender-addon-pref-{0}.py" -f ([guid]::NewGuid().ToString('N')))
  $operation = if ($Enable) { 'addon_enable' } else { 'addon_disable' }
  $expected = if ($Enable) { 'True' } else { 'False' }
  $pythonEnable = if ($Enable) { 'True' } else { 'False' }
  $script = @"
import bpy
module = 'mauro_blender_bridge'
try:
    bpy.ops.preferences.$operation(module=module)
except Exception as exc:
    if ${pythonEnable}:
        raise
    print(f'MAURO_ADDON_DISABLE_WARNING={exc!r}')
bpy.ops.wm.save_userpref()
enabled = module in bpy.context.preferences.addons
print(f'MAURO_ADDON_ENABLED={enabled}')
if str(enabled) != '$expected':
    raise RuntimeError(f'Unexpected addon enabled state: {enabled}')
"@
  try {
    Set-Content -LiteralPath $tempScript -Value $script -Encoding UTF8 -NoNewline
    $output = & $BlenderExe --background --python $tempScript 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Blender addon preference update failed: $($output -join [Environment]::NewLine)"
    }
    return @($output)
  }
  finally {
    Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
  }
}

if ($Uninstall) {
  $disabledOutput = Invoke-BlenderAddonPreference $false
  $removedAddon = $false
  if (Test-Path -LiteralPath $addonPath -PathType Leaf) {
    $existing = Get-Content -LiteralPath $addonPath -Raw
    if ($existing -notmatch [regex]::Escape($marker) -and -not $Force) {
      throw "Refusing to remove an unrecognized Blender addon. Review or re-run with -Force: $addonPath"
    }
    Remove-Item -LiteralPath $addonDir -Recurse -Force
    $removedAddon = $true
  }
  if (Test-Path -LiteralPath $legacyHookPath -PathType Leaf) {
    $legacy = Get-Content -LiteralPath $legacyHookPath -Raw
    if ($legacy -match [regex]::Escape($legacyMarker)) {
      Remove-Item -LiteralPath $legacyHookPath -Force
    }
  }
  [pscustomobject]@{
    stage = 'uninstalled'
    addonPath = $addonPath
    removedAddon = $removedAddon
    addonExists = Test-Path -LiteralPath $addonPath
    disabled = ($disabledOutput -join "`n") -match 'MAURO_ADDON_ENABLED=False'
  } | ConvertTo-Json -Depth 4
  exit 0
}

New-Item -ItemType Directory -Path $addonDir -Force | Out-Null
if (Test-Path -LiteralPath $addonPath -PathType Leaf) {
  $existing = Get-Content -LiteralPath $addonPath -Raw
  if ($existing -notmatch [regex]::Escape($marker) -and -not $Force) {
    throw "A different Blender addon already exists. Review or re-run with -Force: $addonPath"
  }
}

$escapedSource = $bridgeSource.Replace("'", "''")
$content = @"
# $marker
# Installed by bridge-mcp/scripts/install-blender-kit.ps1.
# The small wrapper loads the versioned implementation from the Bridge repository.
bl_info = {
    'name': 'Mauro Blender Bridge',
    'author': 'MauroPrime',
    'version': (0, 3, 0),
    'blender': (4, 0, 0),
    'location': 'View3D > Sidebar > Mauro Bridge',
    'description': 'Local-only Bridge inspection and visual-review kit',
    'category': 'Development',
}

import importlib.util
from pathlib import Path
import sys

_SOURCE = Path(r'''$escapedSource''')
_RUNTIME_NAME = 'mauro_blender_bridge_runtime'
_runtime = None


def _load_runtime():
    existing = sys.modules.get(_RUNTIME_NAME)
    if existing and hasattr(existing, 'unregister'):
        try:
            existing.unregister()
        except Exception:
            pass
    if not _SOURCE.is_file():
        raise RuntimeError(f'Mauro Blender Bridge source missing: {_SOURCE}')
    spec = importlib.util.spec_from_file_location(_RUNTIME_NAME, _SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Could not load Mauro Blender Bridge source: {_SOURCE}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[_RUNTIME_NAME] = module
    spec.loader.exec_module(module)
    return module


def register():
    global _runtime
    _runtime = _load_runtime()
    _runtime.register()


def unregister():
    global _runtime
    target = _runtime or sys.modules.get(_RUNTIME_NAME)
    if target and hasattr(target, 'unregister'):
        target.unregister()
    _runtime = None
"@

$tempPath = "$addonPath.tmp-$PID"
Set-Content -LiteralPath $tempPath -Value $content -Encoding UTF8 -NoNewline
Move-Item -LiteralPath $tempPath -Destination $addonPath -Force

if (Test-Path -LiteralPath $legacyHookPath -PathType Leaf) {
  $legacy = Get-Content -LiteralPath $legacyHookPath -Raw
  if ($legacy -match [regex]::Escape($legacyMarker)) {
    Remove-Item -LiteralPath $legacyHookPath -Force
  }
}

$written = Get-Content -LiteralPath $addonPath -Raw
if ($written -notmatch [regex]::Escape($marker) -or $written -notmatch [regex]::Escape($bridgeSource)) {
  throw "Blender addon wrapper verification failed: $addonPath"
}

$enableOutput = Invoke-BlenderAddonPreference $true
$hash = (Get-FileHash -LiteralPath $addonPath -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{
  stage = 'installed'
  blenderExe = (Resolve-Path -LiteralPath $BlenderExe).Path
  bridgeRoot = (Resolve-Path -LiteralPath $BridgeRoot).Path
  bridgeSource = (Resolve-Path -LiteralPath $bridgeSource).Path
  userScripts = $userScripts
  addonPath = $addonPath
  bytes = (Get-Item -LiteralPath $addonPath).Length
  sha256 = $hash
  enabled = ($enableOutput -join "`n") -match 'MAURO_ADDON_ENABLED=True'
  interactiveOnly = $true
  localhostPort = 9877
  legacyHookRemoved = -not (Test-Path -LiteralPath $legacyHookPath)
} | ConvertTo-Json -Depth 4
