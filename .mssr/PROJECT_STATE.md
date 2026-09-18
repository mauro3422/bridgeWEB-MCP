# Bridge project state

## Current release
Bridge `0.6.133` is the verified source/dist release candidate with vendored and installed `@mauroprime/mssr 0.2.65`; live runtime remains Bridge `0.6.132` / MSSR `0.2.64` until the controlled post-publication HTTP-only watchdog adoption. The canonical MSSR 0.2.65 tarball is vendored byte-for-byte at SHA-256 `9691430389cf41c0320f31331a73475715840eb3edaea936bddd0b19475fa47c`, and the installed package exposes the corrected `workshop-media-editing-continuation-fix-zoom` fixture with bounded context, `completedPhases=["discovery"]`, and `contextUsed=true`. Bridge 0.6.133 also hardens restart acknowledgement publication and retires `STATUS_CURRENT.md` as a duplicated current-state authority.

## Liveness and observability
Durable MSSR events and Bridge tool metrics use the shared single-writer observability worker instead of synchronous JSONL/SQLite request-path writes. A bounded in-memory overlay preserves immediate read-your-writes semantics for active trace/recent/routing projections while durable persistence catches up. WAL maintenance is separate from receipt durability: passive checkpoints run outside the HTTP/MCP event loop after a true quiet-period debounce.

Bridge `0.6.133` source gates currently pass `npm run check`, `npm run build`, `scripts/test-bridge-regressions.ps1`, `test:skill-routing`, generated-tools freshness, and full npm audit with zero vulnerabilities. The restart-ack regression executes the real watchdog writer and proves non-empty validated JSON plus temp cleanup. Live adoption is intentionally still pending at this source-state checkpoint; after publication the watchdog restart must prove a parseable ack matching the request id, new live 0.6.133 identity, MSSR 0.2.65, tunnel readiness, 164-tool catalog, focused smoke and full verification.

Routing latency is attributed by layer. `bridgeTiming` reports instrumented internal phases and `bridgeMeta.latency.dispatchMs` reports time inside Bridge dispatch; caller-to-Bridge ingress and Bridge-to-caller egress remain outside that boundary. Host latency/readiness/transport warnings, including `bridge-routing-latency`, are Bridge-native Notices and do not become MSSR semantic notices.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Learning digests remain observe-only with `routingInfluence=false`; they do not alter routing. Historical priors and strict digests remain observability evidence only until separate replay/calibration/shadow/rollback gates prove they are safe to influence routing.

## Project knowledge migration

Bridge project control remains canonical under `.mssr/`. Project Context Health is currently WATCH only for `many-modules`: 25 modules warrant an organization review, but the portable modularization planner returns zero safe exact candidates and zero pressured authority sections. This finding was explicitly reviewed for 0.6.133; no semantic merge, selector rewrite, core extraction, or budget increase is justified merely to remove the advisory WATCH.

## Next performance/control work

Finish the 0.6.133 release by running staged consistency/full verification, publishing the source commit, requesting one controlled HTTP-only watchdog restart, and proving the new ack plus live Bridge/MSSR identity. The separate notice-history work explicitly excluded by the user remains untouched.

## Repository reconciliation — 2026-09-18

Bridge, canonical MSSR, and `D:\Dev\mauroprime-skills` were re-audited read-only before this cleanup. Each repository had one canonical worktree, clean Git aligned with its tracking/direct remote ref, and no stale feature work requiring merge. MSSR `0.2.65` is the canonical source release; `mauroprime-skills` discovery/junction verification is healthy. Bridge 0.6.133 is the bounded adoption/hardening front described above.
