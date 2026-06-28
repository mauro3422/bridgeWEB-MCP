param(
  [string]$ProjectRoot = "C:\dev\bridge-mcp",
  [string]$ExpectedTunnelAdminBaseUrl = "http://127.0.0.1:8081"
)

$ErrorActionPreference = "Stop"

function Invoke-Check {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  Write-Host "[bridge-regression-test] $Name"
  & $Check
}

Set-Location -LiteralPath $ProjectRoot

Invoke-Check "version bump is consistent" {
  $packageJson = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
  $configText = Get-Content -LiteralPath "src\config.ts" -Raw
  if ($packageJson.version -ne "0.5.0") { throw "package.json version is $($packageJson.version), expected 0.5.0" }
  if ($configText -notmatch 'SERVER_VERSION = "0\.5\.0"') { throw "src/config.ts does not report SERVER_VERSION 0.5.0" }
  Write-Host "  OK 0.5.0"
}

Invoke-Check "tunnel admin default stays on HTTP profile port" {
  $configText = Get-Content -LiteralPath "src\config.ts" -Raw
  $expectedLine = 'DEFAULT_TUNNEL_ADMIN_BASE_URL = "' + $ExpectedTunnelAdminBaseUrl + '"'
  if (-not $configText.Contains($expectedLine)) {
    throw "DEFAULT_TUNNEL_ADMIN_BASE_URL is not $ExpectedTunnelAdminBaseUrl"
  }
  Write-Host "  OK $ExpectedTunnelAdminBaseUrl"
}

Invoke-Check "agentic file tools work from modular registry" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const fileToolsModuleUrl = pathToFileURL(process.argv[2]).href;
const registryModuleUrl = pathToFileURL(process.argv[3]).href;
const { listFilesSmart, readFileLines, readManyFiles, searchFiles } = await import(fileToolsModuleUrl);
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
for (const tool of ["read_file_lines", "read_many_files", "search_files", "list_files_smart", "write_text_file", "apply_patch", "edit_lines"]) {
  if (!registry.has(tool)) process.exit(20);
}
if (!registry.modules.includes("file-navigation")) process.exit(21);
if (!registry.modules.includes("file-writing")) process.exit(22);
const root = process.cwd();
const read = await readFileLines({ path: "src/config.ts", startLine: 1, maxLines: 20 });
if (!read.lines.some((line) => line.text.includes("SERVER_VERSION"))) process.exit(11);
const many = await readManyFiles({ files: ["src/config.ts:1-8", "src/tools/file-navigation-core.ts:1-20"], maxLinesPerFile: 20 });
if (many.count !== 2 || many.results.some((r) => !r.ok)) process.exit(12);
const search = await searchFiles({ path: root, pattern: "readFileLines", filePattern: "*.ts", contextLines: 1, maxResults: 10 });
if (search.totalMatches < 1) process.exit(13);
const listed = await listFilesSmart({ path: "src", depth: 1, pattern: "*.ts" });
if (!listed.entries.some((entry) => entry.path === "tools\\file-navigation-core.ts" || entry.path === "tools/file-navigation-core.ts")) process.exit(14);
const fs = await import("node:fs/promises");
const os = await import("node:os");
const path = await import("node:path");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-file-writing-"));
const target = path.join(tmp, "sample.txt");
await registry.call("write_text_file", { path: target, content: "one\ntwo\nthree\n" });
const edit = await registry.call("edit_lines", { path: target, startLine: 2, endLine: 2, newContent: "TWO", mode: "replace" });
if (!edit.postflight?.verified || edit.edit?.lineDelta !== 0) process.exit(15);
const patch = await registry.call("apply_patch", { path: target, oldText: "three", newText: "THREE", expectedReplacements: 1 });
if (!patch.postflight?.verified || patch.replacements !== 1) process.exit(16);
await fs.rm(tmp, { recursive: true, force: true });
console.log("  OK modular file navigation and writing tools");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-file-tools-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $fileToolsModulePath = (Resolve-Path -LiteralPath ".\\dist\\tools\\file-navigation-core.js").Path
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $fileToolsModulePath $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "agentic file tools regression failed" }
  }
  finally {
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
  }
}

Invoke-Check "code intelligence tools work from modular registry" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
for (const tool of ["analyze_code", "impact_analysis", "find_duplicate_symbols"]) {
  if (!registry.has(tool)) process.exit(30);
}
const root = process.cwd();
const analyze = await registry.call("analyze_code", { path: "src/tool-registry.ts", symbol: "createDefaultToolRegistry", engine: "typescript" });
if (!analyze.symbolQuery || analyze.symbolQuery.count < 1 || analyze.engineUsed !== "typescript") process.exit(31);
if (!Array.isArray(analyze.imports) || analyze.imports.length < 1) process.exit(34);
const impact = await registry.call("impact_analysis", { name: "createDefaultToolRegistry", projectRoot: root, filePattern: "*.ts", maxFiles: 200, engine: "typescript" });
if (impact.definitions.length < 1 || impact.totalReferences < 1 || !impact.enginesUsed.includes("typescript")) process.exit(32);
const semanticImpact = await registry.call("impact_analysis", { name: "createDefaultToolRegistry", projectRoot: root, filePattern: "*.ts", maxFiles: 200, engine: "semantic" });
if (semanticImpact.definitions.length < 1 || semanticImpact.totalReferences < 1 || !semanticImpact.enginesUsed.includes("semantic")) process.exit(35);
const duplicates = await registry.call("find_duplicate_symbols", { projectRoot: root, filePattern: "*.ts", maxFiles: 200, maxGroups: 20 });
if (typeof duplicates.duplicateGroupCount !== "number") process.exit(33);
console.log("  OK code intelligence tools");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-code-intel-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "code intelligence regression failed" }
  }
  finally {
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
  }
}

Invoke-Check "code graph tools work from modular registry" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
for (const tool of ["import_graph", "dependency_graph", "find_dead_code"]) {
  if (!registry.has(tool)) process.exit(50);
}
if (!registry.modules.includes("code-graph")) process.exit(51);
const root = process.cwd();
const graph = await registry.call("dependency_graph", { projectRoot: root, filePattern: "*.ts", maxFiles: 200, maxCycles: 20 });
if (typeof graph.internalEdgeCount !== "number" || !Array.isArray(graph.mostImported)) process.exit(52);
const imports = await registry.call("import_graph", { projectRoot: root, filePattern: "*.ts", maxFiles: 200, includeExternal: true });
if (!Array.isArray(imports.edges) || imports.nodes.length < 1) process.exit(53);
const dead = await registry.call("find_dead_code", { projectRoot: root, filePattern: "*.ts", maxFiles: 200, maxCandidates: 20, engine: "semantic" });
if (!Array.isArray(dead.candidates) || dead.engineUsed !== "semantic") process.exit(54);
console.log("  OK code graph tools");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-code-graph-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "code graph regression failed" }
  }
  finally {
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
  }
}

Invoke-Check "bridge workflow tool is registered" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
if (!registry.has("bridge_verify_all")) process.exit(40);
for (const moduleName of ["core", "process", "git", "bridge-ops", "metrics", "bridge-workflow"]) {
  if (!registry.modules.includes(moduleName)) process.exit(41);
}
for (const tool of ["system_info", "run_command", "git_status", "bridge_self_check", "bridge_metrics_status", "bridge_verify_all"]) {
  if (!registry.has(tool)) process.exit(42);
}
console.log("  OK bridge workflow and migrated modules");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-workflow-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "bridge workflow registry regression failed" }
  }
  finally {
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
  }
}

Invoke-Check "restart ack JSON accepts UTF-8 BOM" {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-regression-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $ackPath = Join-Path $tmp ".bridge-restart-ack"
    $ackJson = '{"id":"bom-test","action":"restart-http","acknowledgedAt":"2026-06-28T00:00:00.000Z","watchdogPid":1}'
    [System.IO.File]::WriteAllText($ackPath, $ackJson, [System.Text.UTF8Encoding]::new($true))

    $nodeScript = @'
import { pathToFileURL } from "node:url";
const bridgeModuleUrl = pathToFileURL(process.argv[3]).href;
const { bridgeRestartStatus } = await import(bridgeModuleUrl);
const status = await bridgeRestartStatus(process.argv[2]);
if (!status.lastAck || status.lastAck.parseError) {
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}
if (status.lastAck.id !== "bom-test" || status.lastAck.action !== "restart-http") {
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}
'@
    $scriptPath = Join-Path $tmp "check-bom.mjs"
    $bridgeModulePath = (Resolve-Path -LiteralPath ".\dist\bridge-server.js").Path
    Set-Content -LiteralPath $scriptPath -Value $nodeScript -Encoding utf8
    node $scriptPath $tmp $bridgeModulePath
    if ($LASTEXITCODE -ne 0) { throw "BOM restart ack parsing failed" }
    Write-Host "  OK BOM-safe ack parsing"
  }
  finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "[bridge-regression-test] all checks passed"


