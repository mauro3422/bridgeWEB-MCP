# Bridge project state

## Current release
Bridge source release `0.6.137` is prepared with exact `@mauroprime/mssr 0.2.70` bytes (`mauroprime-mssr-0.2.70.tgz`, SHA-256 `73b25634781b4884a84fe2cbfbaa2f3e0b1c66f92dde0d687eee8ac1886d9f35`) to complete the Bridge host side of R3 Context Economy v2. `skill_bootstrap` now accepts explicit caller retention receipts (`id` + content fingerprint), forwards them to portable MSSR, and preserves them only inside the in-memory continuation lease for the same cursor chain; Bridge never infers current retention from historical trace loads or delivery evidence. The currently running HTTP process remains the previously verified `0.6.136` / MSSR `0.2.69` runtime (PID `2232`, boot `306ee4ee-b313-4e98-9303-cdb2a80c7a46`, tunnel `live/ready`) until the `0.6.137` release gate, publication, and controlled restart complete. R1 immutable owner isolation and R2 automatic lifecycle preflight remain unchanged and passed focused compatibility regressions after the R3 change.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.136` passed final recovered-runtime strict verification in job `bridge_verify_1789791620109_1` with `ok=true`, `code=0`, `failedRequired=0`, and `strictGit=true`. Doctor, check, build, HTTP smoke, dual-era MCP, full regressions, routing latency, WAL maintenance, HTTP liveness, skill routing, generated-tools freshness, watchdog/metrics reachability, tools/list sanity, and clean Git all passed on PID `2232` / boot `306ee4ee-b313-4e98-9303-cdb2a80c7a46`. R1 owner isolation and R2 automatic lifecycle regressions passed; routing covered 240 canonical effective cases with `maintenanceRequired=false`; liveness recorded 64 completed writes and 0 event-loop stalls. The HTTP smoke was anomalously slow at `59569 ms`; a preceding verification-only job had triggered bounded watchdog auto-recovery after sustained unreadiness of the prior child. That host-performance/readiness recurrence is tracked separately and did not invalidate the clean recovered-runtime R1/R2 gate.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. A full human semantic review of all 25 selectable modules found one exact activation-equivalent pair: `bridge-trace-owner-integrity` and `bridge-trace-lifecycle-reconciliation`. Their owner-integrity and lifecycle-reconciliation contracts now live together in `bridge-trace-integrity-and-lifecycle`, preserving the shared stages/domains/actions/artifacts/needs/signals and the combined prior context budget. The manifest now contains 24 modules; Project Context Health reports `ok` with zero findings/recommendations, so the former `many-modules` WATCH is resolved structurally rather than suppressed. No other modules were merged because their authority or selectors differ. The notice-history authority remains a distinct module, but it is part of the maintained Bridge/MSSR notice subsystem and 0.6.134 updates its host-delivery boundary without creating a second notice system.

## Next performance/control work

R1 Trace Identity Integrity and R2 Automatic Lifecycle Coverage remain complete. R3 Context Economy v2 is implemented in portable MSSR 0.2.70 and its Bridge 0.6.137 host transport/regression layer is prepared; the remaining gate is full release verification, publication, controlled restart, and live-runtime confirmation. The separate HTTP smoke/readiness performance recurrence remains tracked independently and is not hidden by larger timeouts.

## Repository reconciliation — 2026-09-19

Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills` remain separated by owner: portable MSSR owns semantic lifecycle/trace/context-retention policy, Bridge owns host observation/registry/dispatch/I/O, and shared skills remain independently governed. Bridge source `0.6.137` consumes exact MSSR `0.2.70` for R3 while the live runtime remains `0.6.136` until controlled adoption; learning remains observe-only (`routingInfluence=false`) and no parallel notice/context control plane was introduced.
