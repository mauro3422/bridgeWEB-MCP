# MauroPrime Context Layer Roadmap

Status: active design/implementation roadmap for the Bridge + MSSR context layer.

## Goal

Make the system answer, from observable evidence rather than chat memory alone:

- What did we work on yesterday?
- Where did each real task stop?
- What is still pending or needs verification/closure?
- Which projects changed locally or through Git?
- Which work was left without an MSSR outcome?
- What capabilities/tools/skills are currently available to continue the work?

The dashboard is a read-only projection. MSSR lifecycle/Project Context, Git repositories, runtime catalogs and owning projects remain authoritative.

## P0 — historical reconstruction and weekly Cockpit — DONE

- Preserve `scope=all` MSSR history across active-epoch resets.
- Human-readable trace projection and technical/intermediate trace classification.
- Seven-day `Qué hicimos esta semana` projection.
- Bounded local Git join for correlated Project Health repositories.
- Restart-safe persisted dashboard seed and isolated analytics worker.

## P1 — morning brief + unfinished-work recovery — CURRENT / CORE IMPLEMENTED

Build a compact `Al volver` projection that answers what happened yesterday and what needs attention now.

Required evidence:

- substantive MSSR work grouped by project/workflow;
- explicit outcomes vs open traces;
- idle/closure reminders such as `mssr-web-outcome-missing-after-idle`;
- latest bounded human summary and lifecycle phase;
- weekly Git pressure as supporting evidence, never as inferred completion.

Rules:

- Never auto-close a trace because it became idle.
- An idle trace with substantive activity and no later outcome becomes `needs-closure-review`, not `failed`.
- A newer trace for the same task/workflow may supersede an older setup/retry trace in the UI, but provenance remains visible.
- Unknown transcript labels (for example a bad speech transcription) are not promoted into project names without repository/MSSR evidence.

Success gate: after opening the dashboard, Mauro can identify yesterday's main work and the next concrete gate without reading handoffs/README files.

## P1b — chat/context interruption recovery

Long ChatGPT/Codex sessions can be truncated, compacted, abandoned, or resumed from another chat. The project must remain resumable even when the conversational surface disappears.

For every substantive open task, keep a bounded **resume packet** derived from durable/observable evidence:

- project and provisional/stable task identity;
- related trace ids and workflow key;
- last known human summary;
- last known lifecycle stage;
- required vs completed phases;
- concrete next gate;
- latest bounded evidence reference when one exists;
- latest activity timestamp.

The packet must never contain raw transcripts, prompts, secrets or private reasoning. It is a recovery index, not a replacement for canonical project truth. On a new chat, the host can load the owning project and use this packet plus MSSR/Git evidence to reconstruct the smallest continuation context.

Success gate: after a chat is cut mid-task, a new session can identify the owner, last verified state and next action without requiring Mauro to reconstruct the whole conversation manually.

## P2 — stable task identity above traces — DONE / LIVE

MSSR `0.2.77` owns the explicit task relationship contract instead of relying only on `workflowKey` heuristics. Bridge consumes that contract in observability, metrics and Human Cockpit.

Current metadata:

- `taskKey`: explicit stable human-work identity;
- `parentTraceId`: optional bounded parent/child execution correlation;
- `supersedesTraceId`: optional explicit retry/replacement correlation;
- lifecycle state remains trace-owned: lineage never closes/cancels another trace.

Cockpit prefers explicit MSSR `taskKey`; old history without it stays readable through a visibly labeled `project + workflowKey`, then trace-id fallback. Identity is never inferred from prompt similarity, recency or inactivity.

**Live evidence:** exact MSSR 0.2.77 source/vendor/installed byte parity; runtime route schema exposes all three fields; focused task-identity/Cockpit/routing regressions pass; restart `8b076cce-ffbf-43aa-a908-f0f6c884b648` adopted the projection and fresh dashboard snapshots report `taskIdentityMode=mssr-explicit-with-legacy-fallback`.

Success gate met: new retries/agents/resumed chats can share one explicit human task without hiding raw trace provenance; legacy traces remain transparently derived rather than retroactively rewritten.

## P3 — capability inventory / "what can the system do?" — CURRENT / PHASE A IMPLEMENTED

Create one dashboard capability projection from live owners instead of a manually maintained mega-list.

Inputs:

- Bridge runtime tool catalog and modules;
- Skill Health / routed skill catalog;
- connected provider health where already observable;
- selected cross-project workflow guides;
- project-specific capabilities from Project Context only when relevant.

Do **not** copy the volatile catalog into ChatGPT memory or a permanent AGENTS list. Stable AGENTS/skills should contain the rule for discovering capabilities; the dashboard should show the current inventory from live catalogs. This prevents stale capability memory after tools/providers change.

Success gate: the system can show `available / degraded / unavailable / review` capability families and their owning source without pretending cached metadata is live availability.

## P4 — periodic context snapshots

Persist bounded context-inventory snapshots so weekly/daily summaries are incremental rather than rebuilt from scratch.

**Status:** PHASE A LIVE. Bridge now persists `data/context-inventory-state.json` as a bounded derived cache, refreshes it on material MSSR lifecycle changes or a one-hour TTL, keeps rolling daily resume snapshots, and reuses the stored weekly MSSR+Git projection between dashboard refreshes. Source gates measured the isolated worker at roughly 4.0 s for a forced rebuild and ~1.0 s for the next cached snapshot. Remaining P4 work is the 30-day derived view and further refinement of event/freshness triggers if evidence shows the hourly fallback is too coarse.

Cadence target:

- lightweight freshness check hourly or on material lifecycle/Git events;
- daily durable inventory snapshot;
- rolling seven-day and thirty-day summaries derived from snapshots + current evidence.

Constraints:

- no global `D:\Dev` Git scan on every dashboard refresh;
- no raw prompts/transcripts/private reasoning;
- no automatic project-truth writes;
- deduplicate by evidence identity/hash;
- rebuilding from `scope=all` remains the recovery path.

Success gate: `ayer`, `esta semana`, and `dónde quedamos` are fast even after restart.

## P5 — cross-project organization — PHASE A IMPLEMENTED

The Cockpit now builds a bounded **En qué está cada proyecto** map from projects observed in the rolling seven-day MSSR history. It joins current human tasks, last meaningful activity, Project Health, Git pressure and the next observable gate.

Current organization states:

- `active`: an open human task/gate is still observable;
- `paused`: no recent task activity; this never means finished;
- `experimental`: explicit experiment/prototype/spike identity;
- `review-needed`: lifecycle/health/evidence requires human classification;
- `finished`: reserved for explicit owner evidence;
- `abandoned-or-replaced`: reserved for explicit owner evidence.

The dashboard must not derive `finished` or `abandoned-or-replaced` from age, silence, clean Git, closed traces or an execution-level supersedes edge. Phase B may add an explicit project-owner classification contract so those terminal organization states can be recorded without turning the Cockpit into authority.

The map is the ownership evidence input for P6. It does not rename/move/delete projects automatically.

## P6 — shared dirty-tree cleanup — LAST

Bridge currently contains concurrent work from multiple chats/agents. Cleanup must happen only after the context layer can explain ownership.

Procedure:

1. snapshot the shared tree;
2. partition changed paths by workflow/trace/evidence;
3. identify unowned or ambiguous changes;
4. run focused gates per partition;
5. stage/commit only one ownership-safe partition at a time;
6. verify commit readback and remote separately;
7. leave unrelated work untouched.

No `git add -A`, blind restore, or global cleanup while ownership remains ambiguous.

## Current execution checkpoint — 2026-09-26

Priority order from here:

1. **P1 + P2 + P3 adopted live:** `Al volver` separates forensic/support recovery from the human backlog, MSSR 0.2.77 provides explicit task identity/lineage, and capability inventory is dynamically derived from runtime tools, Skill Health and workflow guides;
2. **P4 phase A adopted live:** bounded context inventory + daily snapshots prevent weekly `scope=all` reconstruction on every refresh; a 30-day derived view/background cadence remains optional follow-up;
3. **P5 phase A adopted live:** the Cockpit now classifies observed projects conservatively and exposes current tasks, Git pressure, classification confidence/reason and next gate. Focused check/build + Human Cockpit/context-inventory tests passed, restart `a2e36afb-4bd8-4294-9366-63ae7a3a9bed` adopted the source, and the fresh live snapshot exposed 19 projects (`1 active / 16 review-needed / 2 paused`) while keeping `finished` / `abandoned-or-replaced` at zero without explicit owner evidence;
4. **P6 is now current and mutation-gated:** the read-only ownership partition is drafted in `docs/BRIDGE_DIRTY_TREE_RECOVERY_PLAN.md` for the 81 current dirty paths, with dedicated owner buckets and aggregate/shared files deferred to hunk-level review. Actual staging/cleanup is blocked until rollback capacity is safe: workspace snapshot storage is currently ~99.92% utilized (about 878 KB free), so no new cleanup mutation should begin merely to obtain a clean `git status`;
5. keep `finished` / `abandoned-or-replaced` explicit-owner-only and keep capability/schema freshness dynamic rather than copying volatile catalogs into AGENTS or assistant memory.

A new workspace-level `D:\Dev\AGENTS.md` owns only transversal procedure: Bridge-first local recovery, MSSR lifecycle, dynamic capability discovery, support-trace handling and safe shared-tree rules. It deliberately contains no static tool/skill catalog; repository-local `AGENTS.md` and `.mssr/` remain the project authorities.

Forensic workflows such as `recent-work-recovery-*` and `cross-project-recovery-*` remain observable MSSR evidence but are projected as support work, not independent human tasks. Their unresolved lifecycle debt stays countable for maintenance without turning the morning brief into a list of the auditor's own traces.

## Product principle

MauroPrime is becoming a context layer between human intent, ChatGPT/Codex, local projects, Git, runtime tools and MSSR. The useful product is not "remember every chat"; it is **capture durable evidence at the boundaries, correlate it, and present the smallest current context needed to resume work**.
