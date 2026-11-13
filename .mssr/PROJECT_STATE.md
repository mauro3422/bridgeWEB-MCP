# Bridge project state
## Current local release and recovery (2026-11-12)
**Live check (2026-11-13 02:11Z):** Bridge 0.6.185 PID `26100`, loopback host `127.0.0.1:3001`, MCP path `/mcp`, `allowRemote=false`; Bridge and tunnel `/readyz` return HTTP 200 `ready`. Codex global config now has enabled `MauroPrime_Bridge` at this endpoint. The repository verifier and a Streamable HTTP MCP client successfully listed and called `bridge_health`; `project_context_load` also returned with zero context warnings. The already-running Codex chat did not add native Bridge tools to its current model catalog; discovery after a fresh Codex session remains unverified. The separate `BrigdeMCP-WEB` connector tools still report unavailable to this model; cause for that remote path is unconfirmed.

**Bambu:** `bambu_mcp_status` over the local Bridge MCP connected to `bambu-studio-mcp` `0.13.1`, 50 tools, generation 2, not refreshing. No Studio, AMS or printer operations were issued.

**Git:** one `main` worktree. Commits `b431960` (three guides), `9cd7664` (prior state refresh) and the current connection-state refresh leave `main` three commits ahead of `origin/main` at `c3fb706b8ca0c1d921abc7045d5e1a476f6d88dd`. No push was made. Four old remote refs remain unmerged; review found no missing behavior, and none were changed.

**MSSR:** valid manifest, `WATCH`, 30 modules, three size advisories, no high-priority finding. No safe exact-section moves; grouping/split review remains open. Bridge still vendors `@mauroprime/mssr` `0.2.134`; host adoption of the newer cross-repo transaction contract (guard, journal, replay and recovery) waits for a reviewed MSSR package release. Do not substitute the dirty local candidate.

**Pending:** confirm native `MauroPrime_Bridge` tool discovery in a fresh Codex session; reproduce the separate ChatGPT Web `Unknown tool` payload/session (cause unconfirmed); authorized generic-MIME image import plus destination SHA-256/no-overwrite check; integrate and verify the cross-repo transaction contract after the reviewed MSSR package is available; decide historical ref retention. The current chat used the local MCP client for Bridge calls because its model tool catalog did not hot-refresh after config registration.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
