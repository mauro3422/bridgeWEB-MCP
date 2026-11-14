# Bridge project state
## Current local release and recovery (2026-11-14)
**Source:** Bridge 0.6.190 is published to `origin/main` at `ebaa0bf` with the verified MSSR 0.2.159 artifact (SHA-256 `1d85893cd0dee0f012486df9c80c24abac5a2e3ea39608b0cf023170470823cb`). Offline install, check/build, Project Context, selective-skill, MSSR/lifecycle/ownership and route/bootstrap regressions pass; see `changelogs/0.6.190.md`.
**Runtime:** Bridge 0.6.190 PID `37992`, boot `07fef598-9d7f-4d0e-b6c9-7b02dce136cb`, started 07:17Z. At 07:19Z `/status` was ready with 1 session, 0 stalls (87 ms max lag) and 0 client errors; HTTP health/readiness on 3001 and tunnel health/readiness on 8081 returned 200. Watchdog PID `19504` runs HTTP-only; tunnel PID `19000` was preserved.
**Project Context:** MSSR 0.2.159 health is `WATCH` with no `REVIEW`: one area-grouping and three module-budget pressure advisories. `project_change_consistency` is `publishReady=true` with no issues.
**MSSR hosts:** Bridge loads 0.2.159. Codex-local MCP was last observed at 0.2.157; no supported safe reload path was found, so it remains separate and untouched. The public npm registry previously returned 404; Bridge uses the exact vendored artifact.
**Pending:** resolve a safe Codex-local MSSR reload; investigate historical 0.6.188 stalls/client errors and per-probe tunnel readiness; profile an isolated SQLite snapshot; finish authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 10 reference candidates (4 medium, 6 low). Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
