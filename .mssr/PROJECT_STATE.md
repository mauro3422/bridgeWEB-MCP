# Bridge project state
## Current local release and recovery (2026-11-13)
**Active runtime:** Bridge 0.6.187 PID `44544`, boot `d46f4001-fc63-4dbd-8258-70923e6d7e7b`; `/status` ready, Bridge/tunnel readiness HTTP 200, runtime-health `ok`. Watchdog PID `15424` acknowledged `restart-http` request `10261244-2fbc-48fc-88ba-b4d1d6f6654d`; short catalog check found the new transaction, notice-history and restart tools. HTTP runtime replaced; tunnel preserved.

**Released 0.6.187:** pins reviewed MSSR 0.2.147 (SHA-256 `007951A27E409F4F3B0CA872FDE54294F4DBB96E296D40FA85AA413B0E9295D3`; contract minimum 0.2.142). Lifecycle notices and the journaled one-file cross-repo transaction passed gates. Commit `1f055a2d3521188c1b06907241dee976f7cdd817` is on `origin/main`.

**Runtime observation:** HTTP smoke stopped at MSSR summary/dashboard. Runtime stayed ready (`ok`), but diagnostics showed max event-loop lag `45,617ms`, 15 stalls (latest `1,419ms`) and 49 client errors. Cause is unconfirmed; investigate before another broad smoke.

**MSSR context health:** valid manifest, 31 modules, no missing sources/unindexed knowledge; existing grouping and budget advisories remain.

**Pending:** diagnose runtime latency; fresh Codex catalog and ChatGPT Web `Unknown tool` checks; generic-MIME import hash/no-overwrite check; review four old refs. Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
