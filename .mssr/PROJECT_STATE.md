# Bridge project state
## Current local release and recovery (2026-11-14)
**Active runtime:** Bridge 0.6.188 PID `27836`, boot `7fcaceaf-6275-42f0-8bea-303d2de23b12`; health/readiness last confirmed at 05:20Z, with HTTP 200 on 3001 and tunnel 8081. The 05:19Z `/status` reported 13 sessions; no restart is pending. Keep the runtime untouched until sessions drain or a safe maintenance window is confirmed.
**Source candidate:** isolated branch `codex/bridge-mssr-0.2.158` contains Bridge 0.6.189 and exact MSSR 0.2.158 bytes (SHA-256 `7a76c13c4f287221be8ce4395d2861a88210a480872b03a4d2767abf5f13cb8d`). `npm run check`, build, project-consistency, lifecycle integration and Project Context suites pass; see `changelogs/0.6.189.md`. Candidate is not published or active.
**MSSR hosts:** active Bridge remains pinned to 0.2.147; the candidate uses 0.2.158. Codex-local MCP reports 0.2.157 and has no supported safe reload path identified. Public npm registry returns 404; no registry publish was attempted.
**Project Context health:** valid manifest, 31 modules, no missing sources or unindexed knowledge. After compacting the current-state core to 1,702 bytes, health is `WATCH` with no `REVIEW` findings; grouping and four module-budget notices remain advisory.
**Pending:** publish and safely activate 0.6.189 after sessions drain; adopt MSSR 0.2.158 in Codex-local MCP when supported reload is available; capture per-probe tunnel readiness errors; profile a consistent isolated SQLite snapshot; finish authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 7 heuristic refs (4 medium, 3 low) and 4 older refs. Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
