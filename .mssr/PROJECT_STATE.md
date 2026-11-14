# Bridge project state
## Current local release and recovery (2026-11-14)
**Active runtime:** Bridge 0.6.189 PID `20388`, boot `adc5296e-a075-4249-a1ad-42bd971ce042`; started 06:04Z. At 06:04:39Z `/status` and readiness were good on 3001/8081, with 0 sessions, stalls, and client errors. HTTP watchdog restarted; tunnel PID `19000` stayed up.
**Source release:** Bridge 0.6.189 is published to `origin/main` at commit `d267d32` with exact MSSR 0.2.158 bytes (SHA-256 `7a76c13c4f287221be8ce4395d2861a88210a480872b03a4d2767abf5f13cb8d`). Main install, `npm run check`, and build now pass; lifecycle integration and Project Context suites passed on the isolated candidate. See `changelogs/0.6.189.md`.
**MSSR hosts:** active Bridge loads 0.2.158. Codex-local MCP reports 0.2.157 and has no supported safe reload path identified. Public npm registry returns 404; no registry publish was attempted.
**Project Context health:** valid manifest, 31 modules, no missing sources or unindexed knowledge. Health is `WATCH` with no `REVIEW` findings; 10 documentation-reference candidates and four module-budget notices remain advisory.
**Pending:** adopt MSSR 0.2.158 in Codex-local MCP when a supported reload path is available; investigate the prior 156 stalls and 14 HTTP client errors from the 0.6.188 runtime; capture per-probe tunnel readiness errors; profile a consistent isolated SQLite snapshot; finish authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 10 reference candidates (4 medium, 6 low). Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
