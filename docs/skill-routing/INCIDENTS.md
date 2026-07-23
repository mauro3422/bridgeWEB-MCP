# MSSR routing incident log

This file records confirmed routing failures and the regression that prevents each one from returning. It contains only observable inputs, outputs, causes, changes, and test evidence. It must not contain hidden chain-of-thought.

## MSSR-001 — Roblox project migration opened gameplay branches

**Date:** 2026-07-21

### Trigger

A task asked to move a local Roblox project folder, preserve the `.rbxl`, backups, assets and documentation, compare hashes, update stale absolute paths, initialize Git, create a repository, and push it.

### Observed failures

1. A structured call using natural concepts such as `git`, `filesystem`, `move`, `verify`, `version`, `project`, `repository`, `place-file`, `integrity-verification`, and `version-control` was rejected because the intent vocabulary did not include those values.
2. The lexical fallback reduced the task to broad tags such as `roblox`, `create`, and `game`.
3. That broad classification selected unrelated gameplay skills, including network authoring, placement authoring, technique animation, UI review, locomotion review, resource-network tests, Play Mode QA, and Roblox official-doc lookup.

### Root causes

- The structured vocabulary covered gameplay and content editing better than project administration, filesystem migration, and local Git.
- `game` was used as the default Roblox artifact when no specialized artifact was recognized.
- Generic local `documentación` was incorrectly interpreted as a need for official Roblox documentation.
- The `roblox-development` workflow matched every Roblox-domain task, even when the operation only changed project files and repository state outside Studio.
- Several specialized Roblox skills shared the broad anchors `roblox + game + create`, so they scored without evidence that their specific subsystem was involved.

### Correction

- Added explicit intent vocabulary for `git`, `filesystem`, `move`, `verify`, `version`, `project`, `repository`, `place-file`, `backup`, `integrity-verification`, and `version-control`.
- Taught lexical fallback to recognize project moves, repository bootstrap, hashes, stale paths, `.rbxl` files, backups, local documentation, commits, tags, and Git publication.
- Narrowed `official-docs` detection to explicit official/API-reference wording instead of generic documentation work.
- Narrowed the `roblox-development` workflow so it requires a Studio/gameplay artifact and does not match repository-only migration work.
- Extended `mauroprime-bridge-collaboration` and `roblox-save-backup-recovery` routing metadata and procedures for safe project-root migration.
- Added structured and lexical regression fixtures that require the collaboration/persistence path and explicitly exclude unrelated gameplay branches.
- Added `coversPhases` so one coherent procedure can cover multiple workflow phases without creating artificial skills. The merge rule prefers explicit `coversPhases`, then explicit `phase`, and only then inferred phase metadata.
- Added fixture assertions for `missingRequiredPhases` so a plan cannot appear correct while silently leaving required phases uncovered.

### Regression fixtures

- `roblox-project-repository-migration-structured`
- `roblox-project-repository-migration-fallback`

### Verification

Completed successfully on 2026-07-21:

- `npm run test:skill-routing`: 17/17 expanded cases passed;
- both migration fixtures select only `mauroprime-bridge-collaboration` in the active phase and defer `roblox-save-backup-recovery`;
- unrelated Roblox routing, official-doc lookup, gameplay authoring, UI, animation, Play Mode QA, Studio QA, and resource-network testing are explicitly excluded;
- `verify-skills.ps1`: 24/24 source skills have valid junctions and frontmatter;
- `test-codex-discovery.ps1`: 24/24 custom skills appear in the real Codex prompt;
- `skill_route_audit`: clean, with no cycles, broken references, stale entries, or maintenance pending;
- `npm run verify:all`: all required checks passed, including TypeScript, build, HTTP smoke, regressions, routing, documentation, watchdog, metrics, and tool-catalog sanity.
- after restarting the live Bridge, both structured and lexical migration calls returned only `mauroprime-bridge-collaboration` as active, `roblox-save-backup-recovery` as deferred, no matched gameplay workflow, no warnings, and `missingRequiredPhases = []`.

## MSSR-002 — Plugin skills were invisible to the live Bridge

**Date:** 2026-07-23

### Trigger

The filesystem contained managed `SKILL.md` files under `~/.codex/plugins/cache`, and Codex exposed those plugin skills, while `skill_catalog` and `skill_route_audit` reported only local/system/Roblox entries.

### Observed failure

The plugin crawler called the general Bridge path policy. Safe defaults allowed `~/.codex/skills` but not `~/.codex/plugins/cache`; the root exception was caught and converted into an empty result without a warning. The audit appeared clean because the missing source never entered the registry.

### Correction

- Added an internal read-only discovery boundary for the resolved plugin cache root without broadening normal filesystem permissions.
- Reject plugin directories that resolve outside that exact root.
- Return an observable warning when an entire skill root cannot be read.
- Added an isolated regression with a temporary `CODEX_HOME` whose general allowed roots deliberately exclude `plugins/cache`.

### Regression

`scripts/test-v060-tools.mjs` requires `fixture-plugin-skill` to be discovered as `codex-plugin` while the general Bridge path policy still excludes the cache.

## MSSR-003 — Specific repository tags suppressed OpenCode and Blender crossed into Roblox

**Date:** 2026-07-23

### Triggers

1. A structured OpenCode swarm request added the accurate artifact `repository` alongside `code`.
2. A Blender-only object review used `model-3d`, `visual-qa`, `review`, and `optimize`.

### Observed failures

- `opencode-agent-swarm` disappeared because the specific-artifact gate had no `repository` metadata, leaving only the general Bridge collaboration skill.
- A short swarm continuation lost `cross-agent` because lexical fallback did not recognize `swarm` or `subagent` as orchestration needs.
- `roblox-model-turnaround-review` matched a Blender-only domain and pulled its Roblox router dependency.
- `blender-reference-pipeline` matched review work by artifact despite having no matching action.

### Correction

- Added `project` and `repository` to the OpenCode swarm/audit metadata.
- Taught fallback that `swarm`, `subagent`, and `subagente` imply `cross-agent`.
- Restricted the Roblox turnaround skill to the Roblox domain.
- Added the reusable `requireActionMatch` gate and applied it to Blender reference creation.
- Restricted Roblox save/recovery to Roblox and let Bridge collaboration coherently cover persistence for general project migration.

### Regression fixtures

- `opencode-swarm-positive`
- `opencode-existing-repository-audit-does-not-create-swarm`
- `opencode-swarm-continuation`
- `blender-review-does-not-open-roblox-branch`
- `generic-coding-uses-explicit-agent-fallback`
- `generic-project-migration-stays-outside-roblox`

## MSSR-004 — Roblox tools/list returned zero without degrading source health

**Date:** 2026-07-23

### Trigger

Roblox Studio MCP completed its MCP handshake and exposed a Studio instance in Edit mode, while `tools/list` waited about ten seconds and returned no tools.

### Observed failure

- `roblox_mcp_status` reported `connected: true` with `toolCount: 0`.
- `roblox_mcp_tool_list` returned `{ count: 0, tools: [] }` without a warning.
- `skill_catalog` filtered to `source=roblox` returned an empty catalog with no source-health explanation.
- `skill_route_audit` remained clean because a successful empty list was not an exception.
- After a Bridge restart there was no durable last-known schema catalog, so the proxy could not safely classify or invoke dynamic Roblox tools.

### Cause

The immediate live cause was an orphaned `StudioMCP.exe` process from 2026-07-21 whose parent no longer existed. The current Bridge child and the intended direct MCP process were both still present; removing only the verified orphan restored 27 live tools in 6 ms without closing Studio.

The Bridge amplified the incident because it only retried closed-connection errors. It treated any successful `tools/list` response as healthy, including an empty response, and the skill catalog only converted thrown errors into warnings.

### Correction

- Classify the remote catalog as `healthy`, `degraded`, or `unavailable`.
- Retry an empty or failed `tools/list` once after resetting only the Bridge-owned StudioMCP child connection.
- Persist non-empty tool schemas under ignored runtime data and use them as explicitly marked last-known schemas during a live outage.
- Return source health and warnings from Roblox tool listing, skill discovery, routing, and audit calls.
- Mark a requested degraded Roblox source as maintenance-required instead of silently passing the audit.
- Add `refresh` to the Roblox status and tool-list tools for an explicit bounded reprobe.
- Diagnose process ownership before cleanup. Never kill every StudioMCP process: preserve the direct MCP and the current Bridge-owned child, and remove a process only after proving its parent is gone.

### Regression

`scripts/test-v060-tools.mjs` checks healthy, degraded-with-cache, and unavailable-without-cache classifications. Live verification must additionally confirm that an empty remote list is never presented as healthy.

The repaired live verification returned 27 tools, six `rbx-*` skills, `status=healthy`, `usingCachedTools=false`, and persisted a 27-tool last-known catalog under ignored runtime data.

## MSSR-005 — Dashboard treated complements and prose as dependency cycles

**Date:** 2026-07-23

### Trigger and failure

The Python dashboard audit scanned every skill-name mention in `SKILL.md` as a dependency edge. Legitimate two-way complements among Roblox visual-review skills appeared as three cycles, while the runtime router correctly reported no mandatory dependency cycles.

### Correction and regression

The dashboard keeps textual mentions for reference/inbound visualization, but computes cycles only from explicit Git-tracked `requires` edges. Regenerating the dashboard now reports `cycles: []`, matching `skill_route_audit`.

## MSSR-006 — Concurrent clients could race reconnect and active-Studio selection

### Symptom

The HTTP Bridge supported multiple MCP sessions, but all sessions shared one persistent StudioMCP client without an explicit operation gate. Concurrent catalog probes could both reset the child, and a proxied mutation only instructed the caller to verify the active Studio without enforcing the target.

### Cause

Connection creation was single-flight, while inspection/reconnect and multi-call target selection were not one serialized transaction. Cached annotations were also accepted by generic proxy dispatch.

### Correction and regression

- Serialize operations over the Bridge-owned StudioMCP connection and coalesce catalog inspections.
- Report exact child ownership, reconnect, and queue diagnostics.
- Add `roblox_mcp_studio_list`.
- Atomically validate/select `studioId` and execute the call.
- Require explicit targeting for mutations when multiple Studios exist.
- Require a healthy live catalog before proxy dispatch or Roblox skill loading.
- Close the owned child during HTTP and stdio shutdown.

`scripts/test-v060-tools.mjs` validates health classification, Studio-list parsing, the new registry entry, and risk classification. HTTP/regression and live verification cover the shared transport.

## MSSR-007 — Incident semantics were implicit and could not route recovery

### Symptom

The intent contract represented domain, action, artifact, need, risk, and ambiguity, but could not distinguish ordinary Roblox MCP work from a connected-but-degraded catalog, contradictory evidence, recurring friction, or a reusable workaround. Maintenance depended mostly on `stage=close`.

### Correction and regression

- Add mandatory semantic `signals`, with `nominal` as the clean-state value.
- Normalize high ambiguity to `uncertainty` and never retain `nominal` beside an incident signal.
- Route incident signals to verification and friction/pattern signals to maintenance.
- Add `roblox-mcp-incident-recovery` as an explicit routed skill.
- Cover structured positive, nominal negative, bounded-context continuation, and close/maintenance cases in fixtures.

## Incident policy

For every confirmed false positive, false negative, schema rejection, phase error, or dependency error:

1. preserve the smallest reproducible task and context;
2. record the observable wrong selection;
3. identify whether the fault is vocabulary, fallback classification, metadata, workflow matching, scoring, dependency expansion, or phase activation;
4. make the smallest general correction rather than special-casing one sentence;
5. add a positive and nearby negative fixture;
6. run the complete routing suite and audit;
7. update this file with final verification evidence.
