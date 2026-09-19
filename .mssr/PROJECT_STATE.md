# Bridge project state

## Current release
Bridge `0.6.136` is published and live-adopted with exact `@mauroprime/mssr 0.2.69` bytes (`mauroprime-mssr-0.2.69.tgz`, SHA-256 `b46eacd8025c4195e852b5b52deeca38cb4e482395a0c9396a0695be8d8b14a1`). Functional release commit `fe067c9eeff78b019e8ce7b378eaf5bfd160256c` is on `HEAD = origin/main = remote refs/heads/main`; watchdog PID `9788` consumed restart request `fa066b11-eee8-4d4d-8cb9-a8796c79bcae`. Live HTTP identity is `0.6.136`, PID `11228`, boot `d7d60ca7-ffa4-4914-afb1-2bf1a6f4374f`, tunnel `live/ready`, and the catalog remains 164 tools. Release 0.6.136 closes the Bridge side of R1/R2: explicit trace adoption validates immutable known project/workflow ownership through portable MSSR before mutation, and registry-driven Automatic Lifecycle Coverage intercepts substantial host operations before their handler when a compatible routed lifecycle is missing or incomplete. Trivial reads stay lightweight, MSSR control-plane tools remain recursion-exempt, compatible routes are reused, and C2b remains fallback/recovery evidence rather than the activation mechanism.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.136` final post-restart strict verification job `bridge_verify_1789790530556_2` completed with `ok=true`, `code=0`, `failedRequired=0`, and `strictGit=true`. Doctor, check, build, HTTP smoke, dual-era MCP, full regressions, routing latency, WAL maintenance, HTTP liveness, skill routing, generated-tools freshness, watchdog/metrics reachability, tools/list sanity, and clean Git all passed. The live smoke observed PID `11228` / boot `d7d60ca7-ffa4-4914-afb1-2bf1a6f4374f`, `live/ready`, and 164 tools; routing covered 240 canonical effective cases with `maintenanceRequired=false`; liveness recorded 64 completed writes and 0 event-loop stalls. The first strict job `bridge_verify_1789790076853_1` had one `test:mcp-dual-era` failure; the test immediately passed through npm plus 12 consecutive direct reruns, and the final strict job passed it with the expected 4-admitted/8-rejected capacity race, so no unproven production or test weakening was introduced.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. A full human semantic review of all 25 selectable modules found one exact activation-equivalent pair: `bridge-trace-owner-integrity` and `bridge-trace-lifecycle-reconciliation`. Their owner-integrity and lifecycle-reconciliation contracts now live together in `bridge-trace-integrity-and-lifecycle`, preserving the shared stages/domains/actions/artifacts/needs/signals and the combined prior context budget. The manifest now contains 24 modules; Project Context Health reports `ok` with zero findings/recommendations, so the former `many-modules` WATCH is resolved structurally rather than suppressed. No other modules were merged because their authority or selectors differ. The notice-history authority remains a distinct module, but it is part of the maintained Bridge/MSSR notice subsystem and 0.6.134 updates its host-delivery boundary without creating a second notice system.

## Next performance/control work

R1 Trace Identity Integrity and R2 Automatic Lifecycle Coverage are complete through portable MSSR 0.2.69 plus verified live Bridge 0.6.136 host adoption. The next planned reliability iteration is R3 Context Economy v2 in canonical MSSR, with Bridge changes only when that portable contract requires host adoption.

## Repository reconciliation — 2026-09-19

Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills` remain separated by owner: portable MSSR owns semantic lifecycle/trace policy, Bridge owns host observation/registry/dispatch/I/O, and shared skills remain independently governed. Bridge `0.6.136` consumes exact MSSR `0.2.69` and is live-adopted/strict-verified with the R1/R2 host contract; learning remains observe-only (`routingInfluence=false`) and no parallel notice/context control plane was introduced.
