# Bridge project state

## Current release

Bridge `0.6.125` is source/dist/live current on the canonical final vendored and installed `@mauroprime/mssr 0.2.61` artifact (688166 bytes, SHA-256 `946ba46fbcbb9f7faf712dd0421a0ccffdf85f3c611fa133bd55f3ee3c03ca8a`). Controlled HTTP-only restart ack `8718ff71-e018-4016-b5b7-cf467d44e6a1` adopted PID `20104`, boot `9ceced40-a835-4248-a793-3b3b35c5cd2a`; the Secure MCP tunnel remained `live/ready`. Runtime catalog is 162 tools. MSSR 0.2.61 Git source is published at `0c3d9c58c073aea746394387532496bdca474fe4`; no public npm-registry publication is claimed.

## Liveness and observability

Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.125` full verification completed with `ok=true` / `failedRequired=0` in about 191 s. It passed check/build, live HTTP smoke, dual-era MCP, full regressions (about 116.6 s), routing latency, WAL maintenance, observability liveness, skill routing and tools-doc checks. The liveness regression persisted 64/64 writes while probing `/readyz` 123 times with p95 4.39 ms and max 55.29 ms; WAL completed `busy=0` with 63/63 frames checkpointed. The live runtime remained 0.6.125 on PID `20104` / boot `9ceced40-a835-4248-a793-3b3b35c5cd2a`.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. Indexed topic/area modules carry conditional durable knowledge, while `PROJECT_CONTEXT`, `PROJECT_MEMORY`, and `PROJECT_STATE` keep only repository-wide/current-state authority. Project Context Health is WATCH because root `PROJECT_MEMORY.md` is approaching monolithic size; new topic-specific knowledge should prefer indexed `.mssr/knowledge/<topic>/` modules instead of expanding the root by default. No workspace-wide automatic rewrite is authorized by this state.

## Next performance/control work

The next useful optimization layer is a controlled fast path rather than bypassing MSSR governance: (1) a validated Project/Trace Lease reused across warm local operations and invalidated on restart/authority/replan boundaries; (2) optional first-output/TTFB return from terminal start together with the persistent session id; and (3) a caller-visible round-trip probe, when supported, so external ChatGPT↔Bridge/tunnel latency can be measured separately from Bridge dispatch.
