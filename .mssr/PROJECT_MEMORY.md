# Bridge project memory

Optional durable project memories are reference-backed under `.mssr/knowledge/` and indexed by `.mssr/project-context.json`. Keep this root compact: record brief pointers for cross-cutting decisions here and keep technical detail in its indexed owner. Repository-wide reconciliation and continuity handoffs are recorded in `PROJECT_STATE.md` plus bounded docs rather than duplicated here; MSSR selects the relevant modules by stage and structured intent.

## Durable decisions

- **Trace identity:** an explicitly supplied unknown `traceId` has no existing state and cannot borrow another task's `localTraceId` or closure timer. The exact invariant and regression are in [trace integrity and lifecycle](knowledge/observability/trace-integrity-and-lifecycle.md). This prevents explicit task IDs from being rebound to unrelated session work.
- **Jev confidence:** provider scores remain uncalibrated selection evidence, not probabilities or a pass threshold; no automatic confidence cutoff or proposal application follows from the current exploratory runs. The benchmark evidence, blind-review limits, and calibration gates are recorded in [MSSR Librarian/Jev](../docs/MSSR_LIBRARIAN_JEV.md).
