# MSSR trace lifecycle reconciliation

Bridge can hold two host views of one MSSR trace: process-shared RAM and lifecycle reconstructed from durable observatory events. They are projections of the same trace, not independent authorities.

Before lifecycle-sensitive explicit-trace operations (`skill_recommend`, `skill_route_plan`, `skill_bootstrap`, `skill_load`, `mssr_trace_record`) evaluate gates, Bridge reconciles a strictly fresher persisted lifecycle into RAM. Freshness is monotonic across lifecycle revision, route count, close revision, maintenance revision, and terminal closed state. A newer persisted close/maintenance checkpoint may unblock an outcome that stale RAM would reject.

Reconciliation never rewinds newer RAM. Loaded skills and completed phases may be unioned, while trace owner identity (`project`, `workflowKey`, caller/session ownership) remains governed by trace-owner-integrity and must not migrate.

Ordinary trace-aware tools do not perform this durable read. Keep reconciliation at lifecycle boundaries. Regression coverage must prove both directions: persisted-newer-than-RAM is adopted; RAM-newer-than-persisted is preserved.
