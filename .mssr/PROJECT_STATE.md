# Bridge project state

## Current release
Bridge `0.6.130` is source/dist/live current with vendored and installed `@mauroprime/mssr 0.2.64`. Canonical commit `cd0d7f0d9c36d038e13b0a2182471bb6ee26b920` was published and verified equal across `HEAD`, `origin/main`, and direct remote readback before a controlled HTTP-only watchdog restart. Live readback confirms Bridge 0.6.130, 164 tools, MSSR 0.2.64, tunnel `healthz/readyz` 200, zero new post-baseline tunnel/local transport failures, disk-backed notice history with no pending redelivery, and full `npm run smoke:http` PASS.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.130` source verification includes `npm run check`, `npm run build`, generated `TOOLS.md` consistency, persistent notice-history restart coverage, Project Context WATCH/segmentation coverage, Operational Notice coverage, Context Plane coverage, and full isolated `npm run test:regressions` PASS. The release-suite liveness run completed 64/64 persisted writes with 313 concurrent readiness samples, p95 1.43 ms, max 48.99 ms, zero event-loop stalls and one passive WAL checkpoint. Post-release isolated stress also passed at 8 synthetic agents (p95 2.23 ms, max 68.62 ms) and 12 agents (p95 3.04 ms, max 79.05 ms), with zero stalls and 64/64 persistence in both runs. Those stress runs intentionally relaxed only cold-start/per-tool completion timeouts; one default 15 s synthetic call timed out at 8 agents, so the results prove event-loop/readiness liveness rather than a per-tool latency SLA.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. The former monolithic `PROJECT_MEMORY.md` has been reduced to a compact pointer and its subsystem history moved into selector-backed `.mssr/knowledge/<topic>/` modules. The previous root-memory fanout warning is therefore resolved. Project Context Health may still report advisory WATCH for module count (`many-modules`); this is an organizational recommendation, not an operational defect and does not authorize arbitrary merging or rewriting of durable knowledge.

## Next performance/control work

Bridge 0.6.130 publication, live adoption and 6/8/12-agent liveness verification are complete. The next Bridge action is observation rather than further transport change: correlate new failures against runtime/tunnel/notice history before tuning thresholds. The prior `bridge-dashboard-routing-liveness` and host-health selected-payload pressure remain resolved by reviewed semantic segments without increasing budgets. The remaining `many-modules` Project Context WATCH is organizational/advisory; ordinary loads suppress an unchanged fingerprint after first presentation while explicit health remains complete.

## Repository reconciliation — 2026-09-17

Bridge and canonical MSSR were audited after the 0.6.128 adoption. `C:\Dev\bridge-mcp` and `C:\Dev\mssr` are junction aliases to the canonical `D:\Dev` roots, not extra clones. The stale local Bridge `feat/mssr-context-auto-modularization` ref was fully contained by `main` and removed. MSSR's `feat/context-semantic-segmentation` and `feat/context-auto-modularization` refs were fully contained and removed locally and from `origin`; its detached Codex worktree `5142` was inactive since 2026-09-03 and removed only after its substantive routing/code/test/document additions were verified as already present on current `main`. Bridge/MSSR now have one canonical worktree each and no pending feature branch to merge. The independent `D:\Dev\mauroprime-skills` repository still has concurrent Steam Workshop/media work and was intentionally left untouched. Full evidence and new-chat resume instructions are in `docs/HANDOFF_BRIDGE_MSSR_RECONCILIATION_2026-09-17.md`.
