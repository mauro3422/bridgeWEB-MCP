# MSSR trace integrity and lifecycle

## Trace owner integrity

A Bridge MSSR trace has an authoritative owner when `project` and/or `workflowKey` are known. `sessionKey` is only a continuity hint and never overrides a conflicting known owner.

Implicit recovery and explicit `traceId` resume use the same portable `evaluateMssrTraceOwnerCompatibility(...)` contract **before** adoption. Unknown/unscoped dimensions may bind to the current owner; equivalent known owners may resume across connector/session rotation; a known project/workflow mismatch fails closed without mutating the trace. Legitimate cross-project work uses a separately owned/delegated trace or bounded `related_project` evidence, never owner migration.

An explicitly supplied `traceId` is the only trace allowed to provide task identity or lifecycle state for that call. If the ID is unknown, treat its state as absent; never borrow the coordinator's `localTraceId` to validate `taskKey`, parent/supersedes lineage, or clear another trace's closure timer. A mismatch against the active local trace may remain a diagnostic for an ordinary trace-aware operation, but it must not substitute that trace as the operation's state. Omitting `traceId` remains the normal way to start a generated-ID route.

The invariant applies to local state, process-shared recovery, persisted recovery, metric attribution and evidence projection so unrelated work cannot contaminate learning or maintenance evidence.

## Lifecycle reconciliation

Bridge may hold RAM and durable observatory projections of one trace. Lifecycle-sensitive boundaries reconcile only a strictly fresher persisted lifecycle into RAM; reconciliation never rewinds newer RAM and never changes owner identity. Ordinary trace-aware tools do not perform this durable read.

Paged skill-context continuation is part of lifecycle reconciliation. When `skill_context_next` returns loaded skills for an exact trace, Bridge must fold those loads into that trace's in-memory lifecycle before later R2 preflight checks. The continuation result is accepted only for its own returned `traceId`; a foreign continuation never satisfies another trace. This keeps RAM preflight state aligned with durable MSSR evidence without weakening owner compatibility or inferring completion from history alone.

## Automatic lifecycle coverage

Bridge registry metadata exposes bounded MSSR `effect` + `scale`. The central dispatcher evaluates packaged MSSR lifecycle policy before a tool handler runs: control-plane calls are recursion-exempt; trivial reads remain lightweight; substantial mutation/persist/publish/external work requires a compatible routed lifecycle. When requirements are missing Bridge returns `executed:false` with the required MSSR preflight/replan action and performs no original side effect. The caller processes the selected context/required skills, then retries the operation. Existing compatible lifecycle is reused. C2b routing compliance runs after this gate and remains fallback/recovery evidence, not the primary activation mechanism.
