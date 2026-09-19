# Bridge project state

## Current release
Bridge source release `0.6.136` is staged on top of the fully adopted live `0.6.135` runtime. Source/vendor/node_modules now consume exact `@mauroprime/mssr 0.2.69` bytes (`mauroprime-mssr-0.2.69.tgz`, SHA-256 `b46eacd8025c4195e852b5b52deeca38cb4e482395a0c9396a0695be8d8b14a1`); the live HTTP process remains `0.6.135`, PID `13508`, boot `a7faec2b-4ad9-425a-83b4-5d097d03fc68` until controlled restart adoption completes. Release 0.6.136 closes the Bridge side of R1/R2: explicit trace adoption now validates immutable known project/workflow ownership through the portable MSSR contract before mutation, and registry-driven Automatic Lifecycle Coverage intercepts substantial host operations before their handler when a compatible routed lifecycle is missing or incomplete. Trivial reads stay lightweight, MSSR control-plane tools remain recursion-exempt, compatible routes are reused, and C2b remains fallback/recovery evidence rather than the activation mechanism.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.135` final post-restart verification job `bridge_verify_1789780400020_2` completed with `ok=true`, `code=0`, `failedRequired=0`, and `strictGit=true`. Doctor, check, build, HTTP smoke, dual-era MCP, full regressions, routing latency, WAL maintenance, HTTP liveness, skill routing, generated-tools freshness, watchdog/metrics reachability, tools/list sanity, and clean Git all passed. The live smoke observed PID `13508` / boot `a7faec2b-4ad9-425a-83b4-5d097d03fc68`, `live/ready`, and 164 tools; routing covered 240 canonical effective cases with `maintenanceRequired=false`; liveness recorded 64 completed writes, 0 event-loop stalls and low-millisecond p95 readiness. The earlier job `bridge_verify_1789779879137_1` correctly exposed stale generated `TOOLS.md`; regeneration fixed that sole required failure before this clean rerun.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. A full human semantic review of all 25 selectable modules found one exact activation-equivalent pair: `bridge-trace-owner-integrity` and `bridge-trace-lifecycle-reconciliation`. Their owner-integrity and lifecycle-reconciliation contracts now live together in `bridge-trace-integrity-and-lifecycle`, preserving the shared stages/domains/actions/artifacts/needs/signals and the combined prior context budget. The manifest now contains 24 modules; Project Context Health reports `ok` with zero findings/recommendations, so the former `many-modules` WATCH is resolved structurally rather than suppressed. No other modules were merged because their authority or selectors differ. The notice-history authority remains a distinct module, but it is part of the maintained Bridge/MSSR notice subsystem and 0.6.134 updates its host-delivery boundary without creating a second notice system.

## Next performance/control work

R1 Trace Identity Integrity and R2 Automatic Lifecycle Coverage are implemented and pre-release verified in Bridge 0.6.136; controlled runtime adoption and strict post-restart verification remain the only open gates for this release. After those pass, the next planned reliability iteration is R3 Context Economy v2 in canonical MSSR, with Bridge changes only when that portable contract requires host adoption.

## Repository reconciliation — 2026-09-19

Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills` remain separated by owner: portable MSSR owns semantic lifecycle/trace policy, Bridge owns host observation/registry/dispatch/I/O, and shared skills remain independently governed. Bridge source `0.6.136` now consumes exact MSSR `0.2.69`; live runtime remains `0.6.135` until the controlled restart gate. The R1/R2 host adoption is staged without changing learning (`routingInfluence=false`) or introducing a parallel notice/context control plane.
