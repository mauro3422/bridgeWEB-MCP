# Bridge project state

## Current release
Bridge `0.6.128` is source/dist/live current on vendored and installed `@mauroprime/mssr 0.2.63`. Controlled HTTP-only restart ack `13196cb3-9270-4270-bd7e-99c7e1722b2f` adopted PID `10940`, boot `6f23f3ab-38b0-41a3-b172-c8c762c123cf`; the external watchdog was then reloaded to the current source as singleton PID `3560` while preserving tunnel PID `17428`. `npm run smoke:http` passed against the live runtime with 162 registered tools, tunnel health/ready remained live/ready, and the post-restart transport baseline reports zero new tunnel-service 502 and zero new local `POST /mcp` no-status failures. The two historical 502/no-status counts were emitted during the deliberate HTTP adoption window before the baseline reset, not after adoption. The 0.2.63 source/vendor tarballs share SHA-256 `252275446b60b8d2610d1e70dae7fed302d647c68f0953c5ca2a0b3649ee66c5`, and sampled critical installed MSSR `dist` files match canonical source bytes.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.128` verification includes `npm run check`, `npm run build`, focused v060/tool-contract coverage, MCP dual-era/context-continuation/routing-latency/WAL gates, repeated MSSR trace-contract runs, and isolated HTTP liveness under 64 persistence writes plus six concurrent synthetic MCP callers. The final authoritative isolated `npm run test:regressions` passed after the read-your-writes metrics snapshot correction in about 114 s; its integrated liveness gate observed 314 concurrent readiness samples with p95 1.29 ms, max 47.49 ms, zero event-loop stalls, 64/64 persisted writes and one passive WAL checkpoint. Aggregate metrics now reconcile SQLite plus the in-memory overlay within one bounded read snapshot so the persistence commit/ack transition cannot transiently double-count or omit a call. Long verification runs remain ID-addressable background work instead of one synchronous MCP call.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. The former monolithic `PROJECT_MEMORY.md` has been reduced to a compact pointer and its subsystem history moved into selector-backed `.mssr/knowledge/<topic>/` modules. The previous root-memory fanout warning is therefore resolved. Project Context Health may still report advisory WATCH for module count (`many-modules`); this is an organizational recommendation, not an operational defect and does not authorize arbitrary merging or rewriting of durable knowledge.

## Next performance/control work

The immediate next control work is observation rather than further transport changes. Keep the 0.6.128 watchdog/runtime pair running and use the new external recovery evidence if another unexplained HTTP exit or sustained readiness failure occurs. Correlate process diagnostics, event-loop state and tunnel metrics before changing timeout, routing or tunnel policy. The remaining Project Context Health findings (`many-modules` and module budget pressure) are advisory maintenance items, not runtime blockers.
