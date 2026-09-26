# Bridge dirty-tree recovery plan

Status: **P6 read-only ownership partition — draft verified from current working tree evidence**
Repository: `D:\Dev\bridge-mcp`
Observed dirty paths at draft time: **81**

This plan exists because the Bridge working tree contains legitimate work from several chats/agents. It is **not** permission to stage, restore, delete, or commit anything globally.

## Safety contract

1. Never use `git add -A`, mass restore/reset/clean, or a commit-all operation on this shared tree.
2. Partition by observable owner/workflow first; unresolved/shared integration files stay in the ambiguous bucket.
3. Before the first cleanup mutation, create or prove a reversible snapshot/backup path and check snapshot quota.
4. Verify each ownership-safe batch with its focused gates, then stage only its explicit pathspec.
5. Read back the staged diff and resulting commit before moving to another batch.
6. Aggregate release/version/generated files are handled **last**, after their producer batches are known.

## Ownership partition

### A. Context Layer / Human Cockpit — high confidence

Dedicated evidence:

- `docs/CONTEXT_LAYER_ROADMAP.md`
- `docs/HUMAN_COCKPIT.md`
- `src/dashboard-cockpit.ts`
- `src/context-inventory-cache.ts`
- `scripts/test-human-cockpit.mjs`
- `scripts/test-context-inventory-cache.mjs`
- `.mssr/knowledge/observability/human-cockpit-projection.md`
- `integrations/workflow-guides/cross-project-context-inventory/`

Shared dashboard files that belong partly to this batch but must be reviewed by hunk before staging:

- `src/dashboard-mssr-worker.ts`
- `src/dashboard/markup.ts`
- `src/dashboard/script.ts`
- `src/dashboard/styles.ts`
- `src/http.ts` (dashboard worker/seed lifecycle is mixed with broader runtime work)
- `src/mssr-observatory.ts` (weekly history + task identity is mixed with MSSR adoption)

Current gate: P1-P5A are live; P6 owns this plan. Focused check/build + Human Cockpit/context-inventory tests pass. Restart `a2e36afb-4bd8-4294-9366-63ae7a3a9bed` adopted the project map live.

### B. Storage Auditor / storage-growth — high confidence

Dedicated paths:

- `src/tools/storage-growth-tools.ts`
- `scripts/run-storage-growth-scan.mjs`
- `scripts/storage-auditor-app.mjs`
- `scripts/storage-growth-baseline.ps1`
- `scripts/test-storage-growth-tools.mjs`
- `scripts/test-storage-auditor-app.mjs`
- `storage-auditor.cmd`

Likely shared integration paths: `src/tool-registry.ts`, `package.json`, `README.md`, `TOOLS.md`, release docs.

### C. QuietDesk / Jev Bridge adapter — high confidence

Dedicated paths:

- `src/tools/quietdesk-tools.ts`
- `scripts/test-quietdesk-tools.mjs`

Likely shared integration: `src/tool-registry.ts`, generated `TOOLS.md`, package regression list.

### D. Blender / references / animation authoring — high confidence at subsystem level

Dedicated or subsystem-scoped paths:

- `src/tools/blender-tools.ts`
- `integrations/blender/README.md`
- `integrations/blender/create_animation_review.py`
- `scripts/test-blender-animation-tools.mjs`
- `scripts/test-blender-session-coordination.mjs`
- `integrations/workflow-guides/character-concept-blender/`
- relevant image/reference workflow guides and image-persistence regressions

`src/tools/blender-tools.ts` contains several Blender slices (reference transport, activity trace, rig inspect, IK, animation review), so it is one subsystem owner but may still warrant multiple commits if history/review demands it.

### E. MSSR 0.2.77 adoption / task identity / lifecycle — high confidence concept, mixed files

Strong evidence:

- `vendor/mauroprime-mssr-0.2.77.tgz`
- `src/mssr-trace-context.ts`
- `src/runtime-identity.ts`
- MSSR adoption/receipt/integration regressions

Mixed integration files:

- `src/bridge-server.ts`
- `src/mssr-observatory.ts`
- `package.json`
- `package-lock.json`
- `src/config.ts`
- `src/tool-registry.ts`

Do not stage this batch from filenames alone. Some of these files also contain image transport, dashboard, tool-catalog refresh, process-error and provider changes.

### F. Project Context / reference health — medium confidence

Candidate owner group:

- `.mssr/PROJECT_CONTEXT.md`
- `.mssr/project-context.json`
- `.mssr/knowledge/reference/`
- `src/project-health.ts`
- `scripts/test-project-health.mjs`
- related context-receipt/reference-audit tests

Review against current `.mssr` module ownership before staging; Project Context files are authorities, not generic release notes.

### G. Process/tool-friction/runtime hardening — medium confidence

Candidate group:

- `src/tools/process-tools.ts`
- `src/tools/shared/process.ts`
- `src/mssr-tool-friction.ts`
- `src/tool-audit.ts`
- `scripts/test-system-hardening.mjs`
- `scripts/verify-all.ps1`

`src/bridge-server.ts`, `src/metrics.ts` and `src/tool-registry.ts` contain overlapping changes and stay shared until hunk ownership is reconstructed.

### H. Release / generated / aggregate files — intentionally last and currently ambiguous

Never use these to define ownership; they summarize several owners:

- `package.json`
- `package-lock.json`
- `src/config.ts`
- `README.md`
- `TOOLS.md`
- `CHANGELOG.md`
- `changelogs/INDEX.md`
- `changelogs/0.6.141.md`
- `.mssr/PROJECT_STATE.md`
- `docs/INCIDENTS.md`
- `scripts/generate-tools-doc.mjs`
- `src/tool-registry.ts`
- `src/bridge-server.ts`
- `src/http.ts`
- `src/metrics.ts`
- `src/mssr-observatory.ts`

These are expected to be resolved only after A-G are partitioned. Some will require hunk-level staging or one final release-integration batch.

### I. Historical vendor tarballs — review-only, no deletion yet

Currently visible untracked package artifacts include older `0.2.73`, `0.2.74`, and `0.2.75` tarballs in addition to `0.2.77`. They are not the active dependency. Historical docs/changelog still reference older releases (for example 0.2.75), so **do not delete them from the working tree solely because they are old**. Decide retention policy explicitly after verifying whether release evidence expects those exact bytes to remain available.

## Recommended cleanup order

1. Context Layer dedicated files.
2. Storage Auditor dedicated files.
3. QuietDesk dedicated files.
4. Blender subsystem files.
5. Project Context/reference-health files.
6. MSSR adoption/lifecycle files after hunk review.
7. Process/tool-friction hardening.
8. Shared integration + release/generated files last.
9. Historical vendor artifacts only after explicit retention decision.

For every batch: **snapshot/backup → focused gates → explicit staging pathspec → staged diff readback → commit readback → remote verification if publication is requested**.

## Batch A isolation result — Context Layer

The dedicated Context Layer/Human Cockpit batch was replayed onto a detached worktree at clean HEAD `dcd33a8` with only its 23 owned paths copied in. `npm run check`, `npm run build`, `test-human-cockpit` and `test-context-inventory-cache` all passed there, so the batch is independently buildable without the mixed `src/http.ts`, `src/mssr-observatory.ts`, release/version or Project State hunks.

A real explicit-path staging preflight then passed `git diff --cached --check`, but `project_change_consistency(mode=persist, scope=staged)` correctly blocked publication because the repository's current `0.6.141` changelog declares `PROJECT_CONTEXT` / `PROJECT_STATE` updated and the staged batch deliberately excluded those shared aggregate authorities. The batch was fully unstaged afterward; no commit was created. This means the code ownership is clean enough, but the repository release contract intentionally couples publication to the final aggregate integration batch.

## Current blockers before mutation

- A verified independent rollback archive now exists outside the repo at `D:\MauroPrimeBackups\bridge-mcp\2026-09-26-pre-p6\bridge-mcp-pre-p6.zip` (17,492,131 bytes; 475/475 listed entries; SHA-256 `04387e9238de315ea1fb212542f351f2d5aa23572d3bcb9ee4e968e69bc7811b`). It records HEAD `dcd33a8ea766d7dfcd47cb9efea41cb3960944aa`, Git status, file list and archive listing. This avoids deleting retained workspace snapshots merely to create rollback capacity.
- No live Bridge work session was observed at the mutation preflight; the only listed sessions were this workflow's completed verification/backup commands. This reduces immediate collision risk but does not prove ownership of shared hunks.
- The tree is still shared across multiple chats/agents historically; several core files contain hunks from multiple features, so shared integration paths remain blocked until hunk ownership is reconstructed.
- Workspace snapshot storage remains ~99.92% utilized; do not rely on creating another managed workspace snapshot because its automatic retention can delete older per-project fallbacks, which conflicts with the repository backup-preservation rule.
- No immediate publication requires forcing a clean tree. Preserve legitimate work and clean only ownership-safe batches.

## P6 integration worktree execution — 2026-09-26

The shared `main` worktree is now treated as a frozen evidence source while P6 is assembled on `D:\Dev\bridge-mcp-p6-integration`, branch `recovery/p6-integration-20260926`, created from clean HEAD `dcd33a8ea766d7dfcd47cb9efea41cb3960944aa`.

The first replay attempt used a generated Git patch and failed on several text files because Windows line-ending normalization made patch context non-portable between the two worktrees. The failed `git apply` was atomic and left the integration worktree clean. P6 therefore switched to explicit dirty-path replay: tracked modified paths and untracked Git-visible paths were copied directly from the frozen source; tracked deletions would be replayed explicitly if present. This is a recovery-only mechanism, not a normal publication workflow.

Replay verification compared the dirty-path sets and SHA-256 of every present dirty file between source and integration worktree. Result: **92 source dirty paths / 92 integration dirty paths / 0 source-only / 0 integration-only / 0 hash mismatches**. This establishes byte-level parity for the Git-visible dirty state before ownership commits begin.

The integration branch may now partition dedicated ownership batches while leaving mixed core and aggregate files for the final integration batch. `main` must not be reset, cleaned or switched to this branch until all integration commits are complete, the full source-vs-integration semantic/file parity gate passes, focused and repository gates pass, and a final no-concurrent-change check proves the frozen source did not move underneath P6.

Planned commit structure on the recovery branch:

1. Context Director / Human Cockpit dedicated projection, cache, dashboard and workflow-guide files.
2. Storage Auditor dedicated implementation and regressions.
3. QuietDesk/Jev dedicated Bridge adapter and regression.
4. Blender/reference/animation subsystem dedicated files.
5. Project Context/reference-health dedicated files.
6. Asset transport, routing-quality and process/tool-friction slices where ownership is unambiguous.
7. Final mixed MSSR/runtime/tool-registry/release integration, including package/version/generated/authority files and any shared hunks that cannot safely stand alone.
8. Historical vendor tarballs remain review-only unless an explicit retention decision is made.

The goal is not maximum commit count. If splitting a shared hunk would create an invalid intermediate state, keep that hunk in the final integration commit and preserve its owner in this plan instead of manufacturing artificial history.

## Definition of P6 success

P6 is complete only when every dirty path is either:

- committed in an ownership-safe verified batch;
- intentionally retained with a named owner and next gate; or
- explicitly removed/restored with reversible evidence and owner approval/authority.

A visually clean `git status` by itself is **not** success.

## P6 ownership commits and focused integration gate — 2026-09-26

Ownership-safe commits created on `recovery/p6-integration-20260926` before the mixed integration batch:

- `dd2a334` — `feat: add cross-project context director` (Human Cockpit, daily/weekly inventory cache, resume/project/capability projections, workflow guide and dashboard UI).
- `64ae281` — `feat: add storage growth auditor`.
- `7053222` — `feat: add QuietDesk bridge adapter`.
- `d683874` — `feat: extend Blender reference and animation tools`.
- `ee76a32` — `feat: expose project reference health`.
- `c3b180c` — `fix: harden process and tool recovery diagnostics`.
- `c0b144d` — `feat: prefer authorized image file transport`.
- `660cc31` — `chore: preserve MSSR vendor releases through 0.2.77`.
- `d63c315` — `fix: allow read-only QuietDesk capture access`.

The remaining dirty paths are intentionally the mixed host-integration/release layer: MSSR 0.2.77 adoption and task lineage, Bridge server/runtime identity/observatory, tool registry, HTTP/metrics isolation, aggregate package/generated docs, release history and canonical `.mssr` authorities. Those paths are not split further when the same file contains cross-feature host integration.

During integration review, `scripts/test-mssr-semantic-r4-adoption.mjs` was found stale at MSSR 0.2.75 even though package/lock/changelog and the live host already target 0.2.77. The integration branch corrects that regression gate to exact 0.2.77 and verifies `vendor/mauroprime-mssr-0.2.77.tgz` SHA-256 `32f2fd9d86db8a9479efe4fad89eb7a812d13ac76ebf238834c1eff8df191317`. This is an intentional integration-only correction beyond the frozen dirty snapshot.

A clean dependency install inside the worktree could not complete offline because `jose@6.2.3` was not present in the npm cache. The failed install was not retried unchanged. For isolated verification only, the integration worktree uses an ignored temporary `node_modules` junction to the main repo's already-installed dependency tree, whose `@mauroprime/mssr` version was read back as 0.2.77. The junction is test infrastructure only and must be removed before deleting the worktree.

Focused full-state verification passed on the integration worktree: TypeScript check/build plus MSSR 0.2.77 semantic adoption, receipt-count boundary, weekly work history, Human Cockpit, context-inventory cache, system hardening, Project Health, authorized image import, QuietDesk proxy, Storage Growth, Blender animation tools and the 176-tool v0.6 registry regression. Durable combined log: `data/p6-focused-integration-gates.log`.

At this checkpoint, the remaining gate was to stage the mixed integration/release paths explicitly, run staged `project_change_consistency`, commit/read back the final integration batch, verify the clean branch, and compare it against the still-frozen `main`. The following section records that gate's completed result.

## Final local reconciliation — 2026-09-26

The recovery branch closed with final mixed integration commit `f0deaa9` (`release: integrate Bridge 0.6.141 host changes`). Before mutating `main`, a final parity script re-read the frozen source and recovery branch and proved:

- `main` was still exactly `dcd33a8ea766d7dfcd47cb9efea41cb3960944aa`;
- recovery target was `f0deaa9156f977f78fe3b33451082f5b902ea516`;
- both sides covered the same 92 Git-visible paths, with no source-only or branch-only paths;
- 90 paths matched byte-for-byte;
- the only two mismatches were intentional branch-newer corrections: this P6 plan and `scripts/test-mssr-semantic-r4-adoption.mjs` moving the adoption assertion from 0.2.75 to 0.2.77;
- the external rollback ZIP remained available with SHA-256 `04387e9238de315ea1fb212542f351f2d5aa23572d3bcb9ee4e968e69bc7811b`.

A heavy `bridge_verify_all` attempt on the clean recovery worktree coincided with sustained HTTP readiness stalls and a watchdog restart. The verifier job state did not survive the restart, so it was deliberately **not** retried unchanged. Bridge access was recovered with the authorized desktop diagnostic path, local/tunnel readiness returned healthy, and the accepted verification authority remained the already-passing focused integration suite plus a fresh `bridge_self_check` on the clean recovery worktree (typecheck PASS, build PASS, Git clean, tunnel/readiness healthy, 176-tool runtime catalog).

With those gates satisfied, local `main` was reconciled using the already-verified recovery history. Post-reconciliation readback:

- `HEAD = f0deaa9156f977f78fe3b33451082f5b902ea516`;
- branch remains `main`;
- `git status --short --branch` reports only `main...origin/main [ahead 10]` and no dirty paths;
- no force operation or remote push was performed.

P6 is therefore complete **locally**. The ten commits are now the local auditable history for the previously shared dirty work. Publishing them to `origin/main` is a separate external-side-effect decision and is intentionally outside this recovery step.
