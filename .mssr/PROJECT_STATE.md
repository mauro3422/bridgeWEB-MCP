# Bridge project state

## Current release
Bridge `0.6.129` is source/dist/live current on vendored and installed `@mauroprime/mssr 0.2.63`. Controlled HTTP-only restart ack `eff4936a-7a1e-40d8-bc80-5a499aa51ffb` adopted PID `17980`, boot `f05993ce-a097-4a4f-a52d-8198c3d76439`, while the singleton watchdog remained PID `3560` and the tunnel stayed live/ready. `npm run smoke:http` passed against the live runtime with 163 registered tools. `bridge_health` reports zero new tunnel-service 502 and zero new local `POST /mcp` no-status failures since the post-restart baseline. The live catalog includes `project_context_maintain`; schema readback confirms it is an explicit idempotent write action, and a live call against Bridge correctly returned `review-required` with `semanticRewrite=false` because the remaining pressured module needs semantic segmentation rather than an automatic split.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.129` verification includes `npm run check`, `npm run build`, generated `TOOLS.md` consistency, focused Project Context maintenance/trace/tool-registry coverage, and the full isolated `npm run test:regressions`. The first full run intentionally exposed a real module budget breach after documentation growth; the module was compacted below budget without raising `maxChars`, then the full suite passed. Its integrated HTTP liveness gate observed 315 concurrent readiness samples with p95 1.45 ms, max 46.27 ms, zero event-loop stalls, 64/64 persisted writes and one passive WAL checkpoint. Live post-restart HTTP smoke then passed on 0.6.129 with 163 tools.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. The former monolithic `PROJECT_MEMORY.md` has been reduced to a compact pointer and its subsystem history moved into selector-backed `.mssr/knowledge/<topic>/` modules. The previous root-memory fanout warning is therefore resolved. Project Context Health may still report advisory WATCH for module count (`many-modules`); this is an organizational recommendation, not an operational defect and does not authorize arbitrary merging or rewriting of durable knowledge.

## Next performance/control work

The immediate next control work is observation rather than further transport changes. Keep the 0.6.128 watchdog/runtime pair running and use the new external recovery evidence if another unexplained HTTP exit or sustained readiness failure occurs. Correlate process diagnostics, event-loop state and tunnel metrics before changing timeout, routing or tunnel policy. The remaining Project Context Health findings (`many-modules` and module budget pressure) are advisory maintenance items, not runtime blockers.

## Repository reconciliation — 2026-09-17

Bridge and canonical MSSR were audited after the 0.6.128 adoption. `C:\Dev\bridge-mcp` and `C:\Dev\mssr` are junction aliases to the canonical `D:\Dev` roots, not extra clones. The stale local Bridge `feat/mssr-context-auto-modularization` ref was fully contained by `main` and removed. MSSR's `feat/context-semantic-segmentation` and `feat/context-auto-modularization` refs were fully contained and removed locally and from `origin`; its detached Codex worktree `5142` was inactive since 2026-09-03 and removed only after its substantive routing/code/test/document additions were verified as already present on current `main`. Bridge/MSSR now have one canonical worktree each and no pending feature branch to merge. The independent `D:\Dev\mauroprime-skills` repository still has concurrent Steam Workshop/media work and was intentionally left untouched. Full evidence and new-chat resume instructions are in `docs/HANDOFF_BRIDGE_MSSR_RECONCILIATION_2026-09-17.md`.
