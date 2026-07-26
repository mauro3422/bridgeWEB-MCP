# bridge-mcp current status

Verified against the live HTTP bridge runtime on 2026-07-26.

```text
Project root:       C:\Dev\bridge-mcp
Server:             bridge-mcp 0.6.30
Mode:               Streamable HTTP production
Bridge MCP:         http://127.0.0.1:3001/mcp
Tunnel admin:       http://127.0.0.1:8081
Tunnel profile:     bridge-local-http
Runtime tools:      123
Runtime modules:    25
Git branch:         main
```

## Live health

```text
Bridge:             healthy
Tunnel healthz:     live
Tunnel readyz:      ready
Restart pending:    no
Roblox MCP:         healthy
Roblox tools:       27 live, no cached catalog
```

The watchdog owns restart coordination. Do not kill the active Node or tunnel processes from an MCP call. Use `bridge_request_restart`, then verify the acknowledgment and live version.

## Source boundaries

```text
src/
  Bridge server, HTTP transport, metrics, observability, integrations and tool modules.

scripts/
  Verification, watchdog, diagnostics, regression and generated-document commands.

integrations/workflow-guides/
  Reusable Bridge-delivered workflows; not a second skill repository.

config/
  Versioned configuration that belongs to Bridge.

docs/
  Durable architecture, incidents and repository guidance.

TOOLS.md
  Generated registry documentation. Regenerate; do not hand-maintain tool entries.

data/ logs/ sandbox/ tmp/ .tmp/
  Local runtime or diagnostic state, ignored by Git.
```

MSSR remains independent under `C:\Dev\mssr`. `src/tools/skill-routing.ts` is intentionally a compatibility re-export from `@mauroprime/mssr`, not a duplicate routing engine.

## Required verification

For source changes:

```powershell
npm run check
npm run build
npm run test:regressions
npm run test:skill-routing
npm run docs:tools:check
```

For a release or runtime-sensitive change:

```text
bridge_verify_all(expectedServerVersion="0.6.30", strictGit=true)
```

The latest strict verification passed doctor, typecheck, build, HTTP smoke, regressions, MSSR routing, generated tool docs, watchdog, metrics and tools/list sanity.

## Current maintenance priorities

1. Keep `bridge-server.ts`, `mssr-trace-context.ts` and observability changes covered by stateless/delegated-route regressions.
2. Refactor large tool modules only around proven ownership boundaries and behavior-preserving tests; file size alone is not a reason to split.
3. Keep persistent `data/` and operational `logs/` untouched during ordinary repository cleanup.
4. Prune only disposable ignored `tmp/`, `.tmp/`, smoke artifacts and explicitly expired cache entries.
5. Use live health and generated registry output instead of copying version/tool counts into chat handoff prompts.

## Authoritative references

- `README.md`
- `AGENTS.md`
- `docs/REPOSITORY_STRUCTURE.md`
- `docs/INCIDENTS.md`
- `TOOLS.md`
- `CONNECTOR_PLAYBOOK.md`
- `RESTART_FLOW.md`
- `BRIDGE_WATCHDOG.md`
