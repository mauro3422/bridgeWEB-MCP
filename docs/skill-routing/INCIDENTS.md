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

## Incident policy

For every confirmed false positive, false negative, schema rejection, phase error, or dependency error:

1. preserve the smallest reproducible task and context;
2. record the observable wrong selection;
3. identify whether the fault is vocabulary, fallback classification, metadata, workflow matching, scoring, dependency expansion, or phase activation;
4. make the smallest general correction rather than special-casing one sentence;
5. add a positive and nearby negative fixture;
6. run the complete routing suite and audit;
7. update this file with final verification evidence.
