# Bridge project state

## Current release

MSSR 0.2.127 is pinned to artifact SHA-256 `70e79ae6e472517501ffdd38c4b0eaad740652c7d570b600bf17f90023703bfc`. Bridge 0.6.172 commit `391a1bb` is published on `origin/main` and active. The HTTP watchdog uses `D:\Dev\bridge-mcp-mssr-0.2.112-query-variants` as `BridgeCodeRoot` and `D:\Dev\bridge-mcp` as `ProjectRoot`; the latter's legacy Git changes remain untouched. The controlled restart `71edef1e-2e5f-4c51-a88c-b9bbc1ed38aa` returned its planned-maintenance notice and was acknowledged as `restart-http` at 2026-10-11T22:34:49Z by watchdog PID 25000. Active Bridge PID 17148, boot `0f3859cd-6eca-4b4c-b2ad-1d20dd819012`, reports 189 tools; Bridge and tunnel are ready. Prior release activation readback is in [changelogs/0.6.172.md](../../changelogs/0.6.172.md); this post-release restart is recorded here.

Run 28 Jev trace `mssr-20261011192330-63da3054-527` remains `closed-success` with its original outcome; its recovered digest contains all 102 unique context selections. No second outcome or benchmark rerun was created.
## Previous release

Bridge 0.6.169 / MSSR 0.2.121 was active immediately before 0.6.170 and adopted the exact MSSR 0.2.121 release artifact (1,137,867 bytes; SHA-256 `181bf914da4f5767c457755990798169f6d539f56886b420bd8410951b5d8971`). Its runtime history and earlier watchdog request remain recorded in the 0.6.169 changelog.

**Exploratory real-document Jev smoke (not benchmark/calibration evidence):** the live 1.13.0 provider selected two exact ranges from `.mssr/knowledge/architecture/semantic-evidence-plane.md`. The first selected `block-4` at line 13 and fetched it at the same source revision; it supported the source-authority/revision boundary but only partially covered the two-facet query. A targeted follow-up selected `block-9` at line 26, covering host re-read/revision check, approval/write outside MSSR, and independent verification. Both ranges revalidated and the evidence pack assembled their unchanged text in source order (1,595 UTF-16 code units, two citations, no semantic rewrite). The two calls used 2,795/207 and 1,946/147 input/output tokens; provider confidences were 0.34 and 0.30, Noul estimates 0.79 and 0.54. Both scores remain explicitly uncalibrated; this exploratory sample has no independent owner label and must not be treated as a reliability result. Jev remained advisory and no canonical source was written.

## 0.6.168 MSSR 0.2.120 adoption — previous active

The release branch vendors the exact MSSR 0.2.120 artifact at `vendor/mauroprime-mssr-0.2.120.tgz` (1,136,180 bytes; SHA-256 `52b4bfbf928b222a282f672b22768d70ca3a5fbf344843b0a487429a56789946`). It includes releases 0.2.116–0.2.120: revision-bound list-item ranges, project-context modularization and verified-project breadth gating, and exact metadata-filter schema clarification. Bridge 0.6.168 check/build, focused MSSR integrations, project-context and first-party-skill tests, full isolated regressions, dual-era MCP, and generated tool docs passed before activation.

**Active runtime readback (2026-10-11):** Watchdog request `e557812d-c655-461d-bfce-707fd54fc3a7` was acknowledged as `restart-http` by watchdog PID 25000 on profile `bridge-local-http`. Bridge 0.6.168 / MSSR 0.2.120 is running from `D:\Dev\bridge-mcp-mssr-0.2.112-query-variants`, HTTP PID 25668, boot `ee6bc4d6-3df7-4a85-b319-82baa6956926`; Bridge `/readyz` and `/status` read back 0.6.168. The live `tools/list` returned 188 tools. The watchdog uses `D:\Dev\bridge-mcp` as its runtime/data `ProjectRoot` and the release checkout as `BridgeCodeRoot`; its request/ack files therefore live under the former. The tunnel client PID 18968 was preserved without restart, with healthz/readyz `live`/`ready`; the PC was not restarted. Tunnel process metrics show one 502 and one no-status during the Bridge restart window and zero new failures since the post-restart baseline at 09:23:06 UTC. A first request written under the code checkout was not consumed; after verifying its exact request ID it was removed, and the correctly rooted HTTP request was acknowledged.

## 0.6.167 Librarian metadata filter schema — previous active baseline

This release clarifies exact metadata field/value filters and the singular EvidenceAtom projection keys in the Bridge search schema and docs. Typecheck/build, MCP module and dual-era schema tests, generated tool documentation checks, and the full isolated regression suite passed.

**Active runtime readback (2026-10-10):** The managed watchdog request `b54d0f8d-4439-4e2f-b272-0abd1eed74e8` was acknowledged by watchdog PID 54004 on profile `bridge-local-http`. Bridge 0.6.167 / MSSR 0.2.115 is running from `D:\Dev\bridge-mcp-mssr-0.2.112-query-variants`, HTTP PID 85008, boot `d0d360a5-469f-4ddc-8414-67667e2d12d6`; its data root remains `D:\Dev\bridge-mcp`. `/readyz` returned 200/ready. The live catalog reports 188 tools. `mssr_librarian_search` schema hash `b931631885199014` exposes all eleven singular EvidenceAtom projection keys and maps sidecar `domains`/`actions` to query `domain`/`action`. The existing tunnel on 8081 remained healthy/ready and its post-restart baseline recorded zero new 502/no-status failures; it was not restarted.

## 0.6.166 Librarian evidence-pack integration candidate

The candidate adopts exact MSSR 0.2.115 bytes and adds the opt-in `dedupeContainedRanges` field to `mssr_librarian_evidence_pack`. The field defaults to false. When enabled, MSSR validates the supplied handles and removes only strictly contained ranges with matching owner, source, and revision; each removed handle retains its provenance and links to the kept citation. The retained text is unchanged. This does not decide whether the containing range semantically answers the child facet.

**Source verification:** `npm run check`, `npm run build`, `node scripts/test-mssr-semantic-evidence-tools.mjs`, and `npm run docs:tools:check` passed. Exact vendored artifact is 1,127,170 bytes, SHA-256 `e83a0f89bb33f4d67006bda7cffa239abdd2c111883e0a98c6d1c7dfed539176`. This focused regression is assembly-contract evidence, not Jev reliability evidence.

**Regression finding:** the first full-suite attempt exposed an existing race in `test-observability-http-liveness.mjs`: the stale snapshot endpoint correctly returned `refreshing=true`, while the test immediately required the background snapshot worker to be idle. The isolated worker test confirmed the request drains. The regression now allows only the expected single snapshot request during refresh and waits up to 30 seconds for it to complete. The corrected isolated liveness test passed with zero event-loop stalls and max `/readyz` of 1.52 ms for MSSR summary, 1.73 ms for audit, and 1.63 ms for concurrent dashboard reads.

**Activation:** activated through the managed HTTP watchdog request `50c2e09f-8747-4700-bf28-2218e0b400f1` on profile `bridge-local-http`. Live Bridge is 0.6.166 / MSSR 0.2.115, PID 73136, boot `860eaa90-3aa0-4c29-a20f-eb0455e22569`, with `ProjectRoot=D:\Dev\bridge-mcp`; watchdog PID 54004 owns the candidate code root. `/readyz` and observability storage are ready. The live `tools/list` catalog has 188 tools and exactly one `mssr_librarian_evidence_pack`; `dedupeContainedRanges` is present with default `false` and the strict containment/provenance boundary. Tunnel port 8081 returned HTTP 200 and was not restarted.

**Startup observation:** `/status` recorded one 3,383 ms event-loop lag during the first three seconds after boot. At uptime 33 seconds, the stall count and lag had not increased. Treat this as a boot-window observation only; cause is undetermined and no recurring liveness regression is established.

## Previous active runtime baseline before 0.6.169

Bridge 0.6.168 / MSSR 0.2.120 was the active release before the 0.6.169 candidate. Its exact artifact, runtime boot, watchdog acknowledgement, 188-tool catalog, preserved tunnel, and post-restart metric baseline are recorded above and in [changelogs/0.6.168.md](../changelogs/0.6.168.md). Detailed history and earlier runtime observations remain in versioned changelogs and incident records.

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

If the intermittent read-worker execution timeout recurs, capture the HTTP error body and the exact worker state transition before changing thresholds. Separately, refresh/reopen the direct MSSR connector so its input description catches up with the live Bridge 0.6.167/MSSR 0.2.115 registry, then repeat the real-document integration through that connector. Keep independent source-held-out labels separate; the one-candidate live Jev smoke is integration evidence only and all provider scores remain uncalibrated.
