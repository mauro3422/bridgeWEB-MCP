# Bridge project state
## Current local release and recovery (2026-11-14)
**Source candidate:** Bridge 0.6.190 is isolated on `codex/bridge-mssr-0.2.159`, based on `256d675`. It vendors the verified MSSR 0.2.159 artifact (SHA-256 `1d85893cd0dee0f012486df9c80c24abac5a2e3ea39608b0cf023170470823cb`); check, build, Project Context, selective-skill and route/bootstrap research-context regressions pass. See `changelogs/0.6.190.md`.
**Bridge runtime:** HTTP on 3001 is currently offline (`/status`, `/healthz`, `/readyz` refuse connections). Tunnel PID `19000` remains healthy on 8081. No Bridge HTTP process or watchdog is running after the host restart. The last runtime version observed before shutdown was 0.6.189; activate and read back 0.6.190 after the verified source reaches `main`.
**Candidate Project Context health:** MSSR 0.2.159 reports `WATCH`, no `REVIEW` findings, one area-grouping advisory and four module-budget pressure advisories. This is read directly from the candidate's installed 0.2.159 package.
**MSSR hosts:** Bridge runtime version is unreadable while HTTP is offline. Codex-local MCP reload remains a separate host operation and was not changed by this candidate. The public npm registry previously returned 404; the exact package stays vendored.
**Pending:** merge the verified candidate into local `main`, install and start the HTTP watchdog without stopping the healthy tunnel, then verify Bridge 0.6.190 on 3001 and tunnel readiness on 8081. Separately review the Codex-local MSSR reload path; investigate historical 0.6.188 stalls/client errors and per-probe tunnel readiness; profile an isolated SQLite snapshot; finish authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 10 reference candidates (4 medium, 6 low). Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
