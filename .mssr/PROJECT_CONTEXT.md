# Bridge project context

## Architecture
`bridge-mcp` is MauroPrime's host/adapter runtime for tools, project context, providers, observability, and supervision. HTTP/MCP is the ChatGPT Web path; Codex uses MSSR/local adapters. Portable MSSR owns routing, learning schemas, project-context selection and cross-host contracts; Bridge owns host, filesystem and runtime integration.

HTTP supervision separates `BridgeCodeRoot` (package, `dist/http.js`, and self-release audits) from `ProjectRoot` (working directory and relative runtime/data). When omitted, `BridgeCodeRoot` defaults to `ProjectRoot`; see the indexed watchdog invariant.

## Canonical ownership

- Bridge source, tools and adapters belong to this repository.
- Bambu owns tool behavior; Bridge owns confirmed, allowlisted stdio reconnect.
- Remote Linux execution is Bridge-owned through pinned-key SSH and configured node ids; callers cannot supply arbitrary hosts or credentials.
- Portable MSSR contract: `D:\Dev\mssr`.
- MSSR first-party skills ship from the versioned `@mauroprime/mssr` package; Mauro's non-reserved custom reusable skills remain owned by `D:\Dev\mauroprime-skills` and are discovered through their runtime junctions.
- Cross-project skill-maintenance projections are review-only evidence under `.mssr/runtime`; MSSR owns their semantics and the indexed `bridge-skill-maintenance-projection` module owns Bridge transport details.
- `.mssr/` is the sole MSSR project-control home: `project-context.json` is its manifest, `knowledge/` stores indexed modules, and `runtime/` stores ephemeral receipts/cache. `.bridge/` is never MSSR authority; legacy MSSR artifacts are removed only during explicit initialization, while Bridge-specific `.bridge` data keeps its owner.
- Versioned release history lives under `changelogs/`; the root `CHANGELOG.md` is a compatibility entry point.
- Packaged MSSR owns routing, lifecycle and semantic policies; Bridge owns host integration, observation, persistence and delivery. Detailed boundaries stay in indexed `.mssr/knowledge/` modules.
- Cross-repository ownership decisions from MSSR are advisory; Bridge's scoped host pre-write checks and current coverage boundary are indexed in [cross-repo write preflight](knowledge/operations/bridge-cross-repo-write-preflight.md).
- Binary MCP resource links are scoped to stateful server sessions. The unauthenticated modern endpoint is stateless, so it returns immediate embedded attachments and rejects deferred link-only reads; see [MCP binary and image transport](../docs/MCP_BINARY_AND_IMAGE_TRANSPORT.md).
- Dashboard/Human Cockpit are read-only projections; keep analytics off the MCP loop, caches acceleration-only, and current work separate from observed/history. See indexed cockpit and resume-inventory modules.
- MSSR owns Librarian/Jev semantics; Bridge provides bounded source reads, evidence packs and advisory plans. Jev metadata stays advisory, and Bridge does not apply plans to project truth.
## Project knowledge governance

Project memory is explicit and reviewed. Portable MSSR may combine trace stage with privacy-safe host metadata—changed-path categories, material-write counts, package/runtime adoption, routing/skill-structure changes, Context Plane freshness and user corrections—to produce `NONE`/`WATCH`/`REVIEW`/`REQUIRED` owner advisories. `WATCH` stays low-noise evidence; `REVIEW`/`REQUIRED` activates the maintenance pass and only the relevant authority/recipe. Audit, telemetry and learning digests never invent or silently rewrite `AGENTS.md`, `.mssr/PROJECT_CONTEXT.md`, `.mssr/PROJECT_MEMORY.md`, `.mssr/PROJECT_STATE.md`, routing semantics, skills or references. A release changelog declares whether each PROJECT_* authority was `updated`, `reviewed-none`, or remains `pending`.

## Dashboard analytics resilience
Dashboard analytics must remain off the main HTTP/MCP event loop. Bridge owns one persistent isolated analytics child that opens observability storage read-only, plus a bounded persisted last-good dashboard snapshot. On restart or a cold analytics import, the HTTP dashboard may serve that stale seed immediately and refresh it in the background; analytics cold-start cost must not gate `/readyz` or first paint. Human Cockpit trace cards are read-only projections of MSSR lifecycle evidence: prefer bounded route summaries, derive deterministic human labels when absent, and classify technical/setup-only traces as intermediate instead of presenting opaque trace ids as user tasks.

On cold HTTP start, a short-lived child initializes the writable observability schemas after listen; liveness remains responsive while database-backed routes and MCP dispatch wait for that shared initialization. A single transient SQLite busy/locked failure may be retried. Persistent initialization failure keeps health live, revokes readiness, rejects database/MCP work before dispatch, and still permits the last-good dashboard snapshot.

## HTTP verifier root handoff
The HTTP watchdog exports `BRIDGE_MCP_CODE_ROOT` for source/release checks and `BRIDGE_MCP_PROJECT_ROOT` for runtime/data-backed checks. This keeps telemetry smoke on the data owner when verification runs from the separate code checkout; see the indexed watchdog invariant for recovery and filesystem boundaries.
