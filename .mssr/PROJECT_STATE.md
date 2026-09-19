# Bridge project state

## Current release
Bridge `0.6.135` is published and live-adopted with exact `@mauroprime/mssr 0.2.67` bytes (`mauroprime-mssr-0.2.67.tgz`, SHA-256 `ec41a511aec958b545e646a278746bc282919d6c8b00f9b7f324537996ff0f3f`). Functional release commit `b4ae6f1e56f45eabd5f0d5c91811ad152c5327a1` was pushed with `HEAD = origin/main = refs/heads/main`; watchdog PID `9788` consumed restart request `135e94ba-f45a-4f08-99f4-a5bba1ded861`. Live HTTP identity is `0.6.135`, PID `13508`, boot `a7faec2b-4ad9-425a-83b4-5d097d03fc68`, tunnel `live/ready`, and the catalog remains 164 tools. Release 0.6.135 closes three host-integration gaps without adding parallel control planes: exact semantic-owner path classification removes documentation-only `skill-routing` false positives, Project Health consumes the opt-in MSSR Document Freshness contract through exact Git/worktree evidence, and Project Situation composes C2e-D explicit release/install/runtime semantic claims independently of Context Plane receipts. `bridgeNotices` remains the only general notice transport and MSSR remains semantic owner.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.135` post-restart verification job `bridge_verify_1789779879137_1` proved doctor/check/build, HTTP smoke, dual-era MCP, full regressions, routing latency, WAL maintenance, HTTP liveness, skill routing, watchdog/metrics reachability, tools/list sanity, and clean Git; the live smoke observed PID `13508` / boot `a7faec2b-4ad9-425a-83b4-5d097d03fc68`, `live/ready`, and 164 tools. Its only required failure was generated `TOOLS.md` freshness after the version bump; `npm run docs:tools` regenerated the 164-tool catalog for 0.6.135, so a final strict-Git verification rerun is required before closing the release trace. Liveness remained healthy with 64 completed writes, 0 event-loop stalls and low-millisecond p95 readiness.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. A full human semantic review of all 25 selectable modules found one exact activation-equivalent pair: `bridge-trace-owner-integrity` and `bridge-trace-lifecycle-reconciliation`. Their owner-integrity and lifecycle-reconciliation contracts now live together in `bridge-trace-integrity-and-lifecycle`, preserving the shared stages/domains/actions/artifacts/needs/signals and the combined prior context budget. The manifest now contains 24 modules; Project Context Health reports `ok` with zero findings/recommendations, so the former `many-modules` WATCH is resolved structurally rather than suppressed. No other modules were merged because their authority or selectors differ. The notice-history authority remains a distinct module, but it is part of the maintained Bridge/MSSR notice subsystem and 0.6.134 updates its host-delivery boundary without creating a second notice system.

## Next performance/control work

Bridge 0.6.135 is live-adopted and the functional code path is complete. The remaining close gate is purely release consistency: publish the regenerated 0.6.135 `TOOLS.md` plus this live-adoption state, rerun strict verification from a clean tree, then close the MSSR trace. Future semantic monitoring should extend typed producers/registries through Project Health/Situation and the existing single notice transport rather than adding parallel watchers or queues.

## Repository reconciliation — 2026-09-18

Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills` remain separated by owner: portable MSSR owns semantic contracts, Bridge owns host observation/adapters/delivery, and shared skills remain independently governed. Bridge now consumes exact MSSR `0.2.67`; Bridge `0.6.135` is published and live-adopted, with contextual notice delivery/current-attention history still the active host boundary and the new Document Freshness/C2e-D integrations layered through existing health/situation projections.
