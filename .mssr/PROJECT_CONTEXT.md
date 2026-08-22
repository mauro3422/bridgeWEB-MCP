# Bridge project context

## Architecture

`bridge-mcp` is the MauroPrime host/adapter runtime. It exposes local tools, project context, provider adapters, observability, watchdog/restart flow, and ChatGPT Web integration. The Bridge HTTP/MCP adapter is specifically the ChatGPT Web access path; Codex does not use that transport and is handled through MSSR/local host adapters instead. Portable MSSR owns deterministic routing, learning schemas, project-context selection primitives, and cross-host contracts; Bridge consumes `@mauroprime/mssr` and owns filesystem/runtime integration.

## Canonical ownership

- Bridge runtime/tools/adapters: `D:\Dev\bridge-mcp\src`.
- Remote Linux execution is a Bridge-owned adapter, not a Kairos runtime dependency: `remote-node` uses in-process SSH with pinned host identity and local ignored node configuration; callers select configured node ids rather than supplying arbitrary hosts/users/keys.
- Portable MSSR contract: `D:\Dev\mssr`.
- MSSR first-party skills ship from the versioned `@mauroprime/mssr` package; Mauro's non-reserved custom reusable skills remain owned by `D:\Dev\mauroprime-skills` and are discovered through their runtime junctions.
- MSSR-owned project control is canonical-only under this repository's `.mssr/` home. `.mssr/project-context.json` is the sole manifest; `.mssr/knowledge/` stores topic/area modules and `.mssr/runtime/` stores ephemeral receipts/cache. `.bridge/` is never read as MSSR authority; only a bounded set of old MSSR-owned artifacts may be detected/removed during explicit initialization, while unrelated Bridge-specific `.bridge` data keeps its own owner/location.
- Versioned release history lives under `changelogs/`; the root `CHANGELOG.md` is a compatibility entry point.
- Stateful selection/page semantics come from packaged MSSR; Bridge owns only the serialized envelope, RAM continuation lease, host instructions and observability. Compact project/message budgets derive from the outer envelope and procedural budgets may vary by page without changing cursor-bound selection/order/bytes. Required and accepted roots stay distinct; notices use a separate bounded queue, never context transport. Oversized workflow guides defer to an exact post-context load. Page completion never implies use, checkpoint or outcome, and persistence proposals remain review-only.
- Bridge owns host observation, health projections, runtime persistence and delivery adapters; portable MSSR owns the semantic policies those adapters evaluate. Detailed Skill/Project Health and Operational Notice/Situation contracts live in indexed observability modules so they are loaded only when relevant.
- Architecture Impact: packaged MSSR owns semantics; Bridge only observes explicit-path mutations, stores host-local review receipts, and relays bounded WATCH/REVIEW evidence. Host semantic ownership and canonical auto-rewrite remain forbidden; detailed coverage lives in the indexed Architecture Impact module.

## Project knowledge governance

Project memory is explicit and reviewed. Portable MSSR may combine trace stage with privacy-safe host metadata—changed-path categories, material-write counts, package/runtime adoption, routing/skill-structure changes, Context Plane freshness and user corrections—to produce `NONE`/`WATCH`/`REVIEW`/`REQUIRED` owner advisories. `WATCH` stays low-noise evidence; `REVIEW`/`REQUIRED` activates the maintenance pass and only the relevant authority/recipe. Audit, telemetry and learning digests never invent or silently rewrite `AGENTS.md`, `.mssr/PROJECT_CONTEXT.md`, `.mssr/PROJECT_MEMORY.md`, `.mssr/PROJECT_STATE.md`, routing semantics, skills or references. A release changelog declares whether each PROJECT_* authority was `updated`, `reviewed-none`, or remains `pending`.
