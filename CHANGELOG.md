## 0.6.34 - 2026-07-27

- Add a read-only Tools / Tool Portfolio dashboard tab backed by the canonical registry metadata and privacy-safe aggregate tool audit.
- Add `/api/tools/audit` with bounded view, scope, days and limit parameters, including HTTP 400 for invalid views.
- Add searchable family, role, status and lifecycle filters plus evidence, confidence and recommendation details for all 125 tools.
- Reuse the same registered-tool audit projection across MCP and HTTP surfaces and add dashboard/endpoint regression coverage.
- Add per-tool usage metadata with prerequisites, preflight tools and recovery rules exposed through `bridge_tool_schema`.
- Add actionable notice suggestions, a bounded 24-hour recent-history endpoint and dashboard reminders without automatic execution.
- Make `skill_route_plan` return a complete `skill_bootstrap` next action so current-phase skills can be loaded automatically on one trace.
- Reclassify missing runtime targets as caller/context UX friction before treating a tool implementation as broken.



## 0.6.33 - 2026-07-27

- Add canonical tool metadata for role, family, lifecycle, aliases, and preferred tools across the runtime registry.
- Add read-only `bridge_tool_audit` to combine registry metadata with privacy-safe aggregate metrics and return evidence-backed maintenance recommendations without automatic mutations.
- Classify bounded tool errors for schema, risk, provider, timeout, patch, target, safety, runtime, and unknown failure families.
- Expose tool metadata through `bridge_tool_schema`, regenerate tool documentation, and add focused registry/audit regressions.


## 0.6.32 - 2026-07-27

- Require `bridge_tool_schema` inspection in delegated fallback descriptions before callers build runtime arguments.
- Add regression coverage for schema-first delegation guidance.

## 0.6.31 - 2026-07-26

- Add `bridge_tool_schema`, a read-only runtime contract inspector for tools whose dedicated connector schema is missing.
- Return the exact tool description, input schema, and safety annotations before delegated query/action calls.
- Extend registry and whiteboard regressions and regenerate `TOOLS.md` for 124 runtime tools.

## 0.6.30 - 2026-07-26

- Recover the uniquely fresh delegated MSSR route when ChatGPT Web provides no stable session metadata, while preserving ambiguity when multiple fresh routes remain compatible.
- Extend delegated-route regression coverage to run with both named and unknown sessions.

# Changelog

## Unreleased

- Extend persisted MSSR recovery to generic eligible tools and metric attribution after a Bridge restart; `resolveMetricContext` now uses the same exact-session/project then unique-caller fallback as trace-aware tools.
- Added a live-equivalent regression for `route â†’ coordinator reset â†’ generic search_files from a rotated session/project`, requiring the original trace in metrics and no `mssr-unrouted-tool-call`.
- Preserve MSSR continuity when the OpenAI connector rotates its anonymized session id or the same task moves across related repositories: exact session/project matches still win, otherwise Bridge adopts only the single open trace for that caller and refuses to use a skill name to disambiguate concurrent tasks.
- Added regressions for rotated-session metric attribution, persisted `stage=close` recovery with a different session id, and two-open-trace ambiguity.
- Recover a unique open MSSR trace from persisted SQLite state when a stateless or restarted Web call loses the in-memory coordinator, scoped by anonymized session or project/caller and selected skill; ambiguous candidates remain unpropagated.
- Preserve nested `traceId` and agent profile metadata emitted by tools delegated through `bridge_tool_query` / `bridge_tool_action`, allowing later dedicated calls to resume the same trace.
- Make `mssr-web-outcome-missing-after-idle` execution-aware: routing, context loading, catalog/audit queries and `skill_load` no longer start the closure timer, while substantive traced work and non-outcome checkpoints still do.
- Added regressions for `dispatch route(close) â†’ coordinator-memory loss â†’ dedicated skill_load/checkpoint` and for route/load-only reminder suppression.
- Added privacy-safe `task_key` attribution and explicit primary/related project roles to general Bridge metrics, so concurrent ChatGPT Web tasks no longer collapse into session-only rows or let auxiliary repositories replace the primary project.
- Updated the dashboard to group one row per observable task/session/primary project and aggregate auxiliary repositories, with concurrent Web regression coverage.
- Clarified `skill_load` as guide delivery rather than proof of application, exposed each recent operation subject in the compact dashboard, and documented bounded MSSR resume after Codex context compaction.
- Block successful MSSR outcomes while routed required skills remain unloaded, preserving the trace for one bounded recovery and preventing the Web load-after-close / duplicate-outcome loop.
- Store an allow-listed privacy-safe operation subject for recent metrics, so `skill_load` rows identify the loaded skill and context/routing/checkpoint rows expose their bounded target without retaining prompts.
- Added `trace-contract-v1` propagation across direct tools and generic dispatch wrappers. Bridge keeps local session continuity and a bounded process-shared lease for stateless calls, selects only a unique compatible trace, and emits `mssr-trace-ambiguous` instead of mixing concurrent agents or tasks.
- Added logical MSSR observability epochs: the dashboard and `scope=active` begin from a clean persisted baseline, while `scope=all` preserves legacy telemetry for comparison.
- Added an end-to-end in-memory MCP regression proving route â†’ required loads â†’ replan â†’ verification â†’ persistence â†’ outcome continuity, plus negative notice cases.
- Expanded the MSSR dashboard with routeâ†’load continuity, orphan loads, active epoch, and baseline visibility.
- Isolated the Bridge skill-routing integration suite in temporary telemetry storage so verification cannot pollute the production observability epoch.

## 0.6.14 - 2026-07-25

- Workflow-guide recommendation now checks the existing Codex skill catalog before proposing a new guide and returns `use_existing_skill` when a skill already owns the reusable procedure.
- Workspace snapshots publish their manifest atomically, read it back before reporting success and return actionable diagnostics for missing or legacy snapshot ids from older live Bridge versions.
- Added a canonical Bridge incident ledger and close-phase server instructions that preserve observable symptom/evidence/cause/correction/regression/follow-up without storing chain-of-thought.
- Added isolated regressions for skill-owned guide requests, verified snapshot readback, immediate stable diff and legacy-id lifecycle guidance.
- MSSR outcomes now attribute one latest effective result per trace to a single primary skill, retain supporting-skill contributions without duplicate success credit, and expose status, acceptance, normalized scores, evidence kind/reference, and per-skill aggregates.
- The local dashboard now separates structured routing, required-load compliance, outcome success, artifact acceptance, average score, and per-primary-skill results.
- `roblox_photo_capture_job` can carry the MSSR trace and records a preliminary Photo Rig technical outcome from the authoritative capture manifest; final visual review may replace it on the same trace.


## 0.6.13 - 2026-07-25

- Unified `skill_recommend` with the deterministic MSSR phase router. It now accepts structured intent, bounded context, caller/stage/completed phases and returns the same active/deferred route plus a stable `traceId`; missing intent remains visibly lexical fallback.
- Added privacy-preserving MSSR activation telemetry in the existing SQLite metrics store and `logs/mssr-events.jsonl`, without raw prompts, transcripts or chain-of-thought.
- Added read-only `mssr_observatory_query` for status, benchmark, recent events and correlated traces, plus neutral `mssr_trace_record` for bounded context/phase/verification/persistence/outcome/friction/replan checkpoints.
- Made `skill_load` and `skill_bootstrap` trace-aware and record both successful and failed loads, required status, source and phase.
- Added integration coverage for structured recommendation, trace propagation, correlated load/checkpoint lookup, privacy invariants and clean SQLite shutdown.
- Expanded the generated registry to 122 tools.
- Fixed fallback dispatch for neutral tools: `bridge_tool_action` now accepts explicitly confirmed neutral or destructive targets, so newly added telemetry/checkpoint tools remain usable before the connector refreshes their dedicated schemas.

## 0.6.12 - 2026-07-25

- Added `whiteboard_add_text`, `whiteboard_add_svg`, `whiteboard_add_diagram`, and `whiteboard_insert_image` for writing into ChatGPT's separate TabletWhiteboard layer.
- Structured diagrams support rectangles, ellipses, lines, arrows, polylines, polygons, labels, and quadratic/cubic BÃ©zier SVG paths.
- Existing local PNG, JPEG, and WebP files can be inserted after Bridge path-policy, size, MIME, and signature validation.
- SVG writes are sanitized by TabletWhiteboard and reject scripts, event handlers, links, embedded resources, CSS, and unsafe SVG elements.
- Expanded the whiteboard regression suite to verify seven tools, request payloads, BÃ©zier preservation, image bytes, MIME, placement, and SHA-256.
## 0.6.11 - 2026-07-24

- Added read-only `skill_route_vocabulary`, exposing the canonical closed MSSR enums before routing metadata or fixtures are authored.
- Fixed `git_commit_all` to stage large path sets through NUL-delimited stdin pathspecs instead of expanding every filename into the Windows argument vector.
- Fixed `git_show_commit` and `git_compare_branches` to avoid safe-path expansion, while retaining bounded sensitive-path exclusions and an explicit degraded-filter flag when exclusions themselves exceed the safe argument budget.
- Added a real 320-file long-path Git regression covering commit, show and branch comparison.
- Filtered synthetic `__test_*` and legacy `metrics_regression` events from operational metrics summaries, recent calls, timelines, errors and slowest-call views.
- Fixed Bridge skill frontmatter extraction so ordinary `name:` and `description:` fields use whitespace matching instead of requiring a literal backslash; the registry now preserves descriptions and regression-tests parser parity.
- Made successful Bridge routing tests compact by default and reduced duplicate live-provider work to 10 adapter integration cases; MSSR remains the owner of the full 83-case semantic suite, while `--full-integration` preserves exhaustive Bridge replay when explicitly needed.
- Expanded the generated registry to 116 tools.


## 0.6.10 - 2026-07-24

- Integrated verified TabletWhiteboard capture integrity, origin/board validation and LAN allowlisting.
- Added Roblox visual-capture diagnostics, notices, deterministic Photo Rig support and 115-tool generated documentation.
- Made release consistency derive from package metadata instead of hard-coded regression versions, while keeping live-version verification as a post-restart gate.
- Closed the skill-routing test MCP client explicitly so successful fixtures terminate without leaking an open process handle.

## 0.6.9 - 2026-07-23

- Extracted the MSSR engine, routing contract, fixtures, audit and canonical documentation to the independent `C:\Dev\mssr` repository.
- Bridge now consumes `@mauroprime/mssr` and remains the ChatGPT/local/Roblox integration adapter.
- Added compatibility entrypoints so Bridge routing tools and verification continue to use the canonical MSSR contract.
- Added read-only `image_file_attach` for direct full-quality PNG/JPEG/WebP inspection through MCP image content, with batch support, dimensions, SHA-256 verification and original-byte preservation.
- Updated visual-review workflows to avoid manual Base64, binary chunk reads, temporary HTTP servers, tunnels and tiny recompressed previews when local image attachment is available.

## 0.6.8 - 2026-07-23

- Added mandatory semantic `signals` to MSSR intent classification, with backward-compatible `nominal` normalization and no automatic conversion of generic fallback ambiguity into an incident.
- Added deterministic verification and maintenance phase inference for errors, degradation, uncertainty, recovery needs, repeated friction, workarounds, skill gaps, and reusable patterns.
- Added routing and regression fixtures for Roblox MCP incidents, nominal Roblox work, contextual continuations, and maintenance closure.
- Added the routed `roblox-mcp-incident-recovery` procedure from the versioned MauroPrime skills repository.
- Hardened Roblox Studio MCP discovery with explicit `healthy`, `degraded`, and `unavailable` source state, bounded retry, discovery-only cache, and nonzero live-catalog verification.
- Hardened multi-client StudioMCP lifecycle and ownership diagnostics while preserving valid direct and Bridge-managed routes.
