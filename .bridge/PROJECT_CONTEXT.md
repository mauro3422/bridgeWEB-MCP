# Bridge project context

## Architecture

`bridge-mcp` is the MauroPrime host/adapter runtime. It exposes local tools, project context, provider adapters, observability, watchdog/restart flow, and ChatGPT Web integration. Portable MSSR owns deterministic routing, learning schemas, project-context selection primitives, and cross-host contracts; Bridge consumes `@mauroprime/mssr` and owns filesystem/runtime integration.

## Canonical ownership

- Bridge runtime/tools/adapters: `D:\Dev\bridge-mcp\src`.
- Portable MSSR contract: `D:\Dev\mssr`.
- Custom reusable skills remain external until the planned MSSR first-party package migration.
- Project-local durable facts/state/decisions live under this repository's `.bridge` authorities.
- Versioned release history lives under `changelogs/`; the root `CHANGELOG.md` is a compatibility entry point.

## Project knowledge governance

Project memory is explicit and reviewed. Audit, telemetry, and learning digests may identify maintenance debt but never invent or silently rewrite `PROJECT_CONTEXT.md`, `PROJECT_MEMORY.md`, `PROJECT_STATE.md`, routing semantics, or skills. A release changelog declares whether each PROJECT_* authority was `updated`, `reviewed-none`, or remains `pending`.
