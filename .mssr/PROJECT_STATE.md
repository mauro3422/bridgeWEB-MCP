# Bridge project state
## Current local release and recovery (2026-11-13)
**Pre-release runtime:** Bridge 0.6.185 PID `26100`, boot `af13f224-3575-43d3-a9c2-984cd889f941`, `127.0.0.1:3001/mcp`; Bridge/tunnel readiness and runtime health were good. This process predates the package update and used MSSR 0.2.134.

**Candidate 0.6.187:** pins reviewed `@mauroprime/mssr` 0.2.147, SHA-256 `007951A27E409F4F3B0CA872FDE54294F4DBB96E296D40FA85AA413B0E9295D3` (contract minimum 0.2.142). Lifecycle notices, ambiguous-route blocking, and reviewed one-file cross-repo stage/journal/readback/replay/recovery/rollback/pointer-gated commit are verified. TypeScript, build, MSSR integration, continuation, project health/context, tools-doc, and full regressions pass. Runtime activation remains pending.

**MSSR context health:** manifest valid, 31 modules, no missing sources or unindexed knowledge. Existing grouping and selected-module budget advisories remain.

**Pending:** publish then activate 0.6.187 through the production watchdog; verify PID/boot, readiness, runtime health, ack and tool catalog. The historical `traceId=null` mechanism is reproduced: two compatible routes lacked a unique 90-second dominant candidate, and the write remains safely blocked. Also pending: fresh Codex catalog discovery, ChatGPT Web `Unknown tool` reproduction, authorized generic-MIME import hash/no-overwrite check, and review of four old refs.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
