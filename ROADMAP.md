# bridge-mcp Roadmap

Local MCP bridge for MauroPrime. The goal is to let ChatGPT operate MauroPrime through a controlled OpenAI Secure MCP Tunnel with explicit diagnostics, safe restart flow, Git workflow, metrics, and code intelligence.

## Current status

```txt
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.6.86
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Rollback profile: stdio through scripts/start-bridge-watchdog.ps1
Runtime tools: 146 (live on 0.6.86)
```

Do not commit keys, tunnel secrets, `node_modules`, `dist`, logs, SQLite metrics, sandbox files, or tunnel-client binaries.

## Known-good checks

Known-good checks for live v0.6.86:

```txt
bridge_self_check -> ok true
bridge_verify_all -> ok true
npm run check -> OK
npm run build -> OK
scripts/test-bridge-http.ps1 -> OK
scripts/test-bridge-regressions.ps1 -> OK
http://127.0.0.1:3001/status -> bridge-mcp v0.6.85
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
project
workspace
cache
bridge-ops
metrics
code-intelligence
code-graph
python-analysis
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
git_diff
git_log
git_show_commit
git_compare_branches
git_create_branch
git_restore_file
git_set_remote
git_commit_all
git_push_current_branch
```

Project / safety:

```txt
path_policy_status
project_profile
project_profile_save
```

Workspace recovery:

```txt
workspace_snapshot
workspace_diff
workspace_rollback
workspace_snapshot_list
```

Persistent cache:

```txt
cache_status
cache_prune
```

Bridge ops:

```txt
tunnel_health
bridge_health
bridge_self_check
bridge_verify_all
bridge_request_restart
bridge_restart_status
```

Metrics / visualizations:

```txt
bridge_metrics_query
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
call_graph
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

### Completed through v0.6.6

```txt
108 tools across 22 modules
fresh TabletWhiteboard PC viewport capture with attached PNG results, latest/list album tools and private-LAN guards
project context bootstrap and reusable workflow guides
image asset persistence and character-view normalization
interactive/batch Blender control and character reference scenes
multi-view Blender review bundles with contact-sheet image results and structured geometry/rig/animation diagnostics
safe binary file info/read/write tools
resumable binary uploads with ordered chunks, status, finish and abort
byte/SHA-256 validation, atomic commits and stale-session cleanup
allowed-root / denied-path policy with canonical-path and sensitive-file checks
bounded Git, workspace recovery, cache, metrics and code-analysis tools
TOOLS.md generated from the runtime registry
regressions and live HTTP verification expanded for the full surface
```

### MSSR learning-loop host integration

Completed in the current unreleased cycle:

```txt
ChatGPT Web host-gated optional skill selection: recommended -> accepted/skipped -> loaded
privacy-bounded skill_decision telemetry grouped by semantic task signature
RAM-only per-trace working metadata with outcome/restart purge
strict outcome-time learning_digest distillation before RAM purge
learning digest excludes workingSummary/active hypotheses and keeps only evidence-backed structured consequences
exact-signature skill, stage-transition and skill/project-context priors with a minimum evidence threshold
dashboard tables for accepted/skipped decisions plus historical priors
explicit closure preflight with closureDue and nextRequiredAction
stale-open traces remain resumable by explicit traceId but stop competing in loose auto-recovery
persisted maintenance phase reconstruction matches the portable MSSR reducer
focused Bridge regressions plus authenticated external skill_decision/learning-digest compatibility
```

Next MSSR learning work is **data collection and validation, not feedback activation**. Keep `routingInfluence=false` while strict digests accumulate. Then audit dataset quality, run historical replay/holdout, calibrate confidence/decay/staleness, and run a future shadow decision model on new traces. Only if those gates show repeatable benefit should a separately reviewed/versioned feature flag allow a bounded secondary historical contribution with exploration and instant rollback. Vector similarity may later retrieve nearby evidence, but remains secondary and must be evaluated independently.

### Project knowledge and change-history governance

Completed in source 0.6.86:

```txt
project_context_audit: read-only workspace classification of modular / legacy / invalid / empty / not-initialized project authorities
project_change_consistency: Git + package version + changelogs/<version>.md + INDEX + PROJECT_* impact gate
versioned changelog contract: updated / reviewed-none / pending for PROJECT_CONTEXT, PROJECT_MEMORY and PROJECT_STATE
selective debugging history: load changelogs/INDEX.md + current release only when MSSR intent requires history/recovery
Bridge and MSSR now own real modular .bridge PROJECT_CONTEXT / PROJECT_MEMORY / PROJECT_STATE authorities
legacy changelog preserved under changelogs/LEGACY.md; no automatic full-history injection
no audit, telemetry or learning process auto-writes durable project memory
```

Still pending:

```txt
migrate active legacy projects only after reading their real repository evidence
extend the same authority/change-consistency contract to Codex/OpenCode/native MSSR hosts
add long-term staleness/receipt semantics if working-tree evidence proves insufficient after publication
use project_change_consistency as an explicit persistence/publication gate in first-party MSSR maintenance workflows
```

### MSSR first-party core skill package

Next architecture phase:

```txt
move the canonical source of MSSR-owned operational skills into the MSSR package
first audit/strengthen mssr-agent-routing, shared-skill-governance, skill-routing-maintainer, skill-maintenance-loop and on-demand mssr-observability-maintenance
"first-party core" does not mean "load on every task"; activation/workflow requirements remain explicit
Codex: install/mount the packaged core skills into native discovery without maintaining copied editable sources
OpenCode: consume the same packaged core through its MSSR adapter
ChatGPT Web: Bridge discovers the MSSR package directly instead of depending on Mauro's Codex-home copy
keep Mauro/user/project/plugin skills as separate external provider catalogs
reserve first-party names or surface shadowing as an explicit conflict
add cross-host conformance tests for version, routing metadata, dependency closure, maintenance and learning-digest behavior
```

### Next implementation work

```txt
use `blender_review_bundle` to drive evidence-based CBAnimal character refinements
exercise v0.6.6 mixed text/image tool results through the live connector
add further convenience tools only when repeated friction is observed
consider native connector file parameters if the MCP/client surface exposes them
continue improving code graphs only from real project failures
```

The bridge covers the normal inspect/edit/verify/Git loop, project workflow guides, image/Blender work and resumable binary transport. Avoid broad architecture rewrites until real project usage exposes a concrete gap.

## Rollback

`stdio` rollback remains available:

```powershell
Set-Location C:\dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```
