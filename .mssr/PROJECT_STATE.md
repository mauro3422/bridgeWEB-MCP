# Bridge project state
## Current local release and recovery (2026-11-13)
**Active runtime:** Bridge 0.6.188 PID `27544`, boot `ea0d6f19-6faa-49a2-a83c-bce65d94f3e3`, started `2026-11-14T00:52:48.879Z`. Watchdog PID `15424` acknowledged HTTP-only restart request `e4caf00a-187b-4abc-8d43-ddad32c496b7` at `2026-11-14T00:52:39.3615105Z`. Bridge `/readyz` on port 3001 and the preserved tunnel `/readyz` on port 8081 both returned `ready`.

**Validated 0.6.188 source:** commits `2d2c7bc` (dashboard summary database-read reduction) and `a7e89eb` (runtime version alignment) contain the verified source changes. Full MCP summary totals remain intact; the dashboard projection skips unused all-history totals and computes active totals with a SQLite aggregate while preserving the pending-write overlay path.

**Runtime observation (bounded live readback, 2026-11-14 01:03:35Z):** `/api/mssr/summary?days=1&scope=active` returned HTTP 200 in 703 ms with a 69,766-character response. `/status` showed the dashboard read worker ready with `pendingCount=0`; the snapshot worker is lazy. Event-loop maximum lag was 543 ms with 11 recorded stalls; the latest was 372 ms at `00:59:43.250Z`. A first candidate activation did not become ready and was recovered by the watchdog; the later acknowledged request above activated 0.6.188. No cause was established for that first readiness failure. The earlier cumulative event-loop maximum of 45,617 ms predates this runtime and is not attributed to the summary request.

**MSSR context health:** valid manifest, 31 modules, no missing sources/unindexed knowledge; existing grouping and budget advisories remain.

**Pending:** capture cold-cache summary latency separately; fresh Codex catalog and ChatGPT Web `Unknown tool` checks; generic-MIME import hash/no-overwrite check; identify and review the four old refs (their exact identities have not been established by the current health report). Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
