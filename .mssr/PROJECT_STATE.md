# Bridge project state
## Current local release and recovery (2026-11-14)
**Active runtime:** Bridge 0.6.188 PID `27836`, boot `7fcaceaf-6275-42f0-8bea-303d2de23b12`, started `2026-11-14T02:52:39.281Z`. `/status` is ready and `/readyz` on 3001 plus the preserved tunnel on 8081 both return `ready`; no restart is pending. Watchdog restarted only the tunnel after 9 then 3 readiness failures; last ACK `6afd9ef7-04f7-4e56-be38-c9b4c2cfae72` at 02:53:13Z (replacement PID 19000). Per-probe cause was not logged.
**Validated 0.6.188 source:** commits `2d2c7bc` (dashboard summary database-read reduction) and `a7e89eb` (runtime version alignment). Full MCP summary totals remain intact; dashboard projections skip unused all-history totals and aggregate active totals in SQLite while preserving pending-write overlays.
**Runtime observation (2026-11-14 03:14Z):** metrics persistence had 0 failures/drops, 162/164 calls completed and 2 pending; latest passive WAL checkpoint succeeded. `/status` recorded max event-loop lag 3,065 ms and 18 stalls; dashboard workers were idle. A fresh read-only worker snapshot previously timed out against live SQLite. Do not repeat on live data. An interrupted copy at `D:\Temp\bridge-cold-probe-b9ea47e92d4d4a23a782b1e7c0d87d3c` is not validated (605,941,760-byte database plus 1-KiB journal); leave it untouched. Consistent isolated profiling and a cold-cache SLO remain open.
**MSSR adoption:** Bridge vendors `@mauroprime/mssr` 0.2.147 (SHA-256 `007951A27E409F4F3B0CA872FDE54294F4DBB96E296D40FA85AA413B0E9295D3`); isolated cross-repo lifecycle tests pass. MSSR source 0.2.157 passed local `npm run verify`, but the public registry returns 404; it is not yet available as a registry package.
**MSSR context health:** valid manifest, 31 modules, no missing sources or unindexed knowledge; grouping/budget advisories remain.
**Pending:** capture per-probe tunnel readiness errors; profile a consistent isolated SQLite snapshot; finish authorized generic-MIME import/hash/no-overwrite check; refresh the ChatGPT Web catalog; review 7 heuristic refs (4 medium, 3 low) and 4 older refs. Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
