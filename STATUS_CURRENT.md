# bridge-mcp current status

Verified against the live HTTP Bridge runtime `0.6.86` on 2026-08-13 after source verification and watchdog reload.

```text
Project root:       C:\Dev\bridge-mcp -> D:\Dev\bridge-mcp (junction)
Source version:     bridge-mcp 0.6.86
Runtime version:    bridge-mcp 0.6.86
Runtime tools:      146
Mode:               Streamable HTTP production-candidate
Bridge MCP:         http://127.0.0.1:3001/mcp
Tunnel admin:       http://127.0.0.1:8081
Tunnel profile:     bridge-local-http
Git branch:         main
```

## Current 0.6.86 source changes

- MSSR learning remains `observe-only` with `routingInfluence=false`; historical rates/priors are not consumed by routing or context selection.
- `project_context_audit` provides read-only workspace governance for modular/legacy/invalid/empty/not-initialized project authorities.
- `project_change_consistency` provides a read-only review/persist gate over Git changes, package version, versioned changelog, changelog index and PROJECT_CONTEXT/MEMORY/STATE impact.
- Bridge and MSSR now maintain real modular `.bridge` project authorities instead of an empty/legacy project-context surface.
- New releases use `changelogs/X.Y.Z.md` plus `changelogs/INDEX.md`; previous monolithic history is preserved in `changelogs/LEGACY.md`.
- Debug/recovery intent can load the changelog index plus current release selectively; the legacy archive is not injected by default.

## Project knowledge rules

`PROJECT_CONTEXT.md` stores stable repository facts and ownership. `PROJECT_MEMORY.md` stores durable decisions/lessons. `PROJECT_STATE.md` stores mutable current state. A versioned changelog declares each authority as `updated`, `reviewed-none`, or `pending`; `pending` blocks persistence.

Audits, telemetry and learning may detect drift or propose maintenance. They do not synthesize or silently rewrite durable project memory. `project_context_update` remains the explicit stable-section writer/manifest transaction.

## Live health

```text
Bridge 0.6.86:      ready
Tunnel healthz:     live
Tunnel readyz:      ready
Runtime tools:      146
Restart pending:    no
```

The watchdog owns restart coordination. Do not kill the active Node/tunnel processes from an MCP call. Use `bridge_request_restart` only when a runtime reload is actually required, then verify `/status`, readiness and tools/list.

## Required verification

For source changes:

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
cd C:\Dev\mssr
npm run verify
```

Before persistence/publication, run `project_change_consistency` in `persist` mode (or its built-source equivalent before the new Bridge is live). A clean build is not evidence that project state/memory/changelog was reviewed.

For a runtime-sensitive release, finish with `bridge_verify_all(expectedServerVersion="0.6.86", strictGit=true)` after publication/restart.

## Current maintenance priorities

1. Accumulate strict learning digests without routing influence; then evaluate dataset quality, replay/holdout, calibration and shadow predictions before any activation discussion.
2. Migrate active legacy project authorities only after reading each owning repository; do not mass-create empty memory/manifests.
3. Move/audit MSSR-owned operational skills into the planned first-party MSSR package when the external skill repo has a clean ownership window.
4. Extend project authority/change-consistency semantics to Codex/OpenCode/native MSSR adapters.
5. Preserve `changelogs/INDEX.md` as the selective history entry point and load older releases only when a concrete regression requires them.

## Authoritative references

- `README.md`
- `AGENTS.md`
- `.bridge/project-context.json`
- `.bridge/PROJECT_CONTEXT.md`
- `.bridge/PROJECT_MEMORY.md`
- `.bridge/PROJECT_STATE.md`
- `changelogs/INDEX.md`
- `ROADMAP.md`
- `TOOLS.md`
- `CONNECTOR_PLAYBOOK.md`
- `RESTART_FLOW.md`
- `BRIDGE_WATCHDOG.md`
