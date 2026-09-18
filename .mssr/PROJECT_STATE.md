# Bridge project state

## Current release
Bridge `0.6.131` is source/dist/live current with vendored and installed `@mauroprime/mssr 0.2.64`. Canonical release commit `7046faafad02d7c6d6ae95e81f6cc6e712ca41fd` was published and verified equal across `HEAD`, `origin/main`, and direct remote readback before controlled HTTP-only watchdog adoption. Live readback confirms Bridge 0.6.131, 164 tools, MSSR 0.2.64, tunnel `healthz/readyz` 200, zero new post-adoption-baseline tunnel/local transport failures, and full `npm run smoke:http` PASS. The change is Bridge-only: Project Situation compares retained historical receipt evidence only when the exact `canonicalOwner + ref` remains a current authoritative repository candidate; historical inbox receipts remain unchanged.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.131` source verification includes focused `npm run check`, `npm run build`, Project Situation regression/readback, plus full isolated `npm run test:regressions` PASS on the final release tree. That final integrated liveness run completed 64/64 persisted writes with six synthetic agents, p95 concurrent readiness 2.04 ms, max 67.15 ms, zero event-loop stalls and one passive WAL checkpoint. Post-adoption Project Situation reports `evidenceComplete=true` with no `canonical-baseline-missing`; the remaining REVIEW is exact historical revision evidence for PROJECT_MEMORY, PROJECT_STATE, and the root CHANGELOG updated by this release, with `nextAction=revalidate-context-evidence`. The prior 0.6.130 post-release 8/12-agent stress evidence remains valid for transport liveness and is not reinterpreted as a per-tool latency SLA.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. The former monolithic `PROJECT_MEMORY.md` has been reduced to a compact pointer and its subsystem history moved into selector-backed `.mssr/knowledge/<topic>/` modules. The previous root-memory fanout warning is therefore resolved. Project Context Health may still report advisory WATCH for module count (`many-modules`); this is an organizational recommendation, not an operational defect and does not authorize arbitrary merging or rewriting of durable knowledge.

## Next performance/control work

Bridge 0.6.131 publication and live adoption are complete. Return to observation rather than further transport change: correlate new failures against runtime/tunnel/notice history before tuning thresholds. The prior `bridge-dashboard-routing-liveness` and host-health selected-payload pressure remain resolved by reviewed semantic segments without increasing budgets. The remaining `many-modules` Project Context WATCH is organizational/advisory; ordinary loads suppress an unchanged fingerprint after first presentation while explicit health remains complete. The next separate maintenance front is the shared `D:\Dev\mauroprime-skills` repository and must use its own project/trace ownership.

## Repository reconciliation — 2026-09-17

Bridge and canonical MSSR were audited after the 0.6.128 adoption. `C:\Dev\bridge-mcp` and `C:\Dev\mssr` are junction aliases to the canonical `D:\Dev` roots, not extra clones. The stale local Bridge `feat/mssr-context-auto-modularization` ref was fully contained by `main` and removed. MSSR's `feat/context-semantic-segmentation` and `feat/context-auto-modularization` refs were fully contained and removed locally and from `origin`; its detached Codex worktree `5142` was inactive since 2026-09-03 and removed only after its substantive routing/code/test/document additions were verified as already present on current `main`. Bridge/MSSR now have one canonical worktree each and no pending feature branch to merge. The independent `D:\Dev\mauroprime-skills` repository still has concurrent Steam Workshop/media work and was intentionally left untouched. Full evidence and new-chat resume instructions are in `docs/HANDOFF_BRIDGE_MSSR_RECONCILIATION_2026-09-17.md`.
