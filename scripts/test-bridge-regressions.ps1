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
  if ($packageJson.version -ne "0.5.3") { throw "package.json version is $($packageJson.version), expected 0.5.3" }
  if ($configText -notmatch 'SERVER_VERSION = "0\.5\.3"') { throw "src/config.ts does not report SERVER_VERSION 0.5.3" }
  Write-Host "  OK 0.5.3"
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
const graph = await registry.call("dependency_graph", { projectRoot: root, filePattern: "*.ts", maxFiles: 200, maxCycles: 20, resolutionEngine: "typescript" });
if (typeof graph.internalEdgeCount !== "number" || !Array.isArray(graph.mostImported) || graph.resolver?.available !== true) process.exit(52);
const imports = await registry.call("import_graph", { projectRoot: root, filePattern: "*.ts", maxFiles: 200, includeExternal: true, resolutionEngine: "typescript" });
if (!Array.isArray(imports.edges) || imports.nodes.length < 1 || !imports.edges.some((edge) => edge.resolutionEngine === "typescript")) process.exit(53);
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

Invoke-Check "python analysis tools work from modular registry" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
for (const tool of ["python_validate", "python_import_graph", "python_dead_code"]) if (!registry.has(tool)) process.exit(80);
if (!registry.modules.includes("python-analysis")) process.exit(81);
const root = process.cwd();
const validate = await registry.call("python_validate", { path: "sandbox/python-tool-sample.py", projectRoot: root });
if (validate.ok !== true || validate.checked !== 1) process.exit(82);
const graph = await registry.call("python_import_graph", { projectRoot: root, filePattern: "*.py", maxFiles: 20, includeExternal: false });
if (typeof graph.nodeCount !== "number" || !Array.isArray(graph.edges)) process.exit(83);
const dead = await registry.call("python_dead_code", { projectRoot: root, filePattern: "*.py", maxFiles: 20, maxCandidates: 20, includeExported: true });
if (!Array.isArray(dead.candidates) || typeof dead.definitionCount !== "number") process.exit(84);
console.log("  OK python analysis tools");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-python-tools-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath "sandbox/python-tool-sample.py" -Value "import os`nfrom pathlib import Path`n`ndef used():`n    return Path(os.getcwd()).name`n`ndef _unused():`n    return 42`n`nclass Sample:`n    pass`n`nVALUE = used()`n" -Encoding utf8
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "python analysis regression failed" }
  }
  finally {
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "sandbox/python-tool-sample.py" -Force -ErrorAction SilentlyContinue
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

Invoke-Check "tool annotations and compact safe tools are registered" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
const byName = new Map(registry.tools.map((tool) => [tool.name, tool]));
for (const tool of ["bridge_health", "bridge_metrics_query"]) if (!registry.has(tool)) process.exit(60);
for (const tool of ["read_text_file", "bridge_health", "bridge_metrics_query", "impact_analysis", "dependency_graph"]) if (byName.get(tool)?.annotations?.readOnlyHint !== true) process.exit(61);
for (const tool of ["write_text_file", "run_command", "git_push_current_branch", "bridge_request_restart", "bridge_verify_all"]) if (byName.get(tool)?.annotations?.destructiveHint !== true) process.exit(62);
console.log("  OK tool annotations and compact safe tools");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-risk-annotations-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "tool annotation regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}

Invoke-Check "semantic and import graph stores report hits" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
const root = process.cwd();
await registry.call("impact_analysis", { name: "createDefaultToolRegistry", projectRoot: root, engine: "semantic", maxFiles: 200 });
const secondImpact = await registry.call("impact_analysis", { name: "createDefaultToolRegistry", projectRoot: root, engine: "semantic", maxFiles: 200 });
if (secondImpact.cache?.hit !== true) process.exit(70);
await registry.call("import_graph", { projectRoot: root, resolutionEngine: "typescript", maxFiles: 200 });
const secondGraph = await registry.call("import_graph", { projectRoot: root, resolutionEngine: "typescript", maxFiles: 200 });
if (secondGraph.memo?.hit !== true) process.exit(71);
console.log("  OK semantic and import graph store hits");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-store-hit-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "store hit regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}


Write-Host "[bridge-regression-test] all checks passed"






