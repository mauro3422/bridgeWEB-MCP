# bridge-mcp Roadmap

Local MCP bridge for MauroPrime. The goal is to let ChatGPT operate MauroPrime through a controlled OpenAI Secure MCP Tunnel with explicit diagnostics, safe restart flow, Git workflow, metrics, and code intelligence.

## Current status

```txt
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.5.1
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Rollback profile: stdio through scripts/start-bridge-watchdog.ps1
Tools exposed: 36
```

Do not commit keys, tunnel secrets, `node_modules`, `dist`, logs, SQLite metrics, sandbox files, or tunnel-client binaries.

## Known-good checks

Known-good checks for v0.5.1:

```txt
bridge_self_check -> ok true
bridge_verify_all -> ok true
npm run check -> OK
npm run build -> OK
scripts/test-bridge-http.ps1 -> OK
scripts/test-bridge-regressions.ps1 -> OK
http://127.0.0.1:3001/status -> bridge-mcp v0.5.1
http://127.0.0.1:8081/healthz -> live
http://127.0.0.1:8081/readyz -> ready
git -> ## main...origin/main
```

If anything points at `8080`, treat it as stale context unless the active profile was intentionally changed.

## Current architecture

```txt
src/bridge-server.ts
  minimal MCP dispatcher with metrics wrapping

src/tool-registry.ts
  modular registry

src/tools/*.ts
  tool modules by domain

src/tools/shared/*.ts
  cross-cutting helpers
```

Current modules:

```txt
core
file-navigation
file-writing
process
git
bridge-ops
metrics
code-intelligence
code-graph
bridge-workflow
```

## Current tool groups

Core / navigation:

```txt
system_info
list_dir
read_text_file
read_file_lines
read_many_files
list_files_smart
search_files
```

Writing:

```txt
write_text_file
apply_patch
edit_lines
```

Process / terminal:

```txt
run_command
terminal_start
terminal_write
terminal_read
terminal_stop
terminal_list
```

Git:

```txt
git_status
git_set_remote
git_commit_all
git_push_current_branch
```

Bridge ops:

```txt
tunnel_health
bridge_self_check
bridge_verify_all
bridge_request_restart
bridge_restart_status
```

Metrics / visualizations:

```txt
bridge_metrics_status
bridge_metrics_summary
bridge_metrics_recent
bridge_visualization_catalog
bridge_visualize_metrics
```

Code intelligence:

```txt
analyze_code
impact_analysis
find_duplicate_symbols
import_graph
dependency_graph
find_dead_code
```

Code intelligence engines:

```txt
regex
TypeScript AST
semantic TypeScript Program/TypeChecker
TypeScript module resolver
```

`import_graph` and `dependency_graph` support:

```txt
resolutionEngine=auto|relative|typescript
```

`impact_analysis` and `find_dead_code` support semantic mode through TypeScript `Program` and `TypeChecker`.

## Completed implementation history

### v0.4.2: navigation primitives

Delivered:

```txt
read_file_lines
read_many_files
search_files
list_files_smart
```

### v0.4.3: modular registry foundation

Delivered:

```txt
src/tools/types.ts
src/tools/file-navigation.ts
src/tools/file-navigation-core.ts
src/tool-registry.ts
```

### v0.4.4: shared writing helpers and surgical editing

Delivered:

```txt
src/tools/shared/text-files.ts
src/tools/shared/line-edits.ts
src/tools/file-writing.ts
write_text_file
apply_patch
edit_lines
```

### v0.4.5: code impact intelligence

Delivered:

```txt
src/tools/shared/project-scan.ts
src/tools/shared/code-symbols.ts
src/tools/code-intelligence.ts
analyze_code
impact_analysis
find_duplicate_symbols
```

### v0.4.6: verify-all workflow

Delivered:

```txt
scripts/verify-all.ps1
npm run verify:all
src/tools/bridge-workflow.ts
bridge_verify_all
```

### v0.4.7: complete modular registry migration

Delivered:

```txt
src/tools/core-tools.ts
src/tools/process-tools.ts
src/tools/git-tools.ts
src/tools/bridge-ops.ts
src/tools/metrics-tools.ts
src/tools/shared/process.ts
```

`bridge-server.ts` is now a minimal MCP dispatcher. Tool schemas and handlers live in registry modules.

### v0.4.8: TypeScript AST intelligence

Delivered:

```txt
src/tools/shared/typescript-intelligence.ts
analyze_code engine=auto|regex|typescript
impact_analysis engine=auto|regex|typescript
find_duplicate_symbols engine=auto|regex|typescript
```

### v0.4.9: import graph and dead-code candidates

Delivered:

```txt
src/tools/shared/import-graph.ts
src/tools/code-graph.ts
import_graph
dependency_graph
find_dead_code
```

### v0.5.0: semantic TypeScript program engine

Delivered:

```txt
src/tools/shared/typescript-program.ts
impact_analysis engine=semantic
find_dead_code engine=semantic
```

This builds a TypeScript `Program` and `TypeChecker`, groups symbols by actual declarations, resolves alias symbols, and separates definition/import/export/call/type/reference usages.

### v0.5.1: TypeScript module resolution for dependency graph

Delivered:

```txt
import_graph resolutionEngine=auto|relative|typescript
dependency_graph resolutionEngine=auto|relative|typescript
TypeScript tsconfig/module resolver inside src/tools/shared/import-graph.ts
```

The dependency graph now uses TypeScript module resolution when requested or in auto mode, so `tsconfig` `baseUrl`, `paths`, extension rewriting, and barrel/index files are handled by the compiler resolver instead of only relative string matching.

## Operational flow

Normal coding flow:

```txt
plan
-> inspect with read/search/analyze/graph tools
-> edit with apply_patch or edit_lines
-> npm run check
-> npm run build
-> smoke/regressions
-> bridge_verify_all when runtime is involved
-> commit
-> push
```

Preferred all-in-one verifier:

```txt
bridge_verify_all
```

or:

```powershell
npm run verify:all
```

## Next recommended work

### Performance and caching

Useful next step, but not urgent:

```txt
cache TypeScript Program by tsconfig + mtimes/hash
cache import graph by root + engine + mtimes/hash
cache semantic impact indexes by project root
add cache invalidation after writes
```

Reason: `impact_analysis`, `dependency_graph`, and `find_dead_code` are now accurate enough to benefit from caching on larger repos.

### Generated tool docs

Generate docs from `src/tool-registry.ts` / module schemas:

```txt
scripts/generate-tool-docs.ts
TOOLS.md
```

### Test coverage

Add targeted tests for:

```txt
tsconfig paths/baseUrl resolution
barrel/index resolution
semantic alias resolution
find_dead_code exported symbol behavior
restart-request lifecycle
metrics SQLite availability without leaking arguments
```

### Later safety work

Allowed roots / denied path policy is intentionally not implemented yet. Keep it as a separate design item so it does not destabilize the active bridge.

## Rollback

`stdio` rollback remains available:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```
