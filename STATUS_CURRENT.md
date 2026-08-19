# bridge-mcp current status

Bridge `0.6.105` is the current live C2e Situation Model release with packaged MSSR `0.2.26`; focused verification and the clean full post-adoption regression are green.

```text
Project root:       D:\Dev\bridge-mcp
Source version:     bridge-mcp 0.6.105
Compiled version:   bridge-mcp 0.6.105
Runtime version:    bridge-mcp 0.6.105
Source MSSR:        @mauroprime/mssr 0.2.26
Installed MSSR:     @mauroprime/mssr 0.2.26
Runtime tools:      156
Mode:               Streamable HTTP + C2e Situation watcher live
Bridge MCP:         http://127.0.0.1:3001/mcp
Situation API:      http://127.0.0.1:3001/api/mssr/project-situation
Tunnel admin:       http://127.0.0.1:8081
Tunnel profile:     bridge-local-http (live/ready)
Last runtime ack:   2641d44f-17c3-48db-b33a-2d54877df705 (auto-restart-http-readiness-threshold)
Git branch:         main
```

## Current source/runtime contract

- MSSR `0.2.26` owns portable project-control plus C2b routing compliance, C2c consistency diagnosis, C2d `evidence-first-v1` planning, and C2e Situation Model evidence normalization/classification.
- Bridge consumes C2c/C2d/C2e; it owns host observation, metadata-only watcher persistence and action rendering, not semantic ownership or recommendation order. Only C2d `ready` recommendations become immediate notice actions.
- `src/project-situation.ts` compares operationally active Context Plane delivery receipts with current canonical repository revisions and exposes `/api/mssr/project-situation`; newest/current delivery supersedes older receipts and stable REVIEW is suppressed across restarts.
- Evidence class (`observed`/`declared`/`inferred`/`learned`) and priority are advisory metadata. They do not override repository ownership, and free-form project memory is not parsed into canonical truth.
- `src/release-consistency.ts` continues to compare package/source/dist/live and declared/installed MSSR through C2c/C2d. Build parity is proven before runtime adoption; a watchdog ack alone does not prove intended bytes are live.
- `bridgeNotices` remains the only general notice transport; Situation classes/categories/priority are orthogonal routing metadata over the existing OK/WATCH/REVIEW/ERROR transition contract.
- MSSR learning remains `observe-only` with `routingInfluence=false`; learned recommendation weights/priors require replay/calibration/shadow/feature-flag/rollback gates before any influence.

## Project knowledge rules

`AGENTS.md` is broad repository instruction authority. `.mssr/PROJECT_CONTEXT.md` stores stable architecture/facts/ownership; `.mssr/PROJECT_MEMORY.md` stores durable decisions/lessons; `.mssr/PROJECT_STATE.md` stores mutable current state; `.mssr/knowledge/<topic>/...` stores conditional durable modules; `.mssr/project-context.json` indexes/selects only relevant content. A release changelog declares each PROJECT_* authority as `updated`, `reviewed-none`, or `pending`; `pending` blocks persistence.

Audits, telemetry, Context Plane receipts, trace metadata and learning may detect drift or propose maintenance. They are evidence only and do not synthesize or silently rewrite durable project memory, AGENTS, skills, references or routing. `project_context_update` is the explicit stable-section writer; `project_context_capture` is the explicit reviewed topic/area module writer. Both require an initialized canonical manifest.

Workspace project-authority audit after the 0.2.18 canonical-only initialization pass:

```text
Managed Git repositories:    22
Initialized/valid:           22
Health OK / modular:         16
Health WATCH:                 2
Health REVIEW:                4
Initialization blocked:       0
```

All 22 managed Git repositories now have valid canonical MSSR initialization. Portable discovery excludes generated migration-backup/audit/vendor/snapshot trees; the second workspace pass changed 0 and blocked 0, proving idempotence. Structural health remains advisory: REVIEW currently names `electronics-repair-simulator`, `GodotAtlas`, `MyceliumFront`, and `TabletWhiteboard`; WATCH names `LLM-Rig` and `mauroprime-godot-mcp`. The daily Project Context Health scheduler persists metadata-only snapshots and surfaces this worklist without autoediting it.

## Live health

```text
Bridge live:          0.6.105 (verified)
MSSR live package:    0.2.26
Runtime PID/boot:     36416 / f9130047-23e0-4f4e-84df-6a0e87b1e7cd
Project home:         .mssr (canonical-only)
Tunnel healthz:       live
Tunnel readyz:        ready
Runtime tools:        156
C2c/C2d parity:       OK / evidenceComplete=true / 0 mismatches / evidence-first-v1 / nextAction=null
C2e Situation:        live; revision/receipt mismatch transitions feed existing bridgeNotices
Restart pending:      no
```

The watchdog owns restart coordination. Do not kill the active Node/tunnel processes from an MCP call. Use `bridge_request_restart` only when executable/package state actually changed, then verify health/readiness/version/tools.

## Required verification

For Bridge source changes:

```powershell
npm run check
npm run build
npm run test:regressions
npm run test:skill-routing
npm run docs:tools
npm run docs:tools:check
```

For MSSR portable changes:

```powershell
cd D:\Dev\mssr
npm run verify
```

Before persistence/publication, run `project_change_consistency` in `persist` mode. A clean build does not prove PROJECT_CONTEXT/MEMORY/STATE impact was reviewed. Runtime-sensitive 0.6.100 adoption is proven by watchdog restart/readback plus authoritative `bridge_verify_all(expectedServerVersion="0.6.100", strictGit=false)` job `bridge_verify_1786837082102_2`; strict Git cleanliness remains a separate publication-policy gate because this workspace intentionally contains unrelated in-progress changes.

## Current maintenance priorities

1. Accumulate strict learning digests without routing influence; evaluate dataset quality, replay/holdout, calibration and shadow predictions before any activation discussion.
2. Operational Notice Plane C2: migrate provider/tunnel/runtime/restart health onto the shared transition evaluator with bounded semantic fingerprints, stable-state negative tests and explicit resolution behavior.
3. After provider/runtime health, migrate routing-compliance / required-skill anomalies only where a stable portable evidence contract is defined.
4. Continue structural Skill Health review of remaining WATCH/REVIEW skills without turning references into routing nodes or autoediting skills.
5. Preserve `.bridge` only for Bridge-owned project surfaces or explicit legacy-compatibility tests/history; new MSSR project authorities and runtime Context Plane state belong under `.mssr`. Preserve `changelogs/INDEX.md` as the selective history entry point.

## Authoritative references

- `README.md`
- `AGENTS.md`
- `.mssr/project-context.json`
- `.mssr/PROJECT_CONTEXT.md`
- `.mssr/PROJECT_MEMORY.md`
- `.mssr/PROJECT_STATE.md`
- `changelogs/INDEX.md`
- `ROADMAP.md`
- `TOOLS.md`
- `CONNECTOR_PLAYBOOK.md`
- `RESTART_FLOW.md`
- `BRIDGE_WATCHDOG.md`
