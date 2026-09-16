# bridge-mcp current status

Bridge `0.6.124` is the current verified source/dist/live release on vendored and installed `@mauroprime/mssr 0.2.61`.

```text
Project root:       D:\Dev\bridge-mcp
Source version:     bridge-mcp 0.6.124
Runtime version:    bridge-mcp 0.6.124
Installed MSSR:     @mauroprime/mssr 0.2.61
Runtime tools:      162
Transport:          streamable-http-dual-era
Bridge MCP:         http://127.0.0.1:3001/mcp
Tunnel admin:       http://127.0.0.1:8081
Tunnel profile:     bridge-local-http (live/ready)
Runtime PID/boot:   18368 / f37449a7-4ad8-4b8c-bd09-290e34bf3fe0
Last runtime ack:   2c2f029b-fa4b-4938-b032-7a5e6b62010c (restart-http)
Git branch:         main
```

## Current runtime/observability contract

- Bridge owns host/runtime integration, tools, persistence, transport, health and Notice delivery; portable MSSR owns semantic routing/project-control policies and semantic notice payloads.
- Dashboard analytics remain isolated behind one bounded cached snapshot so dashboard aggregation does not define HTTP/MCP liveness.
- MSSR/metrics durability uses a shared single-writer worker. Request-path events are queued rather than synchronously forcing durable SQLite work on the HTTP/MCP event loop.
- Immediate evidence is preserved with a bounded read-your-writes overlay. Live `trace`, `recent`, routing coverage/profile projections merge durable rows with pending events using stable event-id dedupe and domain ordering/chain rules.
- SQLite WAL maintenance is separate from receipt durability. Writers disable automatic checkpoints; passive checkpoints run after a true quiet-period debounce outside normal request work.
- Routing latency is attributed by layer: caller ingress/egress, Bridge dispatch, skill discovery, deterministic routing/context, persistence/WAL and downstream execution must not be collapsed into one “MSSR latency” number.
- Transport/readiness/routing-latency attention is Bridge-native Notice. A host latency warning does not become an MSSR semantic notice merely because MSSR work was active.
- Background work timeout remains an attention deadline unless explicit terminate behavior was requested. Exact process-tree evidence is inspected before killing work.

## Final 0.6.124 verification

```text
npm run check                         PASS
npm run build                         PASS
npm run test:regressions              PASS (exit 0, ~160.5 s)
test-observability-http-liveness      PASS (64/64 writes)
readyz samples                        115
readyz p95 / max                      6.45 ms / 97.15 ms
WAL maintenance                       PASS (busy=0, 57/57)
scripts/test-bridge-http.ps1          PASS
MCP initialize/session/delete         PASS
Live read-after-write post restart    PASS
Tunnel healthz / readyz               live / ready
Restart pending                       no
```

The controlled HTTP-only restart adopted the final verified build without restarting the Secure MCP tunnel. After adoption the infrastructure notice transitioned from `runtime-restarted` to resolved/stable. A live `skill_bootstrap` observed at 1791 ms triggered the Bridge-native `bridge-routing-latency` threshold at 1500 ms, proving the new attention path is active.

## Project knowledge rules

`AGENTS.md` is repository instruction authority. `.mssr/PROJECT_CONTEXT.md` stores stable architecture/ownership; `.mssr/PROJECT_MEMORY.md` stores durable decisions/lessons; `.mssr/PROJECT_STATE.md` stores mutable current state; `.mssr/knowledge/<topic>/...` stores conditional durable modules; `.mssr/project-context.json` is the selectable manifest. Telemetry and notices may request review but never auto-author these authorities.

For release persistence, `changelogs/X.Y.Z.md` must declare `PROJECT_CONTEXT`, `PROJECT_MEMORY` and `PROJECT_STATE` as `updated`, `reviewed-none` or `pending`. Run `project_change_consistency(mode=persist)` before publication. A green build is not a replacement for project-knowledge review.

Current Project Context Health is WATCH because root `PROJECT_MEMORY.md` is approaching monolithic size. This is advisory, not a release blocker; new topic-specific durable knowledge should prefer indexed `.mssr/knowledge/` modules where appropriate.

## Operating rules

- Use `project_context_load` once when entering/resuming substantial repo work, then structured `skill_bootstrap` with bounded continuation context.
- Inspect Git state before mutation; concurrent work exists in this worktree and unrelated changes must not be restored, committed or rewritten.
- Prefer explicit Bridge tools over shell for file edits, Git, process inspection and restart coordination.
- Use `bridge_request_restart`; do not kill the production Bridge/tunnel directly from an MCP call.
- After a restart, re-establish project root/trace explicitly before assuming RAM continuity.
- Do not claim side effects from a lost/502 response without correlating runtime/transport and durable evidence.

## Performance work worth continuing

The next useful performance layer is a controlled fast path, not removal of MSSR governance:

1. Project/Trace Lease: perform full routing/bootstrap once, bind fast local operations to a validated project/trace/freshness lease, and invalidate on restart, owner/authority changes or material replan boundaries.
2. First-output/TTFB terminal start: optionally wait a small bounded interval and return initial stdout/stderr plus persistent session id, avoiding the immediate second MCP read round-trip for short commands.
3. Caller-to-Bridge latency probe: server-side timing already separates Bridge dispatch from unknown external ingress/egress; add a caller-visible round-trip probe if the connector/client contract permits it so cloud/tunnel latency can be measured rather than inferred.
4. Continue keeping heavy observability/dashboard aggregation off the HTTP/MCP event loop and use bounded SQL/worker snapshots instead of unbounded synchronous scans.

## Verification for future source changes

```powershell
npm run check
npm run build
npm run test:regressions
powershell -NoProfile -File .\scripts\test-bridge-http.ps1
node .\scripts\test-metrics-wal-maintenance.mjs
```

Run `npm run docs:tools` / `npm run docs:tools:check` when tool descriptions or schemas change. For portable MSSR changes, verify in `D:\Dev\mssr` under that repository's own contract.

## Authoritative references

- `AGENTS.md`
- `.mssr/project-context.json`
- `.mssr/PROJECT_CONTEXT.md`
- `.mssr/PROJECT_MEMORY.md`
- `.mssr/PROJECT_STATE.md`
- `changelogs/INDEX.md`
- `changelogs/0.6.124.md`
- `docs/INCIDENTS.md`
- `TOOLS.md`
- `CONNECTOR_CONTEXT.md`
- `CONNECTOR_PLAYBOOK.md`
- `RESTART_FLOW.md`
- `BRIDGE_WATCHDOG.md`

No commit, push, or public package publication is implied by this status file; verify Git separately.
