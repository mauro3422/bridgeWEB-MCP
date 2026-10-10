# Bridge dashboard, routing latency, and WAL liveness boundary

## Dashboard work must not define transport health

Bridge liveness and MCP share one HTTP event loop. Synchronous dashboard aggregation once delayed `/healthz` beyond the watchdog probe and caused the watchdog to recreate an otherwise live process. Keep expensive projection work out of the request event loop and verify cold snapshots while sampling health and preserving runtime/tunnel identities.

Retained-history routes `/api/mssr/summary`, `/api/tools/audit`, and `/api/metrics/{overview,summary,recent,errors,timeline}` use a read-only child. Snapshot construction uses a separate child so refreshes cannot block reads. Keep `/api/metrics/status` in the HTTP process; merge its runtime identity and persistence queue into worker-backed responses. Both worker_threads and child-process IPC must dispatch every supported request.

A valid persisted snapshot can serve immediately during storage initialization. Refresh stale data on demand; eagerly build only when no persisted snapshot exists. Each child reports readiness after registering its IPC listener. Start a queue timer when sending a request, replace it with the execution timer only after the child acknowledges acceptance, and expose bounded worker health/pending types in `/status` without request IDs. Preserve the storage-initialization gate for DB-backed routes.

Concurrent snapshots may refresh the context-inventory cache together. Serialize replacements, use unique temporary filenames, and clean only the failed temporary file to avoid Windows rename races. Test large MSSR/tool-call histories while sampling `/readyz`; endpoint completion alone does not prove transport liveness.

## Routing and catalog latency attribution

Attribute specialized routing latency by layer before changing MSSR semantics. Cold skill-catalog discovery may dominate startup; deterministic routing and context planning are comparatively small when warm. A healthy filesystem watcher invalidates Bridge's in-memory catalog projection; bounded TTL is fallback only when watcher coverage is missing or fails. Do not rescan on time alone while watcher coverage is healthy. Keep cache diagnostics out of compact routing/bootstrap payloads. MSSR remains the semantic routing owner.

## Observability durability and WAL maintenance boundary

Request-path writers enqueue bounded JSONL/SQLite work to the shared single-writer worker. A bounded in-memory overlay provides read-your-writes while durable persistence catches up. Projections promising immediate evidence merge persisted and pending rows with stable event-ID dedupe and domain ordering. Aggregate reads use one bounded SQLite snapshot so a commit awaiting acknowledgement cannot double-count or omit the same call.

Writers disable `wal_autocheckpoint`; a worker runs `wal_checkpoint(PASSIVE)` after a quiet-period debounce. Writes during a checkpoint schedule another pass only after completion and a fresh idle period. Attribute slow routing to catalog discovery, MSSR routing/context, Bridge dispatch, persistence/WAL, or external ingress/egress rather than blaming MSSR wholesale. Readiness alerts belong to Bridge; MSSR notices remain semantic/project-maintenance evidence. Under 0.6.130 stress, `/readyz` stayed healthy with 8 and 12 synthetic agents (p95 2.23/3.04 ms, max 68.62/79.05 ms), zero event-loop stalls and 64/64 persistence. A synthetic tool call can still exceed 15 s; readiness is not a per-tool latency guarantee.
