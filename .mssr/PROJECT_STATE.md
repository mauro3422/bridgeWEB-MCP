# Bridge project state
## Current local release and recovery (2026-11-12)
**Live check (2026-11-13 01:30Z):** Bridge 0.6.185 PID `26100`; `/status` reports ready, and Bridge `/readyz` plus tunnel `/readyz` return HTTP 200 `ready`. This verifies local HTTP readiness only. In this Codex session, direct calls to `bridge_health` and `bambu_mcp_status` report that the tools are not available to the model; cause is unknown.

**Bambu:** post-restart MCP child/status is still unverified because the Bridge MCP status tool is unavailable to this Codex model. Studio, AMS and printer untouched.

**Git:** one `main` worktree, clean after local commit `b43196085c88ea4ff7fb438f801ba2d956646be9` (`docs: add global workflow guides`), adding 24 files across three global guides. `main` is one commit ahead of `origin/main` at `c3fb706b8ca0c1d921abc7045d5e1a476f6d88dd`; no push was made. Four old remote refs remain unmerged; review found no missing behavior, and none were changed.

**MSSR:** valid manifest, `WATCH`, 30 modules, three size advisories, no high-priority finding. No safe exact-section moves; grouping/split review remains open. Bridge still vendors `@mauroprime/mssr` `0.2.134`; host adoption of the newer cross-repo transaction contract (guard, journal, replay and recovery) waits for a reviewed MSSR package release. Do not substitute the dirty local candidate.

**Pending:** authorized generic-MIME image import plus destination SHA-256/no-overwrite check; exact ChatGPT Web `Unknown tool` payload/session reproduction (cause unconfirmed); verify lazy Bambu child from a host where Bridge MCP tools are callable; integrate and verify the cross-repo transaction contract after the reviewed MSSR package is available; decide historical ref retention. Empty Studio windows do not establish printer state.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
