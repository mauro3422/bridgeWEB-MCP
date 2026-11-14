# Bridge project state
## Current local release and recovery (2026-11-14)
**Active runtime:** Bridge 0.6.188 PID `27836`, boot `7fcaceaf-6275-42f0-8bea-303d2de23b12`; at 05:35Z `/status` and readiness were good on 3001/8081, with 15 sessions (7 active requests, 8 idle). No restart is pending. Diagnostics show 148 stalls (11,303 ms max lag; last 461 ms at 05:34:34Z) and 14 client errors (last 05:35:23Z); causes are unknown. Do not restart while requests are active.
**Source release:** Bridge 0.6.189 is published to `origin/main` at commit `d267d32` with exact MSSR 0.2.158 bytes (SHA-256 `7a76c13c4f287221be8ce4395d2861a88210a480872b03a4d2767abf5f13cb8d`). `npm run check`, build, project-consistency, lifecycle integration and Project Context suites pass; see `changelogs/0.6.189.md`. Runtime 0.6.188 is still active.
**MSSR hosts:** active Bridge remains pinned to 0.2.147 until 0.6.189 activates. Codex-local MCP reports 0.2.157 and has no supported safe reload path identified. Public npm registry returns 404; no registry publish was attempted.
**Project Context health:** valid manifest, 31 modules, no missing sources or unindexed knowledge. After compacting the current-state core to 1,702 bytes, health is `WATCH` with no `REVIEW` findings; grouping and four module-budget notices remain advisory.
**Pending:** activate 0.6.189 after sessions drain or a planned safe window; adopt MSSR 0.2.158 in Codex-local MCP when supported reload is available; capture per-probe tunnel readiness errors; profile a consistent isolated SQLite snapshot; finish authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 7 heuristic refs (4 medium, 3 low) and 4 older refs. Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
