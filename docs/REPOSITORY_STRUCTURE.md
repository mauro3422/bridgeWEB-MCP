# Bridge repository structure

## Purpose

Keep the local MCP bridge reviewable without confusing source, generated registry documentation, runtime telemetry, caches, temporary diagnostics and reusable workflow content.

## Canonical source

```text
src/
├── bridge-server.ts          request dispatch and MCP lifecycle
├── http.ts                   Streamable HTTP server and local dashboard routes
├── config.ts                 environment-backed configuration
├── metrics.ts                telemetry persistence contract
├── mssr-observatory.ts       MSSR observability projection
├── mssr-trace-context.ts     route/trace continuity and notices
├── integrations/             external application clients
├── dashboard/                local dashboard document, markup, script and styles
└── tools/                    one module per capability family
    └── shared/               reusable internal primitives
```

`src/tool-registry.ts` is the composition root for tool modules. `src/tools/skill-routing.ts` is deliberately a compatibility adapter that re-exports `@mauroprime/mssr`; the portable routing engine belongs to `D:\Dev\mssr`.

## Executable support

```text
scripts/
  Build-time generators, regression fixtures, smoke tests, diagnostics,
  watchdog control and full verification.

integrations/workflow-guides/
  Reusable phased procedures exposed by Bridge. They complement global skills;
  they do not copy the `mauroprime-skills` repository.

config/
  Bridge-owned versioned configuration only.

tools/
  Shipped helper binaries or packages required by the local runtime.
```

## Documentation

```text
README.md                installation, operation and public entry point
AGENTS.md                repository working rules
STATUS_CURRENT.md        concise live-verified operating snapshot
TOOLS.md                 generated registry reference
CHANGELOG.md             released behavior
ROADMAP.md               planned work
AGENTIC_TOOLS_ROADMAP.md longer capability direction
CONNECTOR_*.md           connector architecture and operating playbook
HTTP_LOCAL_MCP.md        HTTP transport details
RESTART_FLOW.md          coordinated restart contract
BRIDGE_WATCHDOG.md       watchdog ownership
TROUBLESHOOTING.md       symptom-first recovery
NEXT_CHAT_PROMPT.md      deprecated pointer to context-first continuation

docs/INCIDENTS.md        durable tool/transport/lifecycle incidents
docs/REPOSITORY_STRUCTURE.md
                         source/runtime/generated boundaries
```

Do not add another current-status or continuation document. Update the owner above or use live tools.

## Generated files

`TOOLS.md` is generated from the live registry schema. Update the source module and run:

```powershell
npm run docs:tools
npm run docs:tools:check
```

Do not edit individual tool entries manually.

`dist/` is compiler output and remains ignored. It is verified by `npm run build`, not committed as a parallel source tree.

## Runtime and local state

These paths are intentionally outside Git:

```text
data/
  SQLite metrics, observability state and persistent caches.

logs/
  Operational logs and event streams.

sandbox/
  Local bounded tool workspace.

tmp/ and .tmp/
  Disposable diagnostics and review artifacts.

.bridge-restart-request / .bridge-restart-ack
  Watchdog coordination state.

.smoke-test.txt and *.log
  Disposable probes.
```

Ordinary cleanup may remove disposable `tmp/`, `.tmp/` and completed smoke artifacts. It must not delete `data/`, operational `logs/`, restart coordination or active sandbox state merely to reduce disk usage. Persistent cache pruning uses the cache tools and an explicit age/namespace policy.

## Module boundaries

Some source modules are large because they expose many closely related MCP schemas and handlers. Size is a review signal, not proof of bad structure.

Split a module only when all are true:

1. responsibilities have different owners or lifecycle;
2. the public tool schemas remain stable;
3. shared state has an explicit boundary;
4. focused regression coverage exists before extraction;
5. the registry still composes one unambiguous capability family;
6. typecheck, build, regressions, routing and generated docs remain equivalent.

Current review hotspots include skill catalog/proxy, MSSR observability/trace context, Python analysis, Blender and dashboard script ownership. Use the `safe-modular-refactoring` guide rather than moving functions by file length.

## Repository hygiene gates

Before commit:

```text
[ ] no secrets, SQLite files, logs, cache blobs or temporary images staged
[ ] source and generated documentation agree
[ ] compatibility adapters are not mistaken for dead code
[ ] ignored runtime roots remain outside Git
[ ] npm run check
[ ] npm run build
[ ] relevant regressions
[ ] npm run docs:tools:check
```

Before publishing a runtime release, run `bridge_verify_all` against the expected live version and verify local, tracking and direct remote refs separately.
