# Bridge project state

## Unreleased Librarian query-variants candidate — 0.6.163 / MSSR 0.2.112 (2026-10-10)

Candidate branch `codex/bridge-mssr-0.2.112-query-variants-20261010` is based on `origin/main` 0.6.162 and vendors exact MSSR 0.2.112 bytes (1,121,628 bytes; SHA-256 `78a49828f9f27ebb3a3966b1a163ad9e24f7a3a8c38f1a8a4633d985106fd088`). It adds an optional, bounded host-supplied `queryVariants` field to the strict Librarian search contract; the primary query remains the first ranking group and per-query lexical scores are not confidence. The complete isolated `scripts/verify-all.ps1` gate exited 0 with `failedRequired=0`, including the full 299-second regression suite, live candidate HTTP smoke, routing latency, WAL, liveness, routing and docs checks; transcript is preserved outside Git at `D:\MSSR-benchmark-artifacts\bridge-0.6.163-mssr-0.2.112-verify-20261010\verify-all-transcript.txt`. This is not deployed: the live Bridge remains 0.6.162 / MSSR 0.2.110, boot `8cc63551-7a20-4a02-9455-a78f33d6927b`, ready on port 3001 with 187 tools. Do not report adoption until the controlled handoff and live catalog/schema are read back.

## Current release

Bridge 0.6.162 / MSSR 0.2.110 remains active in the live HTTP Bridge (boot `8cc63551-7a20-4a02-9455-a78f33d6927b`, port 3001); last readback showed readiness on port 3001 and tunnel 8081, with 187 runtime tools. The connector schema snapshot had 186 tools and was stale. See [changelogs/0.6.162.md](../changelogs/0.6.162.md) for deployment/rollback evidence and [the archived September state](../docs/archive/PROJECT_STATE_2026-09.md) for older handoffs.

## Liveness and observability

The observability worker, bounded read-your-writes overlay, passive WAL checkpointing, and routing-latency boundaries are described in the indexed `bridge-dashboard-routing-liveness` and `bridge-http-readiness-evidence-boundary` modules. Historical verification receipts stay in their release changelogs.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Jev/semantic experience remains shadow evidence only: unverified proposals do not become training truth, change routing, or rewrite canonical project data. Reliability evaluation still needs independently owner-labeled holdout cases and separately measured retrieval, selection, exact fetch, abstention, and synthesis outcomes.

## Project knowledge migration

Bridge project control is canonical under `.mssr/`. The archived September knowledge-migration and reference-audit snapshot is preserved under `docs/archive/`; rerun Project Context Health for current module/reference counts instead of relying on archived numbers.

## Next performance/control work

Run the controlled 0.6.163/MSSR 0.2.112 Bridge handoff with live health and `mssr_librarian_search` schema readback. Then exercise `queryVariants` on real MSSR documents with Jev while keeping independent source-held-out labels separate; confidence remains uncalibrated until those labels and calibration checks exist.
