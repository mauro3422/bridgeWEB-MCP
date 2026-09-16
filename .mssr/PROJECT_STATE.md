# Bridge project state

## Current release

Bridge `0.6.124` is source/dist/live current on exact vendored and installed `@mauroprime/mssr 0.2.61`. The final controlled HTTP-only restart ack `2c2f029b-fa4b-4938-b032-7a5e6b62010c` adopted PID `18368`, boot `f37449a7-4ad8-4b8c-bd09-290e34bf3fe0`; the Secure MCP tunnel remained `live/ready`. Runtime catalog is 162 tools. No Git commit, push, or public package publication is claimed by this state file.

## Liveness and observability

Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Final verification passed `npm run check`, `npm run build`, full `npm run test:regressions` (exit 0, about 160.5 s), `scripts/test-bridge-http.ps1`, and WAL maintenance. The liveness regression persisted 64/64 writes while probing `/readyz` 115 times with p95 6.45 ms and max 97.15 ms; the fixture boot remained stable. WAL verification completed with `busy=0`, 57/57 frames checkpointed. Live read-after-write was confirmed after the final restart.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. Indexed topic/area modules carry conditional durable knowledge, while `PROJECT_CONTEXT`, `PROJECT_MEMORY`, and `PROJECT_STATE` keep only repository-wide/current-state authority. Project Context Health is WATCH because root `PROJECT_MEMORY.md` is approaching monolithic size; new topic-specific knowledge should prefer indexed `.mssr/knowledge/<topic>/` modules instead of expanding the root by default. No workspace-wide automatic rewrite is authorized by this state.

## Next performance/control work

The next useful optimization layer is a controlled fast path rather than bypassing MSSR governance: (1) a validated Project/Trace Lease reused across warm local operations and invalidated on restart/authority/replan boundaries; (2) optional first-output/TTFB return from terminal start together with the persistent session id; and (3) a caller-visible round-trip probe, when supported, so external ChatGPT↔Bridge/tunnel latency can be measured separately from Bridge dispatch.
