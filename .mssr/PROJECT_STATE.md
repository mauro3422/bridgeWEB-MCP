# Bridge project state

## Current release
Bridge `0.6.130` is the verified source release candidate with vendored/installed `@mauroprime/mssr 0.2.64`; the live HTTP runtime remains verified `0.6.129` until the durable 0.6.130 Git release is published and restarted. Source verification includes focused check/build, persistent notice-history restart regression, 164-tool registry coverage, stable WATCH suppression, Operational Notice/Context Plane regressions, generated `TOOLS.md` consistency, and the full isolated regression suite. The 0.6.130 restart/readback must confirm live version, 164 tools, MSSR 0.2.64, tunnel/readiness health, and the quiet notice/history contract before source/live parity is declared.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.130` source verification includes `npm run check`, `npm run build`, generated `TOOLS.md` consistency, persistent notice-history restart coverage, Project Context WATCH/segmentation coverage, Operational Notice coverage, Context Plane coverage, and full isolated `npm run test:regressions` PASS. The final integrated liveness run completed 64/64 persisted writes with 313 concurrent readiness samples, p95 1.43 ms, max 48.99 ms, zero event-loop stalls and one passive WAL checkpoint.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. The former monolithic `PROJECT_MEMORY.md` has been reduced to a compact pointer and its subsystem history moved into selector-backed `.mssr/knowledge/<topic>/` modules. The previous root-memory fanout warning is therefore resolved. Project Context Health may still report advisory WATCH for module count (`many-modules`); this is an organizational recommendation, not an operational defect and does not authorize arbitrary merging or rewriting of durable knowledge.

## Next performance/control work

The immediate release step is durable Git publication followed by a controlled HTTP-only watchdog restart/readback. Full 0.6.130 regression/liveness verification is complete. The prior `bridge-dashboard-routing-liveness` and host-health selected-payload pressure are resolved by reviewed semantic segments without increasing their budgets. The remaining `many-modules` Project Context WATCH is organizational/advisory; ordinary loads suppress an unchanged fingerprint after first presentation while explicit health remains complete.

## Repository reconciliation — 2026-09-17

Bridge and canonical MSSR were audited after the 0.6.128 adoption. `C:\Dev\bridge-mcp` and `C:\Dev\mssr` are junction aliases to the canonical `D:\Dev` roots, not extra clones. The stale local Bridge `feat/mssr-context-auto-modularization` ref was fully contained by `main` and removed. MSSR's `feat/context-semantic-segmentation` and `feat/context-auto-modularization` refs were fully contained and removed locally and from `origin`; its detached Codex worktree `5142` was inactive since 2026-09-03 and removed only after its substantive routing/code/test/document additions were verified as already present on current `main`. Bridge/MSSR now have one canonical worktree each and no pending feature branch to merge. The independent `D:\Dev\mauroprime-skills` repository still has concurrent Steam Workshop/media work and was intentionally left untouched. Full evidence and new-chat resume instructions are in `docs/HANDOFF_BRIDGE_MSSR_RECONCILIATION_2026-09-17.md`.
