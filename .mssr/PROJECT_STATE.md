# Bridge project state

## Current release
Bridge `0.6.127` is source/dist/live current on the canonical vendored and installed `@mauroprime/mssr 0.2.61` artifact (688166 bytes, SHA-256 `946ba46fbcbb9f7faf712dd0421a0ccffdf85f3c611fa133bd55f3ee3c03ca8a`). Final controlled HTTP-only restart ack `c892b3bb-bbfb-49e7-a7fc-a10eb15f7656` adopted PID `16472`, boot `c9e8087a-4d87-47c9-a444-990ac71049ce` after the compact-envelope delivery hardening; the Secure MCP tunnel remained `live/ready`. Runtime catalog remains 162 tools, keep-alive remains 120000 ms, and the fresh post-restart tunnel baseline reports zero new tunnel-service 502 and zero local `POST /mcp` no-status deltas. MSSR 0.2.61 Git source remains published at `0c3d9c58c073aea746394387532496bdca474fe4`; no public npm-registry publication is claimed.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.127` final delivery-hardening verification passed `npm run check`, `npm run build`, the focused context-continuation/routing-latency/WAL gates, the exact 32k compact-bootstrap reproducer, complete HTTP smoke, and the full isolated `npm run test:regressions` suite (exit 0 in about 113 s). The durable continuation regression now covers full `bridgeTiming`, compact timing, and omission when diagnostics alone would overflow the response envelope. The observability liveness gate persisted 64/64 writes across 123 readiness probes with p95 1.69 ms and max 44.79 ms. Long verification runs are launched as ID-addressable background work and inspected separately rather than holding one synchronous MCP call open.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. Indexed topic/area modules carry conditional durable knowledge, while `PROJECT_CONTEXT`, `PROJECT_MEMORY`, and `PROJECT_STATE` keep only repository-wide/current-state authority. Project Context Health is WATCH because root `PROJECT_MEMORY.md` is approaching monolithic size; new topic-specific knowledge should prefer indexed `.mssr/knowledge/<topic>/` modules instead of expanding the root by default. No workspace-wide automatic rewrite is authorized by this state.

## Next performance/control work

The next useful optimization layer is a controlled fast path rather than bypassing MSSR governance: (1) a validated Project/Trace Lease reused across warm local operations and invalidated on restart/authority/replan boundaries; (2) optional first-output/TTFB return from terminal start together with the persistent session id; and (3) a caller-visible round-trip probe, when supported, so external ChatGPT↔Bridge/tunnel latency can be measured separately from Bridge dispatch.
