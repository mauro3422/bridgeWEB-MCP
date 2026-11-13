# Bridge project state
## Current local release and recovery (2026-11-13)
**Active runtime:** Bridge 0.6.187 PID `44544`, boot `d46f4001-fc63-4dbd-8258-70923e6d7e7b`; `/status` ready, Bridge/tunnel readiness HTTP 200, runtime-health `ok`. Watchdog PID `15424` acknowledged `restart-http` request `10261244-2fbc-48fc-88ba-b4d1d6f6654d`; short catalog check found the new transaction, notice-history and restart tools. HTTP runtime replaced; tunnel preserved.

**Released 0.6.187:** pins reviewed MSSR 0.2.147 (SHA-256 `007951A27E409F4F3B0CA872FDE54294F4DBB96E296D40FA85AA413B0E9295D3`; contract minimum 0.2.142). Lifecycle notices and the journaled one-file cross-repo transaction passed gates. Commit `1f055a2d3521188c1b06907241dee976f7cdd817` is on `origin/main`.

**Runtime observation (latest bounded readback, 2026-11-13):** the HTTP smoke stopped while waiting on MSSR summary/dashboard. The latest local `/status` read showed Bridge ready, observability storage ready, and the dashboard read worker PID `44220` ready with `pendingCount=0`. Cumulative event-loop max lag remains `45,617ms`; stall count is now 87, with the latest stall `374ms` at `2026-11-13T21:55:52.941Z`. HTTP `clientErrors` remains 73; the latest was `2026-11-13T21:34:48.824Z`. These counters do not establish an HTTP 500 or identify the cause of the historical maximum. No new broad summary query was run; isolate and profile it before another full smoke.

**MSSR context health:** valid manifest, 31 modules, no missing sources/unindexed knowledge; existing grouping and budget advisories remain.

**Pending:** isolate and profile summary/dashboard latency; fresh Codex catalog and ChatGPT Web `Unknown tool` checks; generic-MIME import hash/no-overwrite check; review four old refs. Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
