# MSSR control-plane friction audit — 2026-09-27

Status: evidence-backed audit in progress; documentation slice only. No runtime/package fix is claimed by this document.

## Scope

This audit evaluates the live local stack observed on 2026-09-27: Bridge `0.6.141` consuming exact `@mauroprime/mssr 0.2.77`. It focuses on whether MSSR remains proportional to the work being performed: what causes routing/context loads, how much absolute context is delivered, which lifecycle obligations are inferred, how cross-project work is attributed, and how recovery/observability paths behave under real load.

The audit does **not** claim that Bridge/MSSR caused recent ChatGPT Web conversation truncations/resets. Those UI/backend events are not observable from Bridge. The relevant question here is narrower: when a conversational surface loses context, does the local control plane recover efficiently, or does it amplify context/ceremony while doing so?

## Executive finding

The continuity architecture is useful and has repeatedly allowed work to survive interrupted conversational surfaces through Project Context, Git, bounded resume packets, traces and handoffs. The current weakness is proportionality: once work enters the managed MSSR path, the agent/host can describe an intent broadly enough that deterministic routing expands it into more context, phases and administrative lifecycle than the immediate operation needs.

This is not simply "the agent is curious" and it is not simply "MSSR forces everything". The boundary is shared:

1. the agent/host decides whether substantial work should route and supplies structured semantic intent;
2. Bridge classifies individual tool effects/scales and applies portable MSSR R2 activation policy;
3. once a managed route exists, MSSR deterministically selects required skills/modules/phases from that intent and lifecycle state;
4. after compaction/restart, R3 correctly refuses to assume that prior procedural text is still retained, so required material may be re-delivered.

The original MSSR design already states that ordinary/trivial operations should stay cheap. The audit therefore treats the current problem as **activation/context/lifecycle proportionality and host ergonomics**, not as a reason to remove lifecycle safety.

## Direct evidence

### A. One real audit bootstrap consumed a large envelope

The main audit trace is `mssr-20260927044051-78beb849-87e`, workflow `bridge-mssr-friction-audit-20260927`.

With `maxContextChars=12000`, selective loading and six candidate skills:

- first context assembly delivered 4,506 procedural characters but returned a 31,638-character response inside a 32,000-character envelope;
- five required units remained and a continuation page was mandatory;
- the second page delivered 5,914 procedural characters and returned 13,004 characters;
- total procedural delivery across both pages was 10,420 characters, while the two responses totalled 44,642 characters;
- the first route also selected Project Context and Context Messages in addition to skill material.

The important correction is that this is not an accidental overflow. Bridge/MSSR intentionally has separate limits for procedural skill context and the total response envelope. The friction is that callers commonly reason about the smaller `maxContextChars` value while the actual turn can legally approach the much larger envelope. Absolute cost is not obvious enough.

The later verification replan made the same issue even clearer. A deliberately tighter `maxEnvelopeChars=16000` failed before delivery because compact metadata alone was 13,228 characters, leaving a 256-character page budget that could not fit one indivisible required unit. Raising the envelope to 24,000 allowed the phase to proceed, but required three pages: response sizes 23,784 + 14,224 + 4,566 characters to deliver about 10,121 procedural characters. That verify bootstrap also selected 5,021 characters of Project Context plus a 985-character Context Message. The control-plane cost is therefore not reducible to "skill text"; route metadata, project evidence and context-message delivery can dominate the usable procedural budget.

### B. Project bootstrap can spend seconds recommending no guide

A cold `project_context_load` against canonical `D:\Dev\mssr` took about 4.1 seconds. Roughly 3.31 seconds belonged to workflow-guide recommendation, which concluded `action: none` while still returning a guide catalog/description payload. A later bridge project load with guide recommendation disabled completed in about 0.63 seconds.

This does not prove guide discovery is always slow; a warm routing probe showed guide recommendation in single-digit milliseconds. It does show that cold guide discovery is allowed to dominate a task even when no guide is selected.

### C. Small semantic differences ratchet lifecycle

Two synthetic read-only probes were compared:

- `discover + review` for "read git status and explain" created a route whose required phases included discovery + verification; the cold route took about 597 ms, with about 532 ms spent in guide recommendation even though no guide applied;
- `discover` only for "read git status" required discovery only; the warm route completed in about 29 ms, with guide recommendation around 9 ms.

The agent's structured intent therefore matters materially. Broad verbs such as `review`, or anomaly signals such as `repeated-friction`, are not harmless descriptive metadata; they can deterministically add lifecycle phases. This is useful when intentional and noisy when an agent over-classifies a simple task.

### D. Maintenance is currently triggered by semantic friction signals

Portable routing currently adds `maintenance` when signals such as `repeated-friction` or `conflicting-evidence` are present. The main audit therefore required maintenance simply because the task was explicitly an audit of repeated friction. Any route also eventually requires closure/outcome accounting, while other phases such as verification/persistence depend on intent/actions/risk.

This is coherent for substantive change work, but it produces an observer effect: measuring routing friction can itself create new lifecycle work and new debt unless the synthetic/audit trace is explicitly closed.

### E. Idle reminders are safe but noisy

The main audit trace received a closure reminder after about 180 seconds of inactivity while the audit was still active. The trace remained open and no success/failure was synthesized; this guardrail is correct. However, the reminder added administrative noise during a long-running investigative task. Runtime-aware suppression already exists for some Cockpit projections, but the underlying reminder policy should distinguish genuine abandonment from known ongoing/async work and should back off rather than repeatedly demand attention.

### F. Observability can be more expensive than the work it observes

Observed `mssr_observatory_query` calls were extremely heavy:

- one active summary in the main audit took about 92 seconds;
- one later `recent`, active, 3-day, limit-200 query took about 81 seconds and produced 463,716 output characters.

A control-plane observability query capable of returning nearly half a million characters can itself consume a large model context window and distort the system being audited. Compact/default observability must be strongly bounded; raw/debug/export paths should be explicit.

A related recovery-path mismatch was also observed: one observatory request exposed a background `workId/sessionId` and artifact path, but the session was already unavailable when inspected and the advertised `.mssr/runs/...` artifact path was not present. The exact source contract still needs implementation-level diagnosis, but callers currently cannot rely on that result as a durable recovery handle.

### G. Cross-project session attribution is sticky

The audit intentionally switched from `bridge-mcp` to the sibling `mssr` repository for read-only source inspection and created synthetic route probes there. After the latest synthetic route became active in the same ChatGPT Web session, subsequent `mssr` reads were automatically attributed to that probe workflow even though they logically belonged to the parent audit.

The R1 owner guardrail worked correctly: an explicit attempt to adopt the main `bridge-mcp` trace while the session was implicitly positioned at the `mssr` probe was rejected with `mssr-trace-owner-mismatch`. No repository truth was corrupted.

The problem is stronger than an ergonomic inconvenience. After restoring the parent owner and re-reading the main audit trace, its evidence bundle listed `workflowKeys: [bridge-mssr-friction-audit-20260927, mssr-discover-probe-20260927]` and `projects: [bridge-mcp, mssr]`. The R1 owner mismatch guard correctly prevented explicit cross-owner adoption, but same-session related attribution still leaked synthetic workflow/project identity into the parent trace evidence. That can contaminate observability, debt counts, resume maps and "who did what" history even while destructive ownership remains protected. Treat this as a provenance P0/P1 defect: per-call explicit attribution or a scoped trace stack is preferable, and parent/related/synthetic identity must never be merged implicitly.

### H. Compaction recovery can amplify context pressure

R3 Context Economy v2 deliberately suppresses procedural re-delivery only when the host can attest that the exact id/fingerprint is still present in the current uncompacted context. After compaction, restart or handoff, missing retention receipts correctly force re-delivery rather than trusting historical loads.

That safety rule is sound, but it creates a possible positive feedback loop: context pressure -> compaction -> retention can no longer be attested -> procedural material is re-delivered -> more context pressure. This audit does **not** claim that loop caused ChatGPT Web resets; it identifies it as an amplification mechanism worth measuring after a reset/compaction occurs.

### I. Historical incidents show this failure class is recurrent

Canonical MSSR incident history already contains close relatives of the current findings:

- MSSR-040: twelve Context Messages estimated at 320 chars each serialized to 14,704 chars, helping compact metadata reach 58,329 chars before procedural content could fit; accounting was corrected to use real serialized size;
- MSSR-041: broad semantic matching caused an ordinary code audit to require a visual-evidence lifecycle that was not actually relevant;
- MSSR-042: maintenance/recovery candidates crowded out a domain owner under a bounded skill budget.

The current audit should therefore be treated as continuation of an established proportionality problem class, not a completely new theory.

### J. Trace retirement is highly sensitive to the closing intent

Closing the two synthetic probes isolated the agent-vs-router boundary particularly well:

- the discover-only probe was closed with its original minimal `git + discover` intent, selected no required skills/maintenance at close, and reached `closed-skipped` with a bounded close replan + skipped outcome;
- the read-only review probe was accidentally described at close with an additional `skill-system` domain. That one semantic expansion activated the `skill-system-maintenance` workflow, added `shared-skill-governance` + `skill-maintenance-loop` as required skills and made maintenance mandatory. Recording a skipped outcome before loading them did not immediately clear the obligations; the probe only settled as `closed-skipped` after the newly required skills were loaded and maintenance was explicitly reviewed-none.

This is strong evidence that the agent can create ceremony by over-describing the task, while MSSR then correctly but rigidly enforces the route it was given. P7 should therefore provide a first-class **cancel/retire synthetic trace** semantic that preserves audit evidence without allowing the retirement request itself to widen routing, and should lint close-time intent expansion against the original trace unless the caller explicitly explains why the scope changed.

## Conversation-history corroboration (non-canonical evidence)

A bounded review of recent ChatGPT conversation history corroborates the operational pattern without changing project truth:

- on 2026-09-23 a MauroPrime validation disconnected while a slice was still open; later continuation required reconstructing and closing from durable state rather than conversational continuity;
- on 2026-09-25 Mauro explicitly asked "en qué quedamos" after repeated continuation messages and then corrected the assistant for resuming the wrong thread of work; the durable Bridge/MSSR state was needed to realign the task;
- another 2026-09-25 benchmark lost transient stdout after its temporary Bridge session was cleaned, forcing recovery/re-execution with persisted evidence;
- several recent sessions contain repeated `.` / `-` continuations where the assistant re-established project state from Bridge/MSSR/Git instead of receiving a complete conversational prefix.

These examples show why the continuity layer is valuable **and** why proportional recovery matters. They do not establish whether the original interruption was caused by ChatGPT Web, transport, Bridge, MSSR, session cleanup or another layer.

## Safeguards that are working

Do not remove these while reducing friction:

- R2 already distinguishes lightweight from managed work and explicitly intends trivial reads/inspection to remain cheap;
- R1 owner isolation fails closed on trace/project/workflow mismatch;
- R3 does not lie about retained context after compaction/restart;
- Project Context is modular and can load only core material before intent;
- the Cockpit already separates human work, lifecycle debt, support/recovery work and synthetic fixtures in several views;
- persisted context inventory/daily snapshots make the normal warm resume path much faster than cold historical reconstruction;
- lifecycle reminders do not synthesize success or failure.

## Friction taxonomy and priority

### P0/P1 — protect context and attribution

1. **Bound observatory output and latency.** Compact/default responses must never emit hundreds of thousands of characters. Large forensic exports need an explicit debug/export mode and durable retrievable artifact.
2. **Fix scoped trace attribution for multi-project sessions.** The active route of one synthetic/project probe must not silently become the owner attribution of unrelated subsequent calls. Preserve owner vs related-project separately.
3. **Make async observability recovery durable.** If a work/artifact handle is returned, it must remain retrievable after worker/session cleanup, or the API must not advertise it as a recovery handle.

### P1 — make MSSR proportional

4. **Expose one first-class total control-context budget.** Keep source-specific budgets internally, but surface total response/envelope cost as the user/agent-visible limit and metric.
5. **Add telemetry-only / synthetic mode with terminal retirement.** Routing probes, audits and tiny bounded inquiries should be observable without creating human lifecycle debt, and a synthetic trace must have a cheap retire/cancel path that cannot widen its own routing scope. This should extend R2 rather than introduce a parallel router.
6. **Make workflow-guide discovery lazy.** Lightweight/read-only operations should skip it; compact `none` decisions should not return an unnecessary guide catalog.
7. **Reduce idle-reminder noise.** Suppress/defer while a correlated async operation is active or recent progress exists, and use backoff.
8. **Add intent-minimization diagnostics.** Explain which exact intent field added each skill/phase and warn when a broad field (`review`, `repeated-friction`, generic maintenance) materially escalates an otherwise small task.

### P2 — improve recovery and model attention

9. **Measure post-compaction re-delivery.** Track retained vs re-delivered chars/pages and whether the re-delivery was caused by compaction/restart/changed fingerprint.
10. **Prefer observed effects over descriptive intent when possible.** Persistence/verification/maintenance should increasingly use observable writes/risk/evidence, while semantic intent remains the plan—not the only proof that a phase was needed.
11. **Expose absolute control-plane cost in the Cockpit.** Percent saved is insufficient. Show chars, pages, routing/guide latency, lifecycle events and why material loaded.

### Separate performance track

The existing P4 cold/missing-cache recovery issue remains real but separate: active 30-day MSSR summary is roughly 32 s and seven-day `scope=all` roughly 40.2 s on the profiled workstation, versus about 1–1.3 s on warm reuse. That should remain a recovery optimization after the control-plane correctness/proportionality issues above are bounded.

## Extend R2 instead of inventing another system

A useful mental model is a stricter tiering of the existing `lightweight / managed / review` policy:

- **L0 lightweight:** trivial read/inspect; no lifecycle trace, no guide scan, no Project Context beyond what is already known, telemetry only;
- **L1 bounded inquiry:** substantive read-only analysis with a hard small total budget and at most one compact page; trace may be telemetry-only; no persistence obligation; verification only when explicitly requested/observed;
- **L2 managed mutation:** route + relevant Project Context + verification/persistence according to actual effects;
- **L3 strict/high-risk:** shared dirty trees, publish, destructive operations, recovery, routing/skill changes and external side effects retain full MSSR ceremony.

This is not a new router. It is a proportionality contract on top of the existing R2 activation decision and trace semantics.

## Acceptance gates for the next implementation slices

1. A `git status` + short explanation can remain lightweight, produce no human lifecycle debt and consume a small bounded control payload.
2. A bounded read-only code/repository review can stay under a declared total context ceiling (target order: <=8k control chars in normal compact mode) unless the caller explicitly opts into deeper evidence.
3. `maxContextChars`/envelope/project/messages costs are surfaced together so the agent cannot mistake a skill-only budget for the real turn cost.
4. Compact observatory queries return bounded summaries (target order: <=20k chars) and warm response latency is measured; larger forensic output requires explicit export/debug.
5. Any returned background observatory result has a durable retrievable handle independent of terminal-session GC.
6. A synthetic route/probe is visibly synthetic/telemetry-only and cannot enter Mauro's human work or lifecycle-debt lanes.
7. Cross-project operations cannot silently steal the caller session's active route attribution; owner and related project remain distinct.
8. Idle reminders do not interrupt a known-progressing correlated job and back off for long investigations.
9. After simulated compaction/restart, only actually unretained/changed required procedural units are re-delivered and the re-delivery cost is observable.
10. Existing R1/R2/R3 safety regressions remain green; reducing ceremony must not weaken destructive/publish/shared-tree controls.

## Immediate implementation order

1. Bound `mssr_observatory_query` compact responses and make async/export recovery durable.
2. Harden session/trace scoping for multi-project callers and add regression coverage for sticky-route contamination.
3. Expose total control-plane context cost/breakdown and add a telemetry/synthetic lifecycle class or equivalent R2 extension.
4. Make guide discovery lazy/compact for lightweight and bounded inquiry paths.
5. Add intent-escalation explainability and idle/backoff metrics.
6. Return to P4 missing/corrupt-cache recovery and retention/quota optimization.

## Root-cause boundary for recent chat resets

Multiple conversational surfaces appearing to lose context around the same period is relevant operational evidence, but Bridge does not see ChatGPT Web's internal context-management/backend events. Do not label the reset cause as MSSR, Bridge, transport or ChatGPT without external evidence. What can be tested locally is recovery quality: how many bytes/pages/routing steps are needed to reconstruct a task, whether that reconstruction is correctly attributed, and whether it creates unnecessary new lifecycle debt.
