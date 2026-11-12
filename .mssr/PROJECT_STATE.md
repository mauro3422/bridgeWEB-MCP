# Bridge project state
## Current local release and recovery (2026-11-06)
**Readback updated 2026-11-12.**

**Release/runtime:** Bridge 0.6.184 is live at `D:\Dev\bridge-mcp\dist\http.js`, PID 23192, boot `81f9bd5a-7cc0-47a1-a8ab-71173b5adbb2`, HTTP 3001 ready. Tunnel 8081 is ready, PID 18540. Bambu child PID 26580 runs the standalone provider from 2026-11-11 and still has its earlier 47-tool catalog; source v0.12.0 is newer. No Studio windows were listed; printer connectivity is unknown.

**Local candidate:** Bridge 0.6.185 adds confirmed Bambu-only stdio replacement and completes authorized image-import MIME validation. Check, Bambu contract, image import, MCP dual-era, isolated HTTP, generated tool-doc and full regression checks pass. Staged Project Change Consistency returned `publishReady: true`; its review advisory was handled by compacting this state. 0.6.185 has not been activated in production.

**Git/preservation:** Before the candidate, local `main`, `origin/main` and direct remote `main` matched at `034be0198a91ad7f94a4f74ad98871a2c4836572`; there was one registered worktree and no stashes/local-only commits. Three Bridge handoffs were updated. Untracked workflow guides from other tasks remain preserved outside this release. A SHA-256 snapshot is at `D:\MSSR\safety-snapshots\bridge-20261112-033919`; the superseded long state snapshot is `PROJECT_STATE.before-compaction.md` there.

**Pending:** first activation of 0.6.185 requires one controlled Bridge HTTP deployment; no production process or tunnel has been restarted. After activation, Bambu source refresh can use `bambu_mcp_reconnect` without restarting Bridge or the tunnel. Read back `/status`, boot id, catalog and both readiness endpoints before claiming deployment. Historical release detail lives in `changelogs/`; the 2026-09 project-state snapshot remains indexed in `knowledge/operations/bridge-state-history-2026-09.md`.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
