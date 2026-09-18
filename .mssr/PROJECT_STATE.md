# Bridge project state

## Current release
Bridge `0.6.134` is fully adopted across source, published Git, and the live HTTP runtime with vendored and installed `@mauroprime/mssr 0.2.65`. The functional release commit is `ca13938eb765443e4098df93245f9a1dbdeb5a72`; concurrent HTTP smoke hardening/generated tools freshness is published at `7f8cd4560e7ee252ca07d087f5d4a6319cd2e723`. Live Bridge identity is `0.6.134`, PID `18520`, runtime boot `ac30c9e7-bb77-4b36-8363-235b508802d8`; watchdog PID `9788` consumed restart request `3ebec13d-bd13-461a-9f62-97a5a310bec7` with a valid `restart-http` acknowledgement. Release 0.6.134 keeps the single `bridgeNotices` transport while making delivery contextual and low-noise: current unresolved attention is scoped to active trace/project/workflow where possible, unrelated project notices are count-only in ordinary responses, full global recovery remains in `bridge_notice_history`, lifecycle transitions supersede old pending wrappers, resolved/successful informational states remain historical, oversized notices cannot head-of-line block delivery, and persisted old queues reconcile on startup. Portable MSSR semantics remain unchanged at 0.2.65.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.134` post-adoption verification job `bridge_verify_1789765723464_2` completed with `ok=true`, `code=0`, `failedRequired=0`, and `strictGit=true`. Doctor, check, build, concurrent-safe HTTP smoke, dual-era MCP, full regressions, routing latency, WAL maintenance, HTTP liveness, skill routing, generated-tools freshness, watchdog/metrics reachability, tools/list sanity, and Git status all passed. The live smoke observed Bridge `0.6.134` on PID `18520` / boot `ac30c9e7-bb77-4b36-8363-235b508802d8`, tunnel `live/ready`, and 164 registered tools; exact session deletion was verified by `Mcp-Session-Id`, not a race-prone global count. Skill routing passed with 240 canonical effective cases and `maintenanceRequired=false`; liveness recorded 64 completed writes, 0 event-loop stalls, and p95 concurrent readiness `1.44 ms`.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. A full human semantic review of all 25 selectable modules found one exact activation-equivalent pair: `bridge-trace-owner-integrity` and `bridge-trace-lifecycle-reconciliation`. Their owner-integrity and lifecycle-reconciliation contracts now live together in `bridge-trace-integrity-and-lifecycle`, preserving the shared stages/domains/actions/artifacts/needs/signals and the combined prior context budget. The manifest now contains 24 modules; Project Context Health reports `ok` with zero findings/recommendations, so the former `many-modules` WATCH is resolved structurally rather than suppressed. No other modules were merged because their authority or selectors differ. The notice-history authority remains a distinct module, but it is part of the maintained Bridge/MSSR notice subsystem and 0.6.134 updates its host-delivery boundary without creating a second notice system.

## Next performance/control work

The 0.6.134 contextual notice-delivery front is complete: implementation, restart adoption, concurrent-safe smoke, full regression/verification, generated-tool freshness, and remote publication all passed. No further Bridge mutation is required for this scope; future notice changes should preserve the single-transport/global-history boundary and keep project/trace delivery contextual rather than reintroducing global body noise.

## Repository reconciliation — 2026-09-18

Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills` were re-audited read-only before the preceding cleanup. MSSR `0.2.65` remains the canonical semantic package and `mauroprime-skills` discovery/junction verification is healthy. Bridge `0.6.134` is now published, live-adopted, post-adoption verified, and its contextual notice delivery/current-attention history boundary is the active Bridge host contract.
