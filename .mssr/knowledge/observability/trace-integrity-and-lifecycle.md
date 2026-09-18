# MSSR trace integrity and lifecycle reconciliation

## Trace owner integrity

A Bridge MSSR trace has an authoritative host owner when `project` and/or `workflowKey` are known. `sessionKey` is a continuity hint; it must never override a conflicting known project or workflow owner.

Implicit trace recovery is allowed only when known owner dimensions are compatible. Unknown/unscoped dimensions may acquire a known owner, and the same owner may recover across connector/session rotation. A known project A must not be inherited by project B merely because the session or caller matches; likewise a known workflow A must not be inherited by workflow B.

An explicit `traceId` is a deliberate reference to a concrete trace, not permission to silently migrate that trace's owner. Auxiliary filesystem/repository work inside an already active workflow keeps the active trace owner and records the observed repository as `related_project`; it does not replace the primary project.

The same compatibility rule applies to local active state, process-shared recovery, persisted SQLite recovery, metric attribution, and evidence projection. A trace's `identity.projects` and `workflowKeys` must not accumulate an unrelated independent project/workflow through implicit session continuity, because that would also contaminate learning and maintenance evidence.

## Trace lifecycle reconciliation

Bridge can hold two host views of one MSSR trace: process-shared RAM and lifecycle reconstructed from durable observatory events. They are projections of the same trace, not independent authorities.

Before lifecycle-sensitive explicit-trace operations (`skill_recommend`, `skill_route_plan`, `skill_bootstrap`, `skill_load`, `mssr_trace_record`) evaluate gates, Bridge reconciles a strictly fresher persisted lifecycle into RAM. Freshness is monotonic across lifecycle revision, route count, close revision, maintenance revision, and terminal closed state. A newer persisted close/maintenance checkpoint may unblock an outcome that stale RAM would reject.

Reconciliation never rewinds newer RAM. Loaded skills and completed phases may be unioned, while trace owner identity (`project`, `workflowKey`, caller/session ownership) remains governed by the owner-integrity contract above and must not migrate.

Ordinary trace-aware tools do not perform this durable read. Keep reconciliation at lifecycle boundaries. Regression coverage must prove both directions: persisted-newer-than-RAM is adopted; RAM-newer-than-persisted is preserved.
