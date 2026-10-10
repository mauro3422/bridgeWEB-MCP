# Bridge project state

## 0.6.164 source candidate — Jev context-split planner adapter (2026-10-10)

The candidate adds `mssr_project_context_ref_split_plan`, a Bridge adapter for the planner already shipped in MSSR 0.2.112. It resolves the project through Bridge path policy, uses the Windows Credential Manager Jev provider, and persists only the advisory plan plus observe-only semantic evidence in user-local MSSR state. It does not change project Markdown or manifests; the apply operation remains unavailable through Bridge. `npm run check`, `npm run build`, and the focused adapter regression passed. This is source-only until the controlled restart and live `tools/list` schema/readback confirm version 0.6.164 and 188 tools.

## Librarian query-variants candidate active in local Bridge runtime — 0.6.163 / MSSR 0.2.112 (2026-10-10)

Candidate branch `codex/bridge-mssr-0.2.112-query-variants-20261010` is based on `origin/main` 0.6.162 and vendors exact MSSR 0.2.112 bytes (1,121,628 bytes; SHA-256 `78a49828f9f27ebb3a3966b1a163ad9e24f7a3a8c38f1a8a4633d985106fd088`). It adds an optional, bounded host-supplied `queryVariants` field to the strict Librarian search contract; the primary query remains the first ranking group and per-query lexical scores are not confidence. The complete isolated `scripts/verify-all.ps1` gate exited 0 with `failedRequired=0`, including the full 299-second regression suite, live candidate HTTP smoke, routing latency, WAL, liveness, routing and docs checks. Its structured result receipt is outside Git at `D:\MSSR-benchmark-artifacts\bridge-0.6.163-mssr-0.2.112-verify-20261010\verify-all-receipt.json` (SHA-256 `dc109740c2734613b5476afbb18d4060c5953eaab07a144a6114241e8c557005`). **Activated and read back 2026-10-10 06:23 UTC:** Bridge `/status` reports 0.6.163 and boot `502d5b26-269a-45dd-994c-a6c5c1e4a025`; `/readyz`, Bridge health and tunnel health are green. HTTP PID 67524 runs this candidate's `dist/http.js`, while `ProjectRoot=D:\Dev\bridge-mcp` and the existing tunnel PID 23336 was adopted without restart. The live registry exposes search schema `queryVariants` (hash `6bc987b8d512e7d0`). A real MSSR sidecar search → Jev 1.13.0 selection → exact fetch/evidence-pack smoke passed; outcome and limitations are recorded in MSSR `.mssr/PROJECT_STATE.md`. The separately attached direct MSSR connector still exposes the older input schema and is a host-side refresh/reconnect follow-up.

## Current release

Bridge 0.6.163 / MSSR 0.2.112 is active in the live HTTP Bridge (boot `502d5b26-269a-45dd-994c-a6c5c1e4a025`, port 3001) with 187 runtime tools; tunnel 8081 is ready. The live Bridge registry is current, while the direct MSSR connector schema in this chat is stale. The prior 0.6.162 deployment history and rollback evidence remain in [changelogs/0.6.162.md](../changelogs/0.6.162.md); older handoffs remain archived under `docs/archive/`.

## Liveness and observability

The observability worker, bounded read-your-writes overlay, passive WAL checkpointing, and routing-latency boundaries are described in the indexed `bridge-dashboard-routing-liveness` and `bridge-http-readiness-evidence-boundary` modules. Historical verification receipts stay in their release changelogs.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Jev/semantic experience remains shadow evidence only: unverified proposals do not become training truth, change routing, or rewrite canonical project data. Reliability evaluation still needs independently owner-labeled holdout cases and separately measured retrieval, selection, exact fetch, abstention, and synthesis outcomes.

## Project knowledge migration

Bridge project control is canonical under `.mssr/`. The archived September knowledge-migration and reference-audit snapshot is preserved under `docs/archive/`; rerun Project Context Health for current module/reference counts instead of relying on archived numbers.

## Next performance/control work

Refresh/reopen the direct MSSR connector so it accepts the active Bridge 0.6.163/MSSR 0.2.112 schema, then repeat the real-document integration through that connector. Keep independent source-held-out labels separate; the one-candidate live Jev smoke is integration evidence only and all provider scores remain uncalibrated.
