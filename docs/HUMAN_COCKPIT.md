# MauroPrime Human Cockpit

## Purpose

The **Dónde estoy** dashboard tab is a human-orientation projection for ongoing multi-project work. It exists so Mauro can answer, without reconstructing a chat from memory:

- what is currently open;
- which project/workflow a trace belongs to;
- what lifecycle phases are already complete;
- what phase is next;
- what was most recently verified/persisted/closed;
- which active projects currently have tracked Git changes;
- whether Project Context Health is OK/WATCH/REVIEW.

The Cockpit is deliberately not another memory database. MSSR remains the lifecycle/project-context owner, Bridge remains the host/runtime observability owner, and Git remains repository-state authority. The Cockpit only joins and renders bounded evidence with freshness metadata.

## Data flow

`dashboard browser → /api/dashboard/snapshot → isolated dashboard worker → bounded projections`

The browser still performs one snapshot request. Cockpit aggregation happens inside the existing isolated dashboard worker, preserving the dashboard/liveness invariant: `/healthz`, MCP transport and the HTTP event loop never synchronously perform Cockpit scans.

The worker combines:

1. MSSR recent lifecycle events (`kind=recent`, active epoch, bounded to 200 events / 3 days) for current focus/checklists;
2. a rolling seven-day MSSR summary with `scope=all` for cross-project weekly reconstruction;
3. the already persisted Project Context Health report;
4. Git state only for correlated projects: at most six currently open repositories plus at most twelve repositories present in the weekly MSSR projection.

Git probing is bounded per repository and runs only in the isolated analytics child. It reads branch, tracked/untracked working-tree pressure, configured remotes, local upstream divergence, and commits inside the requested window. It never performs `git fetch` and never scans every repository under `D:\Dev` on each dashboard refresh.

## Trace/checklist projection

Recent MSSR events are grouped by `traceId`. The projection carries observable fields only: workflow key, project, caller/model metadata when available, latest stage/event, lifecycle phase sets, summary/evidence refs, and timestamps.

The checklist order is:

`discovery → safety → implementation → verification → persistence → maintenance`

Only MSSR-recorded `requiredPhases` and `completedPhases` determine the checklist. The Cockpit does not infer completion from tool activity. A trace is considered closed only when its latest outcome is not older than a later route/replan. Closure/idle reminders are shown as paused attention state rather than failure.

## Human reading model

The first card is **Dónde estoy ahora**: the newest open trace, or the newest recent trace when none remain open. It shows the best available summary plus the next incomplete required phase.

The checklist grid shows recent traces as independent cards. This prevents parallel chats/projects from collapsing into one misleading global to-do list.

Trace cards are human-facing projections, not raw IDs. When a route contains `intent.summary`, that summary is preferred. Future route recording also persists a bounded deterministic summary when the caller omits one, derived from workflow/actions/domains/artifacts. Legacy traces without an explicit summary fall back to a humanized workflow label or project label. Pure technical/orphan traces are named deterministically from the event they actually represent (for example `Carga de skill · mssr-agent-routing`) instead of exposing an opaque trace id as the title. Known synthetic fixture/test workflow keys are projected as `synthetic-test`, get a `Prueba técnica MSSR` summary, and are forced to `attentionKind=intermediate` so regression evidence cannot masquerade as pending product work. The Cockpit exposes `summarySource`, `displayNameSource`, `attentionKind`, `traceRole`, and `workflowTraceCount` so the UI can distinguish real work (`verify`, `persist`, `close`, `continue`) from setup-only members of a repeated workflow (`intermediate`). When several traces share one workflow, the newest trace remains the actionable workflow root; only older setup-only siblings are demoted to `workflow-member`.

## Morning brief and interrupted-chat recovery

The Cockpit exposes **Al volver** as a bounded resume projection. It reads the rolling `scope=all` work history and shows three related views: what substantive MSSR work was observed on the previous Bridge-host local calendar day, which human tasks are still projected as current work, and which traces carry lifecycle debt because substantive work was followed by a closure reminder without a later outcome.

Current work prefers MSSR `taskKey` as the explicit stable human-task identity. Related traces may additionally expose `parentTraceId` and `supersedesTraceId` as correlation-only lineage; those fields never close, cancel, or complete another trace. Older history without `taskKey` remains readable through an explicitly labeled fallback of `project + workflowKey`, then trace id. Raw trace ids always remain attached so grouping never erases provenance.

A substantive trace that has an MSSR `closure_reminder` and no later observable outcome is surfaced as `needsClosureReview`, but it is no longer presented as ordinary active product work. **Al volver** places it in a separate **Deuda MSSR** lane: the evidence remains auditable and resumable, but the user is told to review whether to resume or record an outcome instead of blindly continuing it. This does not auto-close, fail, or rewrite the trace. Later activity may resume it, and a later outcome resolves the lifecycle normally.

Runtime process evidence is layered on top of that durable MSSR projection at response time. A Bridge-managed terminal correlated to the task's trace and still alive with recent progress marks the task as runtime-active and changes its immediate gate to `proceso vivo: esperar / inspeccionar progreso`. If that task was in lifecycle debt, the debt is deferred from the visible debt lane only while the process is genuinely progressing; the canonical closure reminder/outcome state is untouched and returns when the runtime evidence disappears. This overlay comes from the main-process terminal registry and is deliberately **not persisted** into the last-good dashboard seed, so a restart or stale snapshot can never turn an old process into current truth.

Forensic/support workflows used only to reconstruct other work—currently bounded patterns such as `recent-work-recovery-*` and `cross-project-recovery-*`—remain visible in weekly MSSR evidence and keep their own lifecycle debt, but they are separated from both the human active-work lane and the human lifecycle-debt lane. The projection exposes support-open/support-review counts separately so the auditor's own traces cannot make Mauro appear to have dozens of additional product tasks. Support traces also cannot replace the latest substantive human project summary.

Both active work and lifecycle-debt items retain a privacy-safe `resumePacket` with project, task identity plus its source (`explicit-mssr` or legacy fallback), workflow key(s), related trace ids and lineage refs, last human summary, last lifecycle stage, required/completed phases, next gate, latest bounded evidence reference, and latest activity time. The packet contains no raw prompt, transcript, secret, or private reasoning. Its purpose is to recover after a chat is truncated, compacted, abandoned, or resumed in another conversation: load the owning project, correlate MSSR/Git evidence, and continue from the smallest verified state instead of asking Mauro to reconstruct the whole chat manually.

## Capability inventory

The Cockpit exposes **Qué puede hacer el sistema hoy** as a dynamic owner projection rather than a manually maintained capability list. It groups the registered Bridge runtime catalog by tool family, joins the latest persisted Skill Health counts/status, and reports the number of installed Bridge workflow guides. Stable capability discovery therefore follows the live owners instead of duplicating volatile tool/skill names into `AGENTS.md` or assistant memory.

A registered provider-backed family is not proof that the provider is currently connected. Blender, Godot, Roblox and similar external-provider families are shown as requiring a live probe/review until the owning provider is checked for the task that needs it; internal registered Bridge families can be shown as available from the runtime catalog. The dashboard itself does not fan out into provider probes on every refresh, preserving the liveness boundary and avoiding false claims from cached metadata.

## Weekly cross-project reconstruction

The Cockpit also exposes a bounded **Qué hicimos esta semana** projection. It uses a rolling seven-day MSSR summary with `scope=all`, so an observability epoch reset does not erase older work from the weekly view. MSSR events are grouped by trace and then by observed project identity; known synthetic/test workflows remain visible as telemetry but do not count as substantive work or replace the latest substantive human summary.

For up to twelve projects already present in Project Context Health and correlated to the weekly MSSR history, the isolated analytics child reads local Git evidence: branch, tracked/untracked working-tree pressure, configured remote names, local upstream relation, commit count in the seven-day window, and the latest commit in that window. `ahead` / `behind` describe the local tracking refs currently on disk; the Cockpit does **not** fetch remotes during dashboard refresh and therefore must not present those values as fresh GitHub/remote truth.

Projects found in MSSR history but missing from the Project Health catalog remain in the weekly reconstruction with Git marked unavailable instead of guessing a filesystem path. This keeps the projection useful for older or moved work while preserving ownership boundaries. The worker never performs a global `D:\Dev` repository scan on each refresh.

The weekly view is evidence for reconstruction, not an inferred completion ledger. A recent commit does not prove that all MSSR work is finished, and an uncommitted working tree does not prove that the work is incomplete; the UI surfaces both signals side by side so a later weekly summary can distinguish observed implementation, lifecycle closure, local Git pressure, and configured tracking state.

## Incremental context inventory

The seven-day reconstruction is persisted separately under ignored runtime `data/` as a bounded derived **context inventory**. The worker restores that projection after restart and reuses it until either a material MSSR lifecycle event is newer than the snapshot or the inventory reaches its one-hour freshness TTL. Skill/tool-call noise alone does not force a `scope=all` rebuild; manual Git changes without MSSR evidence are caught by the TTL.

The inventory stores only the compact weekly work-history projection, up to twelve correlated local Git states, and a rolling bounded set of daily resume snapshots. It deliberately does not store raw prompts, transcripts, source files, secrets, or private reasoning and it never becomes project truth. A corrupt/missing inventory falls back to a full seven-day `scope=all` reconstruction and rewrites the derived cache atomically.

`Al volver` exposes the inventory mode/freshness and daily-snapshot count so the resume view is auditable. The full dashboard last-good seed remains a separate first-paint cache; the context inventory exists to avoid repeatedly rebuilding expensive cross-project history behind that seed.

The same daily cache now feeds **Últimos 30 días** without another historical database scan. Coverage is explicit: `snapshotCount / requested days`, so nine retained daily snapshots are shown as 30% coverage rather than pretending the endpoints prove a complete month. The view aggregates per-project active-day counts, last-seen day, retained bounded summaries, workflow count and trace-day observations. It naturally becomes more complete as daily snapshots accumulate; `scope=all` remains the recovery path when the derived cache is missing/corrupt, not the routine thirty-day UI path.

## Workspace project map

The **En qué está cada proyecto** projection is the organization layer above raw traces. It classifies only projects observed in the rolling seven-day work history and joins their current human tasks, Git pressure and next gate. `active`, `paused`, `experimental` and `review-needed` are conservative dashboard projections with visible confidence/basis; they are not written back as project truth.

`finished` and `abandoned-or-replaced` are deliberately reserved for explicit owner evidence. Age, a clean Git tree, closed traces, lack of chat activity or a superseded execution trace are insufficient to declare a whole project finished or abandoned. Until an owning project exposes such an explicit classification, ambiguous cases remain `review-needed` or `paused`.

Terminal owner evidence uses one bounded section in the owning repository's existing canonical `.mssr/PROJECT_STATE.md`; the Cockpit does not create a second authority:

```text
## Workspace status

State: finished
Updated-At: 2026-09-26T17:30:00-03:00
Reason: Final verification and persistence completed.
```

`State` currently accepts only `finished` or `abandoned-or-replaced`; `Updated-At` is required so the declaration can be ordered against later MSSR work. `Reason` is optional and bounded. `abandoned-or-replaced` may additionally declare `Replaced-By: <project/ref>`. Project Health parses only these metadata fields and never persists the surrounding PROJECT_STATE content. Invalid terminal metadata raises `workspace-status-invalid` / REVIEW rather than guessing.

A terminal declaration is not timeless: if the weekly evidence contains substantive MSSR activity newer than `Updated-At`, the workspace map projects `review-needed` with `basis=project-owner`. This preserves the explicit owner record while making the contradiction visible instead of silently treating stale terminal state as current truth.

This map is intended to become the evidence layer for later dirty-tree partitioning: cleanup may use project/task ownership, trace provenance and Git pressure to explain batches, but the Cockpit itself never stages, restores, deletes, commits or pushes.

## Snapshot performance

Dashboard aggregation remains isolated from the main HTTP event loop. A fresh `worker_threads` Worker previously paid an observed cold-import cost around 20 seconds, and recreating a child process for every refresh could degrade to ~45–80 seconds under heavy concurrent disk/process load even though the same warmed process completes later snapshots in roughly a second. The snapshot runner now keeps one isolated child process warm across refreshes, opens its observability databases read-only, and keeps `tool-registry` in the already-warm HTTP owner instead of importing the full tool catalog again. More importantly, each successful snapshot is persisted as a last-good seed: after a Bridge restart the dashboard can immediately return that bounded stale snapshot and refresh it in the background instead of blocking first paint on a cold analytics process. The isolated regression measured seeded startup reads around 8–16 ms while liveness stayed responsive; `cache.buildMs`, `cache.stale`, and `cache.refreshing` keep both the displayed evidence age and background refresh cost auditable. A failed or timed-out analytics child is discarded so the next refresh can recover with a fresh process.

The 2026-09-26 Context Director pass separated **normal cached refresh** from **missing-cache recovery**. With a valid context-inventory fixture, a standalone persistent-worker run completed its first request in ~9.2 s and the second in ~1.0 s; the final aggregate gate under heavier workstation contention measured ~71.5 s first / ~1.3 s second, proving that warm reuse is stable while cold import/query cost remains highly load-sensitive. A direct recovery profile measured the current expensive owners independently: active MSSR 30-day summary ~32.0 s and seven-day `scope=all` summary ~40.2 s on the busy workstation, while recent/Project Health/Skill Health/Runtime Health were each below 100 ms. The worker-reuse regression seeds a valid derived inventory because its contract is process reuse, not full-history recovery; the expensive cold/recovery path remains an explicit optimization target and must stay behind the persisted seed/liveness boundary.

The project table joins trace project identity with Project Context Health and the bounded active-project Git read. It also shows candidate-document counts reported by MSSR's reference audit. The maintenance block summarizes Project Health WATCH/REVIEW plus reference candidates; a `high` candidate is a review priority, not an error or an automatic link.

## Documentation-reference lifecycle

Bridge source/runtime now consumes the exact verified MSSR `0.2.77` package. The 0.2.74 document-reference lifecycle and 0.2.75 Context Message receipt fix remain preserved; 0.2.77 additionally owns explicit stable human-task identity (`taskKey`, optional `parentTraceId` / `supersedesTraceId`) above individual traces. `reference-on-miss`, trace/task identity semantics, and explicit hash-guarded forward registration remain MSSR-owned operations. The Cockpit projects only bounded counts plus high-priority candidate paths; it never promotes, links, renames, rewrites, or repairs context receipts. Missing audit data means the persisted Project Health snapshot predates the supporting package/runtime refresh and should be refreshed, not guessed.

## Authority and privacy

The Cockpit stores no new prompts or transcripts and does not make lifecycle/project-context writes. It must never:

- mark a phase complete on its own;
- register/rename/delete project-context references;
- auto-clean Git changes;
- convert WATCH/REVIEW into automatic edits;
- use a filename or dashboard summary as canonical project truth.

Every future Cockpit feature should prefer a bounded projection of an existing owner over introducing another persistence surface.
