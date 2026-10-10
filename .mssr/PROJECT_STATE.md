# Bridge project state

## 0.6.166 Librarian evidence-pack integration candidate

The candidate adopts exact MSSR 0.2.115 bytes and adds the opt-in `dedupeContainedRanges` field to `mssr_librarian_evidence_pack`. The field defaults to false. When enabled, MSSR validates the supplied handles and removes only strictly contained ranges with matching owner, source, and revision; each removed handle retains its provenance and links to the kept citation. The retained text is unchanged. This does not decide whether the containing range semantically answers the child facet.

**Source verification:** `npm run check`, `npm run build`, `node scripts/test-mssr-semantic-evidence-tools.mjs`, and `npm run docs:tools:check` passed. Exact vendored artifact is 1,127,170 bytes, SHA-256 `e83a0f89bb33f4d67006bda7cffa239abdd2c111883e0a98c6d1c7dfed539176`. This focused regression is assembly-contract evidence, not Jev reliability evidence.

**Regression finding:** the first full-suite attempt exposed an existing race in `test-observability-http-liveness.mjs`: the stale snapshot endpoint correctly returned `refreshing=true`, while the test immediately required the background snapshot worker to be idle. The isolated worker test confirmed the request drains. The regression now allows only the expected single snapshot request during refresh and waits up to 30 seconds for it to complete. The corrected isolated liveness test passed with zero event-loop stalls and max `/readyz` of 1.52 ms for MSSR summary, 1.73 ms for audit, and 1.63 ms for concurrent dashboard reads.

**Activation:** activated through the managed HTTP watchdog request `50c2e09f-8747-4700-bf28-2218e0b400f1` on profile `bridge-local-http`. Live Bridge is 0.6.166 / MSSR 0.2.115, PID 73136, boot `860eaa90-3aa0-4c29-a20f-eb0455e22569`, with `ProjectRoot=D:\Dev\bridge-mcp`; watchdog PID 54004 owns the candidate code root. `/readyz` and observability storage are ready. The live `tools/list` catalog has 188 tools and exactly one `mssr_librarian_evidence_pack`; `dedupeContainedRanges` is present with default `false` and the strict containment/provenance boundary. Tunnel port 8081 returned HTTP 200 and was not restarted.

**Startup observation:** `/status` recorded one 3,383 ms event-loop lag during the first three seconds after boot. At uptime 33 seconds, the stall count and lag had not increased. Treat this as a boot-window observation only; cause is undetermined and no recurring liveness regression is established.

## Current release

Candidate branch `codex/bridge-mssr-0.2.112-query-variants-20261010` builds on the 0.6.164 Jev context-split adapter and 0.6.163/MSSR 0.2.112 Librarian query-variants line. It routes retained-history MSSR, tool-audit and metrics reads to a read-only child, keeps snapshot builds in a separate child, serves a persisted snapshot while storage starts, waits for worker IPC readiness, and separates request queue acceptance (5-minute limit) from accepted execution (120-second limit). `/status` exposes bounded worker health and pending request types. Context-inventory writes use serialized UUID temporary files.

**Active runtime readback:** Bridge 0.6.166 / MSSR 0.2.115, PID 73136, boot `860eaa90-3aa0-4c29-a20f-eb0455e22569`, port 3001, `ProjectRoot=D:\Dev\bridge-mcp`; startup watchdog PID 54004 owns the candidate code root. `/readyz` and storage are ready. The live catalog reports 188 tools, including the opt-in range compaction schema; tunnel 8081 remains healthy and was not restarted.

**Verification:** The 0.6.165 baseline passed `scripts/verify-all.ps1` with `failedRequired=0`, including typecheck/build, full HTTP smoke, the then-current regression suite, dual-era MCP, routing latency, WAL maintenance, 30k liveness, skill routing, generated tool docs, watchdog restart/status, metrics status and `tools/list`. For 0.6.166, `npm run check`, `npm run build`, full `npm run test:regressions`, `npm run test:mssr-semantic-evidence`, `npm run test:observability-http-liveness`, `npm run test:mcp-dual-era`, `npm run docs:tools:check`, and `git diff --check` passed before activation. Live `/readyz`, `/status`, tunnel health, and `tools/list` were read back after activation. Live smoke history at the 0.6.165 baseline saw 28,459 all-scope MSSR events, 4,872 routes, 360 outcomes, 188 registered tools, 44,857 active / 209,815 total calls and 20 profiles. Isolated liveness reached max `/readyz` 34.37 ms under concurrency and zero event-loop stalls.

Two earlier manual HTTP smokes returned 500 on accepted read-worker requests; later isolated requests and the full gate passed. The initial delays have no demonstrated cause, so this remains an intermittent unresolved runtime observation; details and follow-up are in [Bridge incidents](../../docs/INCIDENTS.md) and [0.6.165](../../changelogs/0.6.165.md). The direct MSSR connector may still require host refresh if its input schema does not match the live Bridge registry.

## 0.6.164 source candidate — Jev context-split planner adapter (2026-10-10)

The candidate adds `mssr_project_context_ref_split_plan`, a Bridge adapter for the planner already shipped in MSSR 0.2.112. It resolves the project through Bridge path policy, uses the Windows Credential Manager Jev provider, and persists only the advisory plan plus observe-only semantic evidence in user-local MSSR state. It does not change project Markdown or manifests; the apply operation remains unavailable through Bridge. `npm run check`, `npm run build`, and the focused adapter regression passed. This is source-only until the controlled restart and live `tools/list` schema/readback confirm version 0.6.164 and 188 tools.

## Librarian query-variants candidate active in local Bridge runtime — 0.6.163 / MSSR 0.2.112 (2026-10-10)

Candidate branch `codex/bridge-mssr-0.2.112-query-variants-20261010` is based on `origin/main` 0.6.162 and vendors exact MSSR 0.2.112 bytes (1,121,628 bytes; SHA-256 `78a49828f9f27ebb3a3966b1a163ad9e24f7a3a8c38f1a8a4633d985106fd088`). It adds an optional, bounded host-supplied `queryVariants` field to the strict Librarian search contract; the primary query remains the first ranking group and per-query lexical scores are not confidence. The complete isolated `scripts/verify-all.ps1` gate exited 0 with `failedRequired=0`, including the full 299-second regression suite, live candidate HTTP smoke, routing latency, WAL, liveness, routing and docs checks. Its structured result receipt is outside Git at `D:\MSSR-benchmark-artifacts\bridge-0.6.163-mssr-0.2.112-verify-20261010\verify-all-receipt.json` (SHA-256 `dc109740c2734613b5476afbb18d4060c5953eaab07a144a6114241e8c557005`). **Activated and read back 2026-10-10 06:23 UTC:** Bridge `/status` reports 0.6.163 and boot `502d5b26-269a-45dd-994c-a6c5c1e4a025`; `/readyz`, Bridge health and tunnel health are green. HTTP PID 67524 runs this candidate's `dist/http.js`, while `ProjectRoot=D:\Dev\bridge-mcp` and the existing tunnel PID 23336 was adopted without restart. The live registry exposes search schema `queryVariants` (hash `6bc987b8d512e7d0`). A real MSSR sidecar search → Jev 1.13.0 selection → exact fetch/evidence-pack smoke passed; outcome and limitations are recorded in MSSR `.mssr/PROJECT_STATE.md`. The separately attached direct MSSR connector still exposes the older input schema and is a host-side refresh/reconnect follow-up.

## Prior release baseline

Bridge 0.6.163 / MSSR 0.2.112 was the active baseline before the 0.6.165 candidate. Its Librarian/Jev behavior and exact package provenance remain recorded below and in [changelogs/0.6.163.md](../changelogs/0.6.163.md). Earlier 0.6.162 rollback evidence remains in [changelogs/0.6.162.md](../changelogs/0.6.162.md); older handoffs remain archived under `docs/archive/`.

## Liveness and observability

The observability worker, bounded read-your-writes overlay, passive WAL checkpointing, and routing-latency boundaries are described in the indexed `bridge-dashboard-routing-liveness` and `bridge-http-readiness-evidence-boundary` modules. Historical verification receipts stay in their release changelogs.

## Background work lifecycle

`work_begin` and `bridge_verify_all` treat a timeout as an attention deadline by default (`observe`), not permission to kill the process. `work_peek` exposes bounded progress/output counters plus sanitized process-tree CPU/memory evidence for one exact session. Explicit terminate behavior remains available and uses Windows process-tree termination. Notices are advisory; terminal/job state is authoritative.

## Current MSSR learning state

Jev/semantic experience remains shadow evidence only: unverified proposals do not become training truth, change routing, or rewrite canonical project data. Reliability evaluation still needs independently owner-labeled holdout cases and separately measured retrieval, selection, exact fetch, abstention, and synthesis outcomes.

## Project knowledge migration

Bridge project control is canonical under `.mssr/`. The archived September knowledge-migration and reference-audit snapshot is preserved under `docs/archive/`; rerun Project Context Health for current module/reference counts instead of relying on archived numbers.

## Next performance/control work

If the intermittent read-worker execution timeout recurs, capture the HTTP error body and the exact worker state transition before changing thresholds. Separately, refresh/reopen the direct MSSR connector if it still exposes a schema older than the live Bridge 0.6.166/MSSR 0.2.115 registry, then repeat the real-document integration through that connector. Keep independent source-held-out labels separate; the one-candidate live Jev smoke is integration evidence only and all provider scores remain uncalibrated.
