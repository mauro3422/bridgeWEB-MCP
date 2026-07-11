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
  if ($packageJson.version -ne "0.6.0") { throw "package.json version is $($packageJson.version), expected 0.6.0" }
  if ($configText -notmatch 'SERVER_VERSION = "0\.6\.0"') { throw "src/config.ts does not report SERVER_VERSION 0.6.0" }
  Write-Host "  OK 0.6.0"
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
for (const tool of ["import_graph", "dependency_graph", "call_graph", "find_dead_code"]) {
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
const calls = await registry.call("call_graph", { projectRoot: root, maxFiles: 200, maxCycles: 20 });
if (!Array.isArray(calls.nodes) || !Array.isArray(calls.edges) || typeof calls.nodes.length !== "number") process.exit(55);
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
for (const tool of ["python_validate", "python_symbols", "python_impact_analysis", "python_import_graph", "python_dead_code", "python_test_plan", "pytest_testmon"]) if (!registry.has(tool)) process.exit(80);
if (!registry.modules.includes("python-analysis")) process.exit(81);
const root = process.cwd();
const validate = await registry.call("python_validate", { path: "python-tool-sample.py", projectRoot: root });
if (validate.ok !== true || validate.checked !== 1) process.exit(82);
const symbols = await registry.call("python_symbols", { path: "python-tool-sample.py", projectRoot: root });
if (symbols.definitionCount < 2) process.exit(85);
const impact = await registry.call("python_impact_analysis", { name: "used", projectRoot: root, filePattern: "*.py", maxFiles: 20 });
if (impact.totalReferences < 1) process.exit(86);
const plan = await registry.call("python_test_plan", { projectRoot: root, changedFiles: ["python-tool-sample.py"], maxTests: 5 });
if (!Array.isArray(plan.selectedTests)) process.exit(87);
const graph = await registry.call("python_import_graph", { projectRoot: root, filePattern: "*.py", maxFiles: 20, includeExternal: false });
if (typeof graph.nodeCount !== "number" || !Array.isArray(graph.edges)) process.exit(83);
const dead = await registry.call("python_dead_code", { projectRoot: root, filePattern: "*.py", maxFiles: 20, maxCandidates: 20, includeExported: true });
if (!Array.isArray(dead.candidates) || typeof dead.definitionCount !== "number") process.exit(84);
console.log("  OK python analysis tools");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-python-tools-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath "python-tool-sample.py" -Value "import os`nfrom pathlib import Path`n`ndef used():`n    return Path(os.getcwd()).name`n`ndef _unused():`n    return 42`n`nclass Sample:`n    pass`n`nVALUE = used()`n" -Encoding utf8
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "python analysis regression failed" }
  }
  finally {
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "python-tool-sample.py" -Force -ErrorAction SilentlyContinue
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
for (const tool of ["read_text_file", "terminal_read", "terminal_list", "work_peek", "work_show", "bridge_health", "bridge_metrics_query", "impact_analysis", "dependency_graph"]) if (byName.get(tool)?.annotations?.readOnlyHint !== true) process.exit(61);
for (const tool of ["write_text_file", "run_command", "terminal_start", "terminal_write", "terminal_stop", "work_once", "work_begin", "work_feed", "work_finish", "git_push_current_branch", "bridge_request_restart", "bridge_verify_all"]) if (byName.get(tool)?.annotations?.destructiveHint !== true) process.exit(62);
if (!byName.get("work_once")?.inputSchema?.required?.includes("command")) process.exit(63);
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


Invoke-Check "TypeScript resolver handles tsconfig paths and barrels" {
  $nodeScript = @'
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
const root = path.join(tmpdir(), `bridge-ts-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
try {
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", baseUrl: ".", paths: { "@lib/*": ["src/lib/*"] } }, include: ["src/**/*.ts"] }, null, 2));
  await writeFile(path.join(root, "src", "lib", "foo.ts"), "export const foo = 1;\n");
  await writeFile(path.join(root, "src", "lib", "index.ts"), "export const barrel = 2;\n");
  await writeFile(path.join(root, "src", "main.ts"), "import { foo } from '@lib/foo';\nimport { barrel } from './lib';\nconsole.log(foo, barrel);\n");
  const graph = await registry.call("import_graph", { projectRoot: root, resolutionEngine: "typescript", maxFiles: 20 });
  const pathEdge = graph.edges.find((edge) => edge.module === "@lib/foo");
  const barrelEdge = graph.edges.find((edge) => edge.module === "./lib");
  if (!pathEdge?.resolved || pathEdge.to !== "src/lib/foo.ts" || pathEdge.resolutionEngine !== "typescript") process.exit(90);
  if (!barrelEdge?.resolved || barrelEdge.to !== "src/lib/index.ts" || barrelEdge.resolutionEngine !== "typescript") process.exit(91);
  console.log("  OK tsconfig paths and barrel resolution");
} finally {
  await rm(root, { recursive: true, force: true });
}
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-ts-resolver-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "TypeScript resolver regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}

Invoke-Check "semantic aliases and cache invalidation work" {
  $nodeScript = @'
import { mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
const root = path.join(tmpdir(), `bridge-semantic-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
try {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" }, include: ["src/**/*.ts"] }, null, 2));
  await writeFile(path.join(root, "src", "a.ts"), "export function target() { return 1; }\n");
  await writeFile(path.join(root, "src", "b.ts"), "import { target as alias } from './a';\nexport const value = alias();\n");
  const first = await registry.call("impact_analysis", { name: "target", projectRoot: root, engine: "semantic", maxFiles: 20 });
  if (!first.filesWithReferences.some((file) => file.references.some((ref) => ref.kind === "call" && ref.text.includes("alias()")))) process.exit(92);
  const second = await registry.call("impact_analysis", { name: "target", projectRoot: root, engine: "semantic", maxFiles: 20 });
  if (second.cache?.hit !== true) process.exit(93);
  await appendFile(path.join(root, "src", "b.ts"), "// cache invalidation size change\n");
  const third = await registry.call("impact_analysis", { name: "target", projectRoot: root, engine: "semantic", maxFiles: 20 });
  if (third.cache?.hit !== false) process.exit(94);
  console.log("  OK semantic aliases and cache invalidation");
} finally {
  await rm(root, { recursive: true, force: true });
}
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-semantic-cache-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "semantic alias/cache regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}

Invoke-Check "semantic dead code exported behavior is explicit" {
  $nodeScript = @'
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
const root = path.join(tmpdir(), `bridge-dead-code-${Date.now()}-${Math.random().toString(36).slice(2)}`);
try {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" }, include: ["src/**/*.ts"] }, null, 2));
  await writeFile(path.join(root, "src", "index.ts"), "export function exportedUnused() { return 1; }\nfunction localUnused() { return 2; }\nconst shorthandUsed = 3;\nexport const live = { shorthandUsed };\n");
  const hiddenExport = await registry.call("find_dead_code", { projectRoot: root, engine: "semantic", includeExported: false, maxFiles: 20, maxCandidates: 20 });
  if (hiddenExport.candidates.some((candidate) => candidate.name === "exportedUnused")) process.exit(95);
  if (!hiddenExport.candidates.some((candidate) => candidate.name === "localUnused")) process.exit(96);
  if (hiddenExport.candidates.some((candidate) => candidate.name === "shorthandUsed")) process.exit(98);
  const visibleExport = await registry.call("find_dead_code", { projectRoot: root, engine: "semantic", includeExported: true, maxFiles: 20, maxCandidates: 20 });
  if (!visibleExport.candidates.some((candidate) => candidate.name === "exportedUnused" && candidate.confidence === "low")) process.exit(97);
  console.log("  OK semantic dead-code exported behavior");
} finally {
  await rm(root, { recursive: true, force: true });
}
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-dead-code-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "semantic dead-code regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}

Invoke-Check "persistent terminal timeout kills trees and cleans sessions" {
  $nodeScript = @'
import { pathToFileURL } from "node:url";
const registryModuleUrl = pathToFileURL(process.argv[2]).href;
const { createDefaultToolRegistry } = await import(registryModuleUrl);
const registry = createDefaultToolRegistry();
const command = `"${process.execPath}" -e "setTimeout(() => {}, 10000)"`;
const started = await registry.call("terminal_start", { command, timeoutMs: 1000, cleanupAfterMs: 0, name: "regression-timeout" });
await new Promise((resolve) => setTimeout(resolve, 3000));
const snapshot = await registry.call("terminal_read", { sessionId: started.id, maxChars: 2000 });
if (snapshot.running !== false || snapshot.timedOut !== true || snapshot.completedAtIso === null) {
  console.error(JSON.stringify(snapshot, null, 2));
  process.exit(110);
}
const sessions = await registry.call("terminal_list", {});
if (sessions.some((session) => session.id === started.id)) process.exit(111);
let blocked = false;
try {
  await registry.call("work_once", { command: "cmd /c shutdown /?", timeoutMs: 1000 });
} catch (error) {
  blocked = String(error).includes("blocked by bridge-mcp policy");
}
if (!blocked) process.exit(112);
console.log("  OK terminal lifecycle, process-tree timeout, cleanup, and wrapped-command policy");
'@
  $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("bridge-terminal-regression-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    $registryModulePath = (Resolve-Path -LiteralPath ".\dist\tool-registry.js").Path
    node $tmpScript $registryModulePath
    if ($LASTEXITCODE -ne 0) { throw "terminal lifecycle regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}

Invoke-Check "HTTP body and session limits reject excess work" {
  $port = Get-Random -Minimum 32000 -Maximum 45000
  $baseUrl = "http://127.0.0.1:$port"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ".\dist\http.js"
  $psi.WorkingDirectory = $ProjectRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Environment["BRIDGE_MCP_HTTP_HOST"] = "127.0.0.1"
  $psi.Environment["BRIDGE_MCP_HTTP_PORT"] = [string]$port
  $psi.Environment["BRIDGE_MCP_HTTP_MAX_SESSIONS"] = "1"
  $psi.Environment["BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS"] = "100"
  $psi.Environment["BRIDGE_MCP_HTTP_MAX_BODY_BYTES"] = "1024"
  $process = [System.Diagnostics.Process]::Start($psi)
  try {
    $ready = $false
    foreach ($attempt in 1..50) {
      if (Test-Path -LiteralPath ".\dist\http.js") {
        try {
          if ([string](Invoke-RestMethod -Uri "$baseUrl/readyz" -TimeoutSec 1) -eq "ready") { $ready = $true; break }
        }
        catch {}
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $ready) { throw "temporary HTTP bridge did not become ready" }

    $headers = @{ Accept = "application/json, text/event-stream" }
    $initialize = @{
      jsonrpc = "2.0"
      id = 1
      method = "initialize"
      params = @{ protocolVersion = "2024-11-05"; capabilities = @{}; clientInfo = @{ name = "regression"; version = "0.1.0" } }
    } | ConvertTo-Json -Depth 10 -Compress
    $first = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $initialize
    if ([int]$first.StatusCode -ne 200) { throw "first initialize failed with $($first.StatusCode)" }
    $firstSessionId = [string]$first.Headers["Mcp-Session-Id"]
    if (-not $firstSessionId) { throw "first initialize did not return Mcp-Session-Id" }

    $capacityStatus = 0
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $initialize | Out-Null
    }
    catch {
      $capacityStatus = [int]$_.Exception.Response.StatusCode
    }
    if ($capacityStatus -ne 503) { throw "expected recent session capacity 503, got $capacityStatus" }

    Start-Sleep -Milliseconds 250
    $reclaimed = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $initialize
    if ([int]$reclaimed.StatusCode -ne 200) { throw "initialize after reclaim delay failed with $($reclaimed.StatusCode)" }
    $reclaimedSessionId = [string]$reclaimed.Headers["Mcp-Session-Id"]
    if (-not $reclaimedSessionId -or $reclaimedSessionId -eq $firstSessionId) { throw "capacity reclaim did not create a fresh session" }

    $statusAfterReclaim = Invoke-RestMethod -Uri "$baseUrl/status" -TimeoutSec 2
    if ([int]$statusAfterReclaim.sessions -ne 1 -or [int]$statusAfterReclaim.activeSessions -ne 0) {
      throw "unexpected session state after capacity reclaim: $($statusAfterReclaim | ConvertTo-Json -Compress)"
    }

    $oversized = '{"jsonrpc":"2.0","id":2,"method":"tools/list","padding":"' + ('x' * 2048) + '"}'
    $bodyStatus = 0
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $oversized | Out-Null
    }
    catch {
      $bodyStatus = [int]$_.Exception.Response.StatusCode
    }
    if ($bodyStatus -ne 413) { throw "expected oversized body 413, got $bodyStatus" }

    $closed = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/mcp" -Method Delete -Headers @{ Accept = "application/json, text/event-stream"; "Mcp-Session-Id" = $reclaimedSessionId }
    if (@(200, 202, 204) -notcontains [int]$closed.StatusCode) { throw "session DELETE failed with $($closed.StatusCode)" }
    $statusAfterDelete = Invoke-RestMethod -Uri "$baseUrl/status" -TimeoutSec 2
    if ([int]$statusAfterDelete.sessions -ne 0) { throw "session DELETE did not release capacity" }

    Write-Host "  OK HTTP body, recent-session protection, inactive-session reclaim, and DELETE lifecycle"
  }
  finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    if ($process) { $process.Dispose() }
  }
}

Invoke-Check "metrics store only input keys and redact sensitive errors" {
  $nodeScript = @'
import { beginToolMetric, finishToolMetric } from "./dist/metrics.js";
const metric = beginToolMetric("metrics_regression", { token: "secret-value", path: "sample.txt" });
if (metric.inputKeys !== "path,token") process.exit(98);
if (JSON.stringify(metric).includes("secret-value")) process.exit(99);
finishToolMetric(metric, false, 0, "token=abc123secret password: hunter2");
console.log("  OK metrics input key storage and redaction");
'@
  $tmpScript = Join-Path (Get-Location) (".tmp-metrics-regression-" + [Guid]::NewGuid().ToString("N") + ".mjs")
  try {
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding utf8
    node $tmpScript
    if ($LASTEXITCODE -ne 0) { throw "metrics privacy regression failed" }
  }
  finally { Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue }
}

Write-Host "[bridge-regression-test] all checks passed"
