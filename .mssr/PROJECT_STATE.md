# Bridge project state
## Current local release and recovery (2026-11-13)
**Active runtime:** Bridge 0.6.188 PID `27544`, boot `ea0d6f19-6faa-49a2-a83c-bce65d94f3e3`, started `2026-11-14T00:52:48.879Z`. Watchdog PID `15424` acknowledged HTTP-only restart request `e4caf00a-187b-4abc-8d43-ddad32c496b7` at `2026-11-14T00:52:39.3615105Z`. Bridge `/readyz` on port 3001 and the preserved tunnel `/readyz` on port 8081 both returned `ready`.

**Validated 0.6.188 source:** commits `2d2c7bc` (dashboard summary database-read reduction) and `a7e89eb` (runtime version alignment) contain the verified source changes. Full MCP summary totals remain intact; the dashboard projection skips unused all-history totals and computes active totals with a SQLite aggregate while preserving the pending-write overlay path.

**Runtime observation (2026-11-14 02:02:06Z):** Bridge, tunnel, and read worker were ready (`pendingCount=0`). A fresh read-only worker snapshot timed out at 120s against the shared live database. Do not repeat against the active database; use an isolated snapshot or fixture. See [incident evidence](../../docs/INCIDENTS.md#dashboard-read-amplification-follow-up-2026-11-13). Startup readiness failure cause remains unknown.

**MSSR context health:** valid manifest, 31 modules, no missing sources/unindexed knowledge; existing grouping and budget advisories remain.

**Pending:** profile a full snapshot from a consistent isolated SQLite copy and define a cold-cache SLO; diagnose the failed activation with startup evidence; refresh Codex/ChatGPT Web catalogs and check Bambu status (see [Bambu window status handoff](../docs/HANDOFF_BAMBU_WINDOW_STATUS_2026-11-09.md) and [selective reconnect handoff](../docs/HANDOFF-BAMBU-MCP-SELECTIVE-RECONNECT-2026-11-12.md)); run the authorized generic-MIME import/hash/no-overwrite check (see [image import handoff](../docs/HANDOFF-IMAGE-ASSET-IMPORT-2026-11-12.md)); review 7 heuristic reference candidates (4 medium, 3 low; none high) and identify the separately noted four old refs. No knowledge is unindexed. Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
