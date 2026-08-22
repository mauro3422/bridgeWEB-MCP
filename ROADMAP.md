# bridge-mcp Roadmap

Local MCP bridge for MauroPrime. The goal is to let ChatGPT operate MauroPrime through a controlled OpenAI Secure MCP Tunnel with explicit diagnostics, safe restart flow, Git workflow, metrics, and code intelligence.

## Current status

Current live release: `0.6.108` at `D:\Dev\bridge-mcp`; Situation Model C2f-B Architecture Impact host observation is live on packaged `@mauroprime/mssr` `0.2.34`, while Operational Notice Plane Gate E5 remains closed from the prior release.
Packaged dependency/install: `@mauroprime/mssr` `0.2.34`; verified tarball SHA-256 `f86dd2fd66bf6441d93b61c0dca65e5fe070e3d76ab15de197abbfbb552a2cec`, 498079 bytes.
Live tool catalog remains `156`; C2f-B adds no MCP tool, queue, retry runtime, scheduler or watcher.

0.6.108 adds only the Bridge host filesystem boundary for the portable C2f-A/B contract: exact declared architecture refs are observed on demand as SHA-256/availability evidence and normalized by MSSR. The current canonical MSSR manifest yields 2 architectures / 11 refs, all available in the verified smoke. No baseline/source-set comparison, `possible-impact` classification, Architecture Impact notice, context feedback or reviewed-current receipt exists yet; C2f-C is the next implementation gate.

Do not commit keys, tunnel secrets, `node_modules`, `dist`, logs, SQLite metrics, sandbox files, or tunnel-client binaries.

## Known-good checks

Known-good checks for live v0.6.108:

```txt
bridge_health -> 0.6.108, tunnel live/ready, 156 tools, restart pending=false
live HTTP -> PID 37168 / boot 5bcca910-4660-4129-992b-0c01d6f011f0
watchdog -> PID 27356; controlled C2f-B restart ACK 0514372f-7e3c-422d-8cff-b816da561e36
HTTP-only restart -> tunnel PID 12556 preserved and live/ready
package/source/dist/live -> 0.6.108; packaged/installed MSSR -> 0.2.34
canonical MSSR architecture-impact smoke -> 2 architectures / 11 declared refs, all available; no C2f-C fields
npm run test:regressions -> PASS, exit 0; C2f-B observer + Gate E5 matrix included in aggregate
bridge_verify_all -> PASS, code 0, failedRequired=0 on PID 37168 generation
routing gate -> 210 canonical effective cases, audit healthy
TOOLS.md -> current with 156 registry tools
C2f-B -> on-demand host observation only; no baseline/fingerprint/possible-impact/notice/watcher/queue/new tool
source/vendor MSSR 0.2.34 tarball -> 498079 bytes, SHA-256 f86dd2fd66bf6441d93b61c0dca65e5fe070e3d76ab15de197abbfbb552a2cec
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

### MSSR Context Messages host delivery

Source `0.6.89` integrates Bridge as an adapter for the portable MSSR Context Messages v1 contract. `skill_route_plan` and `skill_bootstrap` accept bounded provider/host-supplied messages, use MSSR's strict schema and selector with normalized intent/stage, return the full selection/decision evidence, and piggyback only selected messages through the existing response notice channel. Bridge preserves provenance, canonical ownership, freshness, evidence, continuation receipts and review-required persistence proposals without executing advisory actions or performing writes.

This is response delivery, not a new durable inbox. Runtime publication/restart and cross-host lifecycle parity remain separate verification gates.

### MSSR Context Plane durable delivery

Bridge consumes the packaged portable Context Plane under canonical `.mssr/runtime/context-inbox.json`. `skill_route_plan`/`skill_bootstrap` select pending evidence and `mssr_context_ack` records explicit receipts/tombstones. Bridge remains the delivery/retention adapter; portable MSSR owns message identity, freshness and acknowledgement semantics. `.bridge/` is not an active MSSR project-authority fallback.

### Project knowledge and change-history governance

Current contract:

```txt
project_context_audit: read-only recursive workspace health/classification under canonical `.mssr`
project_change_consistency: Git + package version + changelogs/<version>.md + INDEX + PROJECT_* impact gate
versioned changelog contract: updated / reviewed-none / pending for PROJECT_CONTEXT, PROJECT_MEMORY and PROJECT_STATE
selective debugging history: load changelogs/INDEX.md + current release only when MSSR intent requires history/recovery
all managed repositories discovered in the verified D:\Dev workspace are explicitly initialized; remaining root-backed memory storage debt is reviewed per-project rather than handled by a mass migration
portable native/Codex/OpenCode/Bridge project-control semantics come from packaged MSSR instead of host-specific copies
no audit, telemetry, health watcher, notice or learning process auto-writes durable project memory
```

Current follow-up:

```txt
keep project_change_consistency as an explicit persistence/publication gate in first-party maintenance workflows
optional project memory follows core + project-context manifest + reference-backed .mssr/knowledge modules; PROJECT_MEMORY.md is not a general module container
use scripts/migrate-project-memory-refs.mjs for conservative already-indexed migrations: check-only by default; --apply requires the exact reviewed ids through --expect, plus hash/collision/concurrency gates and selector/payload readback
Bridge self-migration is complete: six optional memories moved to refs, PROJECT_MEMORY.md 16850 -> 12719 bytes, Project Context Health WATCH -> OK
workspace migration remains reviewed/per-project: a read-only D:\Dev scan found legacy root-backed memory in other repos, including multi-memory fanout in MyceliumFront, pz-furniture-profiler and zomboid-smartwatch-network; no mass/background mutation
MSSR 0.2.51 artifact is staged in vendor with verified SHA, but package/node_modules/live-runtime adoption is intentionally deferred until an explicit safe Bridge restart window
add stronger long-term staleness/receipt semantics only when real post-publication evidence shows the current contract is insufficient
resolve structural REVIEW through reviewed modularization/capture, never through automatic mass splitting or invented project facts
keep cross-host project-control conformance green as host adapters evolve
```

### MSSR first-party core skill package

Current architecture:

```txt
canonical MSSR-owned operational skills live in the MSSR package
"first-party core" does not mean "load on every task"; activation/workflow requirements remain explicit
Codex/OpenCode/native MSSR consume the same portable package/adapter contracts
ChatGPT Web: Bridge discovers and loads the packaged MSSR core directly instead of depending on Mauro's Codex-home copies
Mauro/user/project/plugin skills remain separate external provider catalogs
reserved first-party names surface shadowing/conflict explicitly in routing/audit
cross-host routing/dependency/maintenance conformance is verified in the MSSR suite and should remain a release gate
```

### Operational Notice Plane

Completed in 0.6.99:

```txt
Bridge keeps `bridgeNotices` as the single general notice queue/TTL/history/automatic-response transport
packaged MSSR 0.2.19 owns the pure attention transition policy; Bridge does not clone it
Skill Health and Project Context Health compare each daily observation with the previous persisted snapshot
stable OK/WATCH stays quiet; stable REVIEW with the same bounded fingerprint does not repeat after yesterday's notice was drained
material actionable changes and escalation/deescalation notify; leaving the actionable threshold emits an explicit resolution
suggested notice actions are bounded preflights/recovery hints and never authorization or automatic execution
```

Completed in 0.6.100 / packaged MSSR 0.2.20:

```txt
trace lifecycle idle/missing-outcome is projected through the same portable attention contract
idle alone can open REVIEW but cannot prove completion, synthesize outcome, or become ERROR by itself
explicit progress/outcome resolves idle attention; timer callbacks revalidate a later progress lease before notifying
project-knowledge REVIEW/REQUIRED uses semantic transitions and can now emit changed/escalated/deescalated/resolved instead of a producer-specific key
maintenance attention resolves only after maintenance closes the current lifecycle revision and can reopen after a later material invalidation
Context Plane freshness is current state: fresh=OK, unknown-only=WATCH, stale/unavailable=REVIEW, conflicting=ERROR
fresh evidence clears the current freshness issue count instead of inheriting a monotonic historical maximum
WATCH freshness does not force durable maintenance; accrued maintenance debt still requires an explicit maintenance close
```

Completed through 0.6.105 / packaged MSSR 0.2.26:

```txt
C2a -> provider/tunnel/runtime/restart evidence uses shared semantic transitions instead of treating 502 as proof of failure
C2b -> route/trace/required-skill/required-phase compliance is observable and recoverable through the same attention contract
C2c -> bounded canonical/replica/historical claims expose explicit consistency mismatch and resolution
C2d -> evidence-first-v1 ranks ready/deferred advisory recovery with causal gates, information gain and bounded risk/cost/blast radius
C2e -> Situation Model brings delivered PROJECT_CONTEXT/PROJECT_MEMORY/PROJECT_STATE/changelog/ADR revisions into C2c/C2d; Bridge watches active receipts across managed projects and emits classified context-refresh/consistency transitions through bridgeNotices
```

Next:

```txt
C2e-D -> explicit contract-defined semantic claim producers for selected project facts (release/state/ownership/decision revisions), never arbitrary prose-to-truth inference
C2e-E -> feed active Situation attention back into bounded context selection so smaller maintenance agents can refresh the minimum stale/missing authority for later larger-agent work
C2f/shadow -> collect recommendation/outcome calibration metadata before any learned policy can influence ranking; replay/calibration/feature flag/rollback remain mandatory
continue project-specific watchers only where the evidence contract is reusable, privacy-bounded and advisory
```

The bridge covers the normal inspect/edit/verify/Git loop, project workflow guides, image/Blender work, resumable binary transport and a general operational notice delivery surface. Avoid broad architecture rewrites until real usage exposes a concrete gap.

## Rollback

`stdio` rollback remains available:

```powershell
Set-Location D:\Dev\bridge-mcp
.\scripts\start-bridge-watchdog.ps1 -ProjectRoot D:\Dev\bridge-mcp
```
