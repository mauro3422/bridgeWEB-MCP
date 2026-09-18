# Bridge project state

## Current release
Bridge `0.6.132` is source/dist/live current with vendored and installed `@mauroprime/mssr 0.2.64`. Canonical release commit `0c29d0352417fc40cae798ddded6075f110068b4` was published and verified equal across `HEAD`, `origin/main`, and direct remote readback before controlled HTTP-only watchdog adoption. Live readback confirms Bridge 0.6.132, PID `16656`, boot `f27205e9-c4e1-4e53-ac48-da136c0e9eb2`, 164 tools, tunnel `healthz/readyz` 200, and MSSR 0.2.64. The 0.6.132 change is dependency-security maintenance only: `fast-uri`, `hono`, and `qs` were refreshed inside already-allowed transitive ranges, with no new direct dependency or override and no Bridge/MSSR semantic change; full npm audit reports zero vulnerabilities.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.132` source and live verification are complete. Source gates passed `npm run check`, `npm run build`, full `npm audit --json` with zero vulnerabilities, full isolated `npm run test:regressions`, generated-tools freshness, and staged release consistency. After adoption, `npm run smoke:http` passed and full `bridge_verify_all` completed `ok=true` / `failedRequired=0` with strict Git, including doctor, dual-era MCP, another full regression pass, routing latency, WAL maintenance, HTTP liveness, skill routing, tools/list sanity and clean Git. Post-adoption liveness completed 64/64 persisted writes with six synthetic agents, concurrent readiness p95 1.76 ms, zero event-loop stalls and one passive WAL checkpoint. The restart ack file was observed as zero bytes even though the request cleared and the new live PID/boot/version were independently proven; keep that bounded evidence anomaly for read-only follow-up rather than treating it as failed adoption.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. The former monolithic `PROJECT_MEMORY.md` has been reduced to a compact pointer and its subsystem history moved into selector-backed `.mssr/knowledge/<topic>/` modules. The previous root-memory fanout warning is therefore resolved. Project Context Health may still report advisory WATCH for module count (`many-modules`); this is an organizational recommendation, not an operational defect and does not authorize arbitrary merging or rewriting of durable knowledge.

## Next performance/control work

Bridge 0.6.132 publication and live adoption are complete. Return to observation for the security-refresh front. Next, perform the requested read-only reconciliation of Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills`; classify the zero-byte restart-ack evidence anomaly, stale/legacy documentation such as STATUS_CURRENT where applicable, project-health WATCH items, notices, routing/version skew, and any Git divergence without mutating those follow-up fronts. MSSR 0.2.65 adoption remains a separate versioned Bridge release decision.

## Repository reconciliation — 2026-09-17

Bridge and canonical MSSR were audited after the 0.6.128 adoption. `C:\Dev\bridge-mcp` and `C:\Dev\mssr` are junction aliases to the canonical `D:\Dev` roots, not extra clones. The stale local Bridge `feat/mssr-context-auto-modularization` ref was fully contained by `main` and removed. MSSR's `feat/context-semantic-segmentation` and `feat/context-auto-modularization` refs were fully contained and removed locally and from `origin`; its detached Codex worktree `5142` was inactive since 2026-09-03 and removed only after its substantive routing/code/test/document additions were verified as already present on current `main`. Bridge/MSSR now have one canonical worktree each and no pending feature branch to merge. The independent `D:\Dev\mauroprime-skills` repository still has concurrent Steam Workshop/media work and was intentionally left untouched. Full evidence and new-chat resume instructions are in `docs/HANDOFF_BRIDGE_MSSR_RECONCILIATION_2026-09-17.md`.
