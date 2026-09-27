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

## P1 — morning brief + unfinished-work recovery — LIVE / REFINED

`Al volver` now answers what happened yesterday and separates **current human work** from **MSSR lifecycle debt**.

Required evidence:

- substantive MSSR work grouped by project/workflow or explicit `taskKey`;
- explicit outcomes vs open traces;
- idle/closure reminders such as `mssr-web-outcome-missing-after-idle`;
- latest bounded human summary and lifecycle phase;
- weekly Git pressure as supporting evidence, never as inferred completion.

Rules:

- Never auto-close a trace because it became idle.
- A trace with substantive activity + closure reminder + no later outcome becomes `needsClosureReview`, not `failed`.
- `needsClosureReview` is projected in a separate **Deuda MSSR** lane instead of ordinary active product work. It remains resumable and auditable, but the next action is to review whether to resume or record an outcome—not to blindly continue implementation.
- Active-work and lifecycle-debt items both keep bounded resume packets; no raw prompts/transcripts/private reasoning are stored.
- A newer trace for the same explicit task may supersede/retry an older execution in the UI, but provenance remains visible and lifecycle state is never rewritten by the dashboard.
- Unknown transcript labels (for example a bad speech transcription) are not promoted into project names without repository/MSSR evidence.
- A Bridge-managed terminal correlated to the task and still alive with recent progress is projected as runtime-active. If the durable lifecycle says it needs closure review, that debt is temporarily deferred from the visible debt lane while the process progresses; terminal liveness is ephemeral response-time evidence, never persisted and never allowed to rewrite MSSR lifecycle.

Success gate met: after opening the dashboard, Mauro can see yesterday, real work to continue, and separate lifecycle debt without reading handoffs/README files or confusing an administrative missing outcome with a feature still pending.

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

**Status:** PHASE B LIVE. Bridge persists `data/context-inventory-state.json` as a bounded derived cache, refreshes it on material MSSR lifecycle changes or a one-hour TTL, keeps rolling daily resume snapshots, and reuses the stored weekly MSSR+Git projection between dashboard refreshes. The dashboard now exposes **Últimos 30 días** directly from those retained daily snapshots—unique projects/workflows, active-day counts, latest bounded project summaries and truthful `snapshotCount / days` coverage—without a routine 30-day `scope=all` scan. Controlled restart `fba9953d-78cf-4578-bd06-b4458c03fbf3` adopted the slice live; readback showed 9/30 snapshots (30% partial coverage), 19 projects, 144 workflows and 470 trace-day observations. A direct cold/recovery profile isolated the dominant costs to MSSR summaries: active 30-day summary ~32.0 s and seven-day `scope=all` ~40.2 s on the busy workstation, while recent/Project Health/Skill Health/Runtime Health were each below 100 ms. With a valid cached inventory, a standalone persistent-worker run measured ~9.2 s first / ~1.0 s second; the final aggregate gate under heavier contention measured ~71.5 s first / ~1.3 s second, showing that warm reuse is stable while cold cost remains load-sensitive. HTTP liveness still passed with zero event-loop stalls. Remaining P4 work is therefore optimization/recovery policy, not basic product availability: trim the explicit missing/corrupt-cache reconstruction path, refine freshness triggers only where evidence requires it, and define an auditable snapshot-retention/quota policy.

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

## P5 — cross-project organization — PHASE B LIVE

The Cockpit builds a bounded **En qué está cada proyecto** map from projects observed in the rolling seven-day MSSR history. It joins current human tasks, last meaningful activity, Project Health, Git pressure and the next observable gate.

Current organization states:

- `active`: an open human task/gate is still observable;
- `paused`: no recent task activity; this never means finished;
- `experimental`: explicit experiment/prototype/spike identity;
- `review-needed`: lifecycle/health/evidence requires human classification;
- `finished`: explicit terminal evidence from the owning project;
- `abandoned-or-replaced`: explicit terminal evidence from the owning project.

Phase B defines the owner contract without adding a new workspace authority: an owning repository may declare `## Workspace status` inside canonical `.mssr/PROJECT_STATE.md`, with terminal `State`, required `Updated-At`, and optional bounded `Reason` / `Replaced-By`. Project Health carries only those metadata fields. Invalid declarations become REVIEW; substantive MSSR activity newer than the declaration forces `review-needed`, so stale `finished`/replacement state cannot silently override later work. Age, silence, clean Git, closed traces and execution-level supersedes edges remain insufficient to infer terminal project state.

The map remains ownership/orientation evidence. It does not rename/move/delete projects or mass-write terminal labels automatically.

## P6 — shared dirty-tree cleanup — DONE LOCALLY

The shared Bridge worktree has been reconciled through an ownership-safe recovery branch rather than a blind cleanup. The frozen dirty `main` was replayed into `recovery/p6-integration-20260926`, partitioned into dedicated subsystem commits plus one mixed host-integration commit, verified, and only then adopted back into local `main`.

Final safety evidence:

1. external rollback ZIP verified before mutation: `D:\MauroPrimeBackups\bridge-mcp\2026-09-26-pre-p6\bridge-mcp-pre-p6.zip`, SHA-256 `04387e9238de315ea1fb212542f351f2d5aa23572d3bcb9ee4e968e69bc7811b`;
2. frozen source and recovery branch covered exactly the same 92 Git-visible dirty paths;
3. 90 paths were byte-identical at the final parity gate;
4. the only two branch-newer differences were deliberate: this recovery-plan documentation and the MSSR semantic-adoption regression corrected from 0.2.75 to 0.2.77;
5. focused integration gates and `bridge_self_check` passed on the clean recovery worktree;
6. local `main` was reconciled to `f0deaa9` only after `safeToReconcile=true`;
7. post-reconciliation `git status` is clean and local `main` is 10 commits ahead of `origin/main`.

No remote push was performed. Remote publication remains a separate explicit decision. The reusable rule remains unchanged: never use `git add -A`, blind restore, reset or cleanup on a shared dirty tree until ownership, rollback and parity are observable.

## P7 — MSSR control-plane proportionality / friction audit — ACTIVE

The continuity layer has proven useful under interrupted/compacted conversational surfaces, but the control plane must stay proportional to the operation. The evidence-backed audit is tracked in `docs/MSSR_FRICTION_AUDIT_2026-09-27.md`.

Current findings:

- R2 already intends trivial reads/inspection to stay lightweight; the problem is not a missing lightweight concept but how agent/host intent, managed routing and lifecycle obligations compose after activation;
- one real audit bootstrap returned 31,638 characters on its first page plus 13,004 on continuation to deliver 10,420 procedural characters, showing that a caller-visible skill budget is not the same thing as the real total control envelope;
- cold guide recommendation can dominate `project_context_load` even when it selects no guide;
- semantic fields such as `review` and `repeated-friction` can legitimately but unexpectedly ratchet verification/maintenance requirements when the agent over-classifies a small task;
- observability itself is currently unsafe for model attention at large bounds: one live query took ~81 s and emitted 463,716 characters, while another audit summary took ~92 s;
- a synthetic route in a sibling project can become the sticky implicit session attribution for later calls; R1 correctly blocks cross-owner adoption, but observability/debt provenance can still become noisy until the owner is explicitly restored;
- R3 retention safety is correct, but compaction/restart can force procedural re-delivery and therefore amplify context pressure after a conversational interruption.

P7 must extend the existing R2/R3 contracts instead of creating a parallel router. Priorities are bounded observatory output + durable async/export recovery, explicit/scoped multi-project trace attribution, one surfaced total control-context budget, telemetry/synthetic routing without human lifecycle debt, a first-class cheap retire/cancel path for synthetic traces plus close-intent scope guards, lazy guide discovery, intent-escalation explainability, and idle-reminder backoff around known progress. Existing R1/R2/R3 safety gates remain non-negotiable.

Success gate: trivial operations remain truly lightweight; bounded read-only inquiries have a visible small total context cost; synthetic/audit probes do not pollute human backlog/debt; cross-project attribution remains exact; and deep observability requires explicit opt-in rather than returning unbounded context by default.

## Current execution checkpoint — 2026-09-27

Current status and follow-up priority:

1. **P1 + P2 + P3 adopted live:** `Al volver` separates forensic/support recovery from the human backlog, MSSR 0.2.77 provides explicit task identity/lineage, capability inventory stays dynamically derived from runtime tools/Skill Health/workflow guides, and the new response-time terminal overlay prevents a genuinely progressing Bridge process from masquerading as abandoned lifecycle debt without persisting liveness as project truth;
2. **P4 phase B adopted live:** bounded context inventory + daily snapshots feed both weekly reconstruction and **Últimos 30 días**. Live evidence after restart `fba9953d-78cf-4578-bd06-b4458c03fbf3` is 9/30 retained days (30% truthful coverage), 19 projects, 144 workflows and 470 trace-day observations; the view becomes more complete automatically as daily snapshots accumulate;
3. **P5A + P5B adopted live:** the Cockpit classifies observed projects conservatively and terminal states have an explicit owner contract in `.mssr/PROJECT_STATE.md`, with invalid-metadata REVIEW and stale-state conflict detection. No terminal labels are mass-written;
4. **P6 + Context Director persistence completed locally:** the former 92-path shared dirty tree was reconstructed with durable rollback and ownership-safe commits, and the runtime/30-day Context Director slice was subsequently persisted as scoped local commit `d4a5fe2`; remote publication remains deliberately separate;
5. **current product priority:** complete P7 MSSR proportionality hardening first—bound observability, fix scoped trace attribution, expose total context cost and prevent synthetic/read-only work from creating disproportionate lifecycle debt—then return to the already-isolated P4 missing/corrupt-cache recovery cost (~32.0 s active 30-day MSSR summary + ~40.2 s seven-day `scope=all`) and snapshot retention/quota policy. Capability/schema freshness stays dynamic rather than copied into AGENTS or assistant memory.

A new workspace-level `D:\Dev\AGENTS.md` owns only transversal procedure: Bridge-first local recovery, MSSR lifecycle, dynamic capability discovery, support-trace handling and safe shared-tree rules. It deliberately contains no static tool/skill catalog; repository-local `AGENTS.md` and `.mssr/` remain the project authorities.

Forensic workflows such as `recent-work-recovery-*` and `cross-project-recovery-*` remain observable MSSR evidence but are projected as support work, not independent human tasks. Their unresolved lifecycle debt stays countable for maintenance without turning the morning brief into a list of the auditor's own traces.

## Product principle

MauroPrime is becoming a context layer between human intent, ChatGPT/Codex, local projects, Git, runtime tools and MSSR. The useful product is not "remember every chat"; it is **capture durable evidence at the boundaries, correlate it, and present the smallest current context needed to resume work**.
