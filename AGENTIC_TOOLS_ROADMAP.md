# Agentic tools roadmap

This document captures the tool ideas extracted from `C:\dev\Kairos` / K-Chat so the bridge can evolve without re-investigating Kairos every time.

## Why this matters

The bridge should reduce raw shell usage and give ChatGPT precise, bounded tools for code navigation, code editing, validation, and diagnosis. K-Chat/Kairos proves the useful pattern: give the assistant tools that return line numbers, context, summaries, function/class metadata, and batch results. That makes the assistant less blind and lowers the chance of editing the wrong thing.

The goal is not to copy Kairos exactly. Kairos is Python-first and has its own memory/UI stack. The bridge is TypeScript MCP over local HTTP. Copy the design patterns, not the implementation.

## Current bridge baseline

Current bridge tools are stable but low-level:

```txt
list_dir              -> lists files with bounded depth
read_text_file        -> reads a whole UTF-8 file with byte limit
write_text_file       -> writes/appends whole text
apply_patch           -> exact string replacement
run_command           -> shell fallback
git_*                 -> safe Git helpers
bridge_*              -> diagnostics, restart, metrics, visualizations
terminal_*            -> persistent shell sessions
```

Main limitation: most file/code work still requires reading too much text or falling back to shell commands.

## Kairos patterns worth adopting

### 1. Numbered, paginated file reading

Kairos has `read_file(path, start_line, end_line, max_lines)`.

Bridge target:

```txt
read_file_lines(path, startLine=1, endLine?, maxLines=250)
```

Expected output:

```txt
[File: src/bridge-server.ts | Total lines: 620 | Displayed range: 120-180]
120: async function tunnelHealth(...) {
121:   ...
```

Rules:

- 1-indexed line numbers.
- Cap output, default 250 lines, max 500.
- Return total line count and next suggested `startLine` when truncated.
- Preserve text exactly enough for inspection, but do not dump huge files.
- Treat binary/oversized files as errors.

Priority: P0.

### 2. Read many file ranges in one call

Kairos has `read_multiple(files, max_lines)` with specs like `file.py:20-50`.

Bridge target:

```txt
read_many_files(files: string[], maxLinesPerFile=250)
```

Input examples:

```txt
src/config.ts:1-60
src/bridge-server.ts:280-360
scripts/bridge-doctor.ps1:1-120
```

Rules:

- Max 10 files per call.
- Max 250 lines per file by default, max 500.
- Return each file as a separately labeled block.
- Useful for checking imports + implementation + tests together.

Priority: P0.

### 3. Grep with context and line numbers

Kairos has `search_files(pattern, path, file_pattern, context_lines, max_results, case_sensitive)`. It shows line numbers, surrounding context, and for Python can show the containing function/class.

Bridge target:

```txt
search_files(path, pattern, filePattern?, contextLines=2, maxResults=50, caseSensitive=false)
```

Expected output:

```txt
src/bridge-server.ts (2 matches)
  function bridgeRestartStatus
   L300  async function bridgeRestartStatus(cwd?: string) {
 > L307    const parseText = text.replace(/^\uFEFF/, "");
   L308    try {
```

Rules:

- Literal search by default, not regex.
- Optional regex later as explicit `regex=true`.
- Skip `node_modules`, `dist`, logs, SQLite, `.git`, large files, binaries.
- Include file match counts and total match count.
- Cap output length.
- For TypeScript/JavaScript, use lightweight container detection first: nearest preceding function/class/export/tool schema. Later upgrade to TypeScript AST.

Priority: P0.

### 4. Smart directory listing

Kairos has `list_files` that reports language, lines, functions, classes, imports, and summaries.

Bridge target:

```txt
list_files_smart(path, depth=1, pattern?, showImports=false)
```

Expected output:

```txt
src/
  bridge-server.ts        620 lines  TS  functions: createBridgeServer, bridgeSelfCheck, tunnelHealth
  config.ts                64 lines  TS  exports: SERVER_VERSION, DEFAULT_TUNNEL_ADMIN_BASE_URL
  metrics.ts              210 lines  TS
```

Rules:

- Max depth 3.
- Max listed files 200.
- Count lines safely.
- Detect language from extension.
- Detect functions/classes/exports with simple regex initially.
- Optional imports summary.
- Skip generated/noisy folders.

Priority: P0/P1.

### 5. Surgical line editor

Kairos has `edit_file(path, start_line, end_line, new_content)`.

Bridge target:

```txt
edit_lines(path, startLine, endLine?, newContent, mode?)
```

Modes:

```txt
replace range: startLine + endLine + newContent
insert before/after: startLine + mode=insert_before|insert_after + newContent
delete range: startLine + endLine + empty newContent + mode=delete
```

Rules:

- Keep `apply_patch` as the safer default for exact text replacement.
- Use `edit_lines` when line numbers are known from `read_file_lines` or `search_files`.
- Validate line ranges.
- Return summary with old/new line counts and changed range.
- Create a temporary backup or return enough context to roll back.
- Preserve newline style when possible.
- Do not allow binary/oversized files.

Priority: P1.

### 6. Bridge verify-all

Bridge already has `bridge_self_check`, `test-bridge-http.ps1`, `test-bridge-regressions.ps1`, and `bridge-doctor.ps1`.

Bridge target:

```txt
bridge_verify_all(cwd?)
```

Or npm script:

```txt
npm run verify:all
```

Should run:

```txt
bridge-doctor.ps1
npm run check
npm run build
npm run smoke:http
npm run test:regressions
git status --short --branch
```

Rules:

- Return structured summary.
- Do not restart anything.
- Mark Git dirty as warning, not failure, unless strict mode is enabled.
- Include current server version, tunnel base URL, and active PID.

Priority: P1.

### 7. Basic code analysis

Kairos has `analyze_code` with Python AST: functions, params, calls, returns, complexity.

Bridge target v1:

```txt
analyze_code(path, symbol?)
```

Initial TypeScript/JavaScript implementation can be regex/lightweight:

- imports
- exports
- functions
- classes
- tool schemas
- line ranges
- approximate callers inside same file

Later implementation can use TypeScript compiler API for accuracy.

Priority: P2.

### 8. Impact analysis

Kairos has `impact_analysis(name, path)` for callers/references.

Bridge target:

```txt
impact_analysis(name, path?, projectRoot?, filePattern?)
```

Expected use:

```txt
impact_analysis("DEFAULT_TUNNEL_ADMIN_BASE_URL", "src/config.ts")
```

Should report:

- files referencing the symbol
- line numbers
- import-only vs direct call/reference when detectable
- rough risk level

Priority: P2.

### 9. Dead code / dependency graph

Kairos has `dependency_graph` and `find_dead_code`.

Bridge target later:

```txt
dependency_graph(path="src")
find_dead_code(path="src")
```

Use only after navigation/editing tools are stable. These are useful but less urgent than read/search/edit.

Priority: P3.

## Parallelism guidance

Kairos has `run_parallel_tools`, but the bridge should not expose a generic parallel shell runner yet.

Prefer safe batch tools:

```txt
read_many_files
search_many_files or search_files with multiple patterns later
bridge_verify_all
```

Avoid for now:

```txt
parallel_run_command
parallel_terminal_start
```

Reason: parallel arbitrary shell is harder to diagnose and can destabilize the local bridge.

## Implementation phases

### v0.4.2: navigation primitives

Status: implemented.

Delivered:

```txt
read_file_lines
read_many_files
search_files
list_files_smart
```

Tests:

- line range pagination
- max line cap
- binary/large file rejection
- search with context
- skip noisy directories
- TS function/class container heuristic

Validation:

```txt
npm run check
npm run build
npm run smoke:http
npm run test:regressions
bridge_self_check
```

### v0.4.3: modular tool registry foundation

Status: implemented as first modular slice.

Delivered:

```txt
src/tools/types.ts
src/tools/file-navigation.ts
src/tools/file-navigation-core.ts
src/tool-registry.ts
```

The first registry-backed module is `file-navigation`, containing:

```txt
read_file_lines
read_many_files
search_files
list_files_smart
```

`bridge-server.ts` no longer keeps tool implementations inline. Tool schemas and handlers are now loaded through the modular registry.

### v0.4.4: shared writing helpers and surgical editing

Status: implemented for file-writing. `bridge_verify_all` remains future work.

Delivered:

```txt
src/tools/shared/text-files.ts
src/tools/shared/line-edits.ts
src/tools/file-writing.ts
edit_lines
modular write_text_file
modular apply_patch
```

Cross-cutting helpers now available:

```txt
text snapshot with bytes/hash/line count
binary-looking file refusal
line ending detection
postflight hash verification
line-range editing with context preview
```

### v0.4.5: code impact intelligence

Status: implemented.

Delivered:

```txt
src/tools/shared/project-scan.ts
src/tools/shared/code-symbols.ts
src/tools/code-intelligence.ts
analyze_code
impact_analysis
find_duplicate_symbols
```

These tools are intentionally lightweight: regex/symbol scanning first, TypeScript compiler API later if needed. They help answer whether a new symbol duplicates an existing one, where a symbol is referenced, and what files may be affected by a refactor.

Cross-cutting helpers now available:

```txt
project text-file scan with skip dirs
symbol extraction
reference classification: definition/import/call/reference
duplicate definition grouping
approximate impact risk summary
```

### v0.4.6: verify-all workflow

Status: implemented.

Delivered:

```txt
scripts/verify-all.ps1
npm run verify:all
src/tools/bridge-workflow.ts
bridge_verify_all
```

This closes the loop for normal bridge work: navigate code, edit safely, check impact, then run one verification workflow.

### v0.4.7: complete modular registry migration

Status: implemented.

Delivered:

```txt
src/tools/core-tools.ts
src/tools/process-tools.ts
src/tools/git-tools.ts
src/tools/bridge-ops.ts
src/tools/metrics-tools.ts
src/tools/shared/process.ts
```

`bridge-server.ts` is now a minimal MCP dispatcher with metrics wrapping. Tool schemas and handlers live in registry modules.

### v0.4.8: TypeScript intelligence

Deliver:

```txt
analyze_code
impact_analysis
```

Start with lightweight regex, then consider TypeScript compiler API.

### v0.5+: deeper project intelligence

Deliver later:

```txt
dependency_graph
find_dead_code
autogenerated tool docs from schemas
tool modules split out of bridge-server.ts
```

## Tool naming preference

Prefer explicit MCP tools over shell:

```txt
read_file_lines over powershell Get-Content
search_files over grep/findstr/Select-String
edit_lines/apply_patch over shell sed/perl
bridge_verify_all over manual command sequence
```

Keep names boring and descriptive. The assistant should know exactly when to use each one.

## Safety notes

Do not include the allowed-roots/denied-path policy in this roadmap phase. That is a separate security design item and should not be mixed into the navigation-tool implementation.

Still preserve existing safety norms:

- no secrets in output
- no `.env` reading
- no `node_modules`, `dist`, logs, SQLite, or binary dumps
- no direct process killing for restart
- no forced Git operations
- no generic parallel shell runner

## Source inspiration from Kairos

Useful Kairos files inspected:

```txt
C:\dev\Kairos\src\tools\rules\list_files.md
C:\dev\Kairos\src\tools\rules\search_files.md
C:\dev\Kairos\src\tools\rules\read_file.md
C:\dev\Kairos\src\tools\rules\edit_file.md
C:\dev\Kairos\src\tools\rules\analyze_code.md
C:\dev\Kairos\src\tools\list_files.py
C:\dev\Kairos\src\tools\search_files.py
C:\dev\Kairos\src\tools\read_file.py
C:\dev\Kairos\src\tools\read_multiple.py
C:\dev\Kairos\src\tools\edit_file.py
C:\dev\Kairos\src\tools\analyze_code.py
C:\dev\Kairos\src\tools\impact_analysis.py
C:\dev\Kairos\src\tools\dependency_graph.py
C:\dev\Kairos\src\tools\find_dead_code.py
C:\dev\Kairos\src\tools\runner.py
C:\dev\Kairos\src\tools\registry.py
C:\dev\Kairos\src\context\templates.py
```

Do not read or copy Kairos secrets such as `.env`.
