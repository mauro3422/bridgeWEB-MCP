# Bridge adapter — MauroPrime Operational Notice Plane

## Role

Bridge is a delivery host for the portable MSSR Operational Notice Plane. It does not own the host-neutral rule that decides whether an observation deserves attention.

Canonical semantic contract:

- `@mauroprime/mssr` `evaluateMssrOperationalNoticeTransition(...)`
- MSSR `docs/OPERATIONAL_NOTICE_PLANE.md`
- MSSR ADR 0002

Bridge owns:

- host/runtime/project observation I/O and host-owned timers;
- bounded host evidence only for genuinely Bridge-owned observation/persistence such as Skill Health, Project Context Health and runtime-health snapshots; portable lifecycle/maintenance/freshness/infrastructure/provider identities come from packaged MSSR;
- adaptation to `BridgeNoticeInput`;
- `emitBridgeNotice()` queueing, TTL, pending dedupe, automatic drain into ordinary MCP responses, and 24-hour recent history;
- dashboard/API projection and host-specific suggested actions;
- runtime adoption/restart/readback evidence.

Bridge does **not** create a second MSSR notice queue.

## Delivery path

```text
host/project observation
  -> portable MSSR transition decision
  -> Bridge adapter builds BridgeNoticeInput
  -> emitBridgeNotice()
  -> bounded queue + recent history
  -> later normal MCP response drains pending notices
  -> agent observes and decides
```

Delivery is piggybacked on a later observable MCP boundary. It cannot interrupt an opaque active tool call and must not be described as unsolicited ChatGPT server push.

## Gate E3 relay adoption — 0.6.106 / MSSR 0.2.31

Gate E3 adopts the portable `MssrNotice v1` envelope without replacing Bridge transport:

```text
genuine MSSR decision
  -> strict MssrNotice v1
  -> Bridge validates and embeds it as BridgeNotice.mssrNotice
  -> Bridge adds delivery metadata/actions outside the semantic payload
  -> existing bridgeNotices queue/history/automatic drain
```

Invariants:

- `BridgeNotice.mssrNotice` is the exact validated portable semantic payload. Bridge does not merge host details, queue ids, TTL, timestamps, occurrences, UI projection or executable suggestions into it.
- `MssrNotice.noticeId` remains the semantic lifecycle identity. `BridgeNotice.id` remains a host queue/delivery id and does not replace it.
- Bridge may mirror semantic fields such as event/subject/current level in host `details` for compatibility and diagnostics, but those mirrors are derived from the preserved payload and cannot overwrite it.
- The existing `bridgeNotices` queue is still the only general Bridge notice transport; E3 adds no MSSR queue, spool, sink or scheduler.
- Native Bridge notices and relayed foreign-MCP notices remain native/foreign. Absence of a valid genuine MSSR payload means no `mssrNotice` field; Bridge never normalizes or relabels a foreign notice as MSSR.
- Relay regression uses MSSR `serializeMssrNoticeV1` / `hasSameMssrNoticeV1Semantics` to prove semantic equality before and after Bridge queue/drain, independently from host delivery metadata.

## Gate E5 migration/invariant closure — 0.6.107 / MSSR 0.2.32

Gate E5 changes no notice transport algorithm. It adopts MSSR 0.2.32 and proves that the E1–E4 boundaries compose without semantic collapse:

- repeated copies of one semantic MSSR event keep the portable `dedupeKey`/`noticeId`, coalesce only in the existing Bridge host queue, and increment only host-owned occurrence metadata;
- ordinary Bridge-native notices remain plain `BridgeNotice` values and never receive synthetic MSSR semantics;
- generic external-MCP notices use the same host transport while preserving their external source/code/details and never being normalized into `MssrNotice`;
- the E4 `deliverMssrNoticeV1(...)` direct-host boundary remains available from packaged MSSR but does not replace or create a second Bridge path;
- strict `MssrNotice` rejects queue/TTL/attempt/delivery/action/execution fields and remains `advisoryOnly`; Bridge `actions` are inert host metadata returned by delivery and are never semantic authority;
- MSSR, Bridge-native and external-MCP notices share one existing Bridge queue. Gate E5 adds no MCP tool, queue, retry runtime or scheduler.

The integration regression is `scripts/test-operational-notice-e5-invariants.mjs`. Gate E5 is complete only after full Bridge regression plus controlled live package/runtime readback prove the same invariants on the adopted release.

## First producer slice — 0.6.99

`src/operational-notices.ts` adapts two existing metadata-only daily projections:

### Skill Health

Fingerprint inputs:

- `status`
- `contextManifestStatus`
- sorted `reasonCodes`

Ignored for attention identity:

- timestamps
- raw skill/reference content
- absolute source paths
- volatile size deltas that do not change diagnosis

Actionable notice suggests `skill_route_audit`; it never executes it.

### Project Context Health

Fingerprint inputs:

- `level`
- `manifestStatus`
- sorted `finding.code:finding.target`

Ignored for attention identity:

- timestamps
- project file contents
- full PROJECT_* bodies
- changing counters that do not alter structural findings

Actionable notice suggests `project_context_audit`; it never executes it.

Both schedulers expose the immediately previous persisted snapshot to the adapter. This is necessary because pending-queue dedupe alone cannot suppress the same daily REVIEW after yesterday's notice has already been drained.

## Second producer slice — 0.6.100 / MSSR 0.2.20

The host trace coordinator now consumes three portable MSSR projections in addition to the daily health adapters:

- lifecycle idle/missing-outcome: Bridge owns the timer and progress lease, but MSSR decides that silence alone can only request `REVIEW`. A later explicit `progress` or real outcome resolves idle attention; no outcome is synthesized;
- project-knowledge maintenance: the old producer-specific notice key is gone. REVIEW/REQUIRED debt now uses the same semantic transition evaluator and can emit `changed`, escalation/deescalation and `resolved`. Resolution requires a maintenance close for the current lifecycle revision; later material evidence can invalidate and reopen it;
- Context Plane freshness: Bridge extracts current bounded freshness evidence while MSSR maps `fresh -> OK`, unknown-only -> `WATCH`, stale/unavailable -> `REVIEW`, conflicting -> `ERROR`. A fresh observation clears a previous freshness issue instead of preserving a historical maximum.

The idle timer was hardened during this migration: when a timer wakes it revalidates the current progress lease. If a newer lease is still active, the reminder is re-armed rather than emitting a stale warning. Timer durations and activity counters are delivery/runtime evidence only and are excluded from the portable semantic fingerprint.

A result with no Context Plane evidence does not erase the last observed freshness state. Unknown-only evidence remains below the default notification threshold and does not by itself force durable project maintenance. Once REVIEW/ERROR freshness has accrued durable maintenance debt, returning to fresh resolves the freshness notice but does not pretend the explicit maintenance obligation was completed.

## Third producer slice — 0.6.101 / MSSR 0.2.21

Gate C2a moves infrastructure/provider health onto portable MSSR projections while keeping all host observation in Bridge:

- `src/runtime-health.ts` observes local tunnel `healthz`/`readyz`, persisted runtime boot continuity, and bounded watchdog request/ack metadata. It stores at most 96 metadata-only snapshots in ignored `data/runtime-health.json` and exposes them through `/api/mssr/runtime-health` plus the dashboard;
- Bridge intentionally records transport as `not-observed`: a connector-side lost response or `502 Bad Gateway` can disappear outside the process, so the host must not invent that symptom after the fact. External transport evidence can be correlated separately with runtime/tunnel/restart/operation metrics;
- a healthy new boot is a notifiable `WATCH` rendered as `info`; pending restart or degraded tunnel is `REVIEW`; unavailable tunnel/runtime or failed restart is `ERROR`; returning below the prior attention state emits `resolved`;
- Roblox system awareness now maps catalog/provider health and Studio target continuity into `evaluateMssrProviderOperationalAttention`. Provider unavailability is distinct from a live provider whose target is warming, inactive, missing, ambiguous, or inspection-failed;
- the old Roblox `state !== previousState` notice policy/dedupe is removed. The shared transition evaluator owns opened/changed/escalated/deescalated/resolved semantics, while `bridgeNotices` remains the only delivery queue.

The runtime store excludes prompts, request payloads and restart reasons. PID, boot UUID, timestamps and request/ack ids may be retained as bounded diagnostic metadata where needed for continuity/readback, but portable semantic fingerprints exclude them. Package adoption also requires byte-parity readback: a same-version local `file:` tarball may be cached stale even when npm reports `up to date`.

## Transition behavior

With the default REVIEW threshold:

```text
unobserved/OK/WATCH -> REVIEW     opened
REVIEW + same fingerprint         quiet
REVIEW + changed fingerprint      changed
REVIEW -> ERROR                   escalated
ERROR -> REVIEW                   deescalated
REVIEW/ERROR -> WATCH/OK          resolved
OK/WATCH -> OK/WATCH              quiet
```

WATCH remains quiet by default.

## Safety invariants

1. A notice is evidence, not permission.
2. Suggested `toolName`/arguments are bounded recommendations only.
3. Producers must not autoedit the authority they diagnose.
4. Notice payloads remain metadata-bounded; no prompt/transcript/private reasoning capture.
5. Transport failures and tool-operation failures are distinct evidence. A connector losing an HTTP response during a runtime restart does not prove the underlying operation failed.
6. Source changes are not live until Bridge has installed the packaged MSSR artifact, rebuilt, restarted through the watchdog flow when executable behavior changed, and passed live readback.

## Next migrations

Continue incrementally on the same portable transition evaluator, preserving existing Bridge transport and requiring stable-state negative tests before removing producer-specific policy:

1. routing compliance / required-skill anomalies;
2. selected project-specific watchers where the evidence contract is reusable.

Do not perform a broad rewrite of all notice producers in one release.
