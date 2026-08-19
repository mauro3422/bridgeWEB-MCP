# MSSR trace owner integrity

A Bridge MSSR trace has an authoritative host owner when `project` and/or `workflowKey` are known. `sessionKey` is a continuity hint; it must never override a conflicting known project or workflow owner.

Implicit trace recovery is allowed only when known owner dimensions are compatible. Unknown/unscoped dimensions may acquire a known owner, and the same owner may recover across connector/session rotation. A known project A must not be inherited by project B merely because the session or caller matches; likewise a known workflow A must not be inherited by workflow B.

An explicit `traceId` is a deliberate reference to a concrete trace, not permission to silently migrate that trace's owner. Auxiliary filesystem/repository work inside an already active workflow keeps the active trace owner and records the observed repository as `related_project`; it does not replace the primary project.

The same compatibility rule applies to local active state, process-shared recovery, persisted SQLite recovery, metric attribution, and evidence projection. A trace's `identity.projects` and `workflowKeys` must not accumulate an unrelated independent project/workflow through implicit session continuity, because that would also contaminate learning and maintenance evidence.