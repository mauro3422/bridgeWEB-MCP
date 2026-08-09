## 0.6.74 - 2026-08-08

- Added a token-authenticated, 64 KiB-bounded `/api/mssr/events` receiver for
  privacy-safe `mssr-telemetry-v1` events from external host adapters. Events
  are schema-validated, lifecycle-validated, idempotent, and projected with the
  canonical `opencode-local` caller; raw task text and transcripts are rejected
  by contract.
- Fixed the dashboard Errors tab dropping every letter `s`: the whitespace
  regular expression is now correctly escaped through the TypeScript template
  literal, with a regression against the served HTML.
- Added an isolated HTTP regression proving authentication, deduplication,
  honest no-outcome state before an explicit checkpoint, OpenCode surface
  projection, and the dashboard escaping fix.

## 0.6.73 - 2026-08-08

- Delegated portable trace lifecycle decisions and selective skill-context
  materialization to `@mauroprime/mssr`, while retaining Bridge-owned sessions,
  recovery, leases, telemetry, notices, persistence and transport.
- Classified last-known Roblox metadata used by nonblocking discovery as
  `cached` instead of a live-provider degradation. Structured non-Roblox routes
  no longer inspect the optional Roblox source or repeat warnings merely because
  Studio is closed; Roblox routes still require live health before execution.

## 0.6.72 - 2026-08-08

- Completed stale-schema `projectRoot` carryover across separate MCP server instances by scoping the loaded root to the observable host session plus `workflowKey`, while retaining the local anonymous-session fallback.
- Extended the delegated-route regression so `project_context_load` and the following `skill_bootstrap` execute through different server instances and still resolve the exact loaded project.


## 0.6.71 - 2026-08-08

- Made project-context carryover resilient to stale ChatGPT connector schemas: after a unique `project_context_load`, direct or delegated MSSR route/bootstrap calls inherit that exact root when the caller cannot send `projectRoot`; ambiguous multi-root and post-restart cases still fail closed and require explicit scope.
- Updated project-context guidance to describe the carryover contract instead of requiring an argument a stale host schema may not expose.


## 0.6.70 - 2026-08-08

- Enforced persistent analysis-cache TTL/size bounds on the first cache write of each Bridge runtime, then retained the existing periodic prune cadence, preventing restarts from leaving multi-gigabyte stale cache indefinitely.
- Added regression coverage proving a stale cache entry is removed by the first persistent cache write.

## 0.6.69 - 2026-08-07

- Added modular project-context loading through optional `.bridge/project-context.json`: minimal core at project bootstrap, then stage/intent-selected `context`, `memory`, `state`, and scoped `directive` modules with legacy full-document fallback.
- Extended `project_context_load` and `skill_bootstrap` so a routed phase can carry the same `projectRoot` and re-select project modules alongside skill context at meaningful lifecycle boundaries.
- Added protected `project_context_update`: stable-section upsert into context/memory/state, optimistic `expectedSha256` concurrency, verified writes, rollback across the Markdown+manifest pair, and optional MSSR module/directive registration.
- Moved MSSR intent normalization out of Bridge into `@mauroprime/mssr` and reused portable semantic/context-update primitives for project knowledge, keeping Bridge as the host adapter/materializer/writer.
- Added regression coverage for modular project context, transactional project-memory updates, and generated tool contracts/documentation for the new schemas.

## 0.6.67 - 2026-08-07

- Made `work_show` accept explicit `traceId` control metadata like the rest of the process aliases, preventing unrouted MSSR telemetry during concurrent ChatGPT Web workflows.
- Added regression coverage requiring trace-aware schemas across the complete process lifecycle alias set.

## 0.6.66 - 2026-08-06

- Added `git_multi_repo_publish`, a manifest-driven preflight/apply workflow with exhaustive path classification, per-repository validation, exact HEAD confirmation, verified local-only commits, no force push and HEAD/tracking/direct-remote readback.
- Made image batches and manifests one rollback-capable transaction, added strict base64/data-URL/MIME/signature validation, authorized-file smoke coverage and explicit image/integrity/source error categories.
- Added MSSR `progress` heartbeats with bounded Web trace leases plus bounded multidimensional outcome details while retaining one primary skill and overall status.
- Improved `apply_patch`, `edit_lines` and terminal alias failures with hashes, valid ranges, nearby context, active-session guidance and safe next actions without fuzzy mutation.
- Expanded Bridge error taxonomy and audit interpretation, detailed connector fallback guidance, and separated required context overflow from optional context omission.
- Added focused regressions for multi-repository publication, image persistence/rollback, edit recovery, terminal preflight, connector diagnostics, error taxonomy and MSSR schema/lifecycle behavior.


## 0.6.65 - 2026-08-06

- Fixed stateless MSSR continuity when one ChatGPT session has several open traces across repositories: an exact session/project match still wins, otherwise a single recently planned route may dominate stale same-session candidates while genuinely concurrent fresh traces remain ambiguous.
- Added a regression for the observed cross-project failure and retained explicit `traceId` support on process tools and delegated wrappers.
- Re-verified the connector boundary against the live 139-tool runtime: the current host catalog exposes 127 tools directly and safely reaches omitted tools through `bridge_tool_query` or `bridge_tool_action`; Bridge continues to report, rather than misrepresent, host-owned catalog staleness.


## 0.6.64 - 2026-08-05

- Added exact Blender session coordination across the addon and tools: live status now reports the connected `.blend`, PID, port ownership, dirty/save state, disk modification time, active object/mode, last load/save, and last Bridge versus human-or-external scene activity.
- Added four explicit operation modes: `reference-only`, `inspect`, `scene-write`, and `foreground-capture`. Live scene tools now require `expectedBlendFile`; path drift, port ownership conflicts, and recent human activity block focus or mutation by default.
- `blender_open` no longer treats any connected Blender as the requested target: it refuses to redirect a port already owned by another `.blend`.
- `image_reference_pack_prepare` now persists an atomic coordination manifest for disk-only reference generation, including `userModeling`, intended `targetBlendFile`, deferred installation, and the live Blender tools forbidden while Mauro models.
- Added `blender-session-coordination`, routing fixtures, skill dependencies, and regressions for exact-target, concurrent-human-work, and reference-only behavior.


## 0.6.63 - 2026-08-05

- Replaced `blender_viewport_screenshot`'s freshness-unsafe `bpy.ops.screen.screenshot_area` path with an exact foreground-window client-region capture pinned to the connected Blender PID and live viewport bounds.
- The tool now returns observed viewport orientation plus capture backend/focus evidence, exposes a bounded settle delay, and still requires pixel review for semantic correctness.
- Added a regression that rejects the legacy framebuffer path and verifies PID pinning, viewport-coordinate forwarding, foreground validation, bounded resizing, and exact-window capture.


## 0.6.62 - 2026-08-04

- Added the generic Blender reference-pack chain: `image_reference_pack_prepare` → `blender_validate_reference_pack` → `blender_install_reference_pack`.
- Separated perspective design masters from orthographic geometric masters and added canonical cardinal/design roles, semantic QA, optional landmarks, byte/hash validation and opposite-pair warnings.
- Installed construction Image Empties axis-aligned at the origin with paired side visibility, orthographic-only display, depth behind geometry, locked selection and no render; design views live separately and are hidden by default.
- Reimplemented `blender_setup_character_references` as a compatibility adapter over the generic installer and added a real Blender integration regression.
- Expanded the runtime catalog from 135 to 138 tools.


## 0.6.61 - 2026-08-04

- Added `blender_focus_review`, a three-shot "look where I point" workflow that captures the current viewport, a medium context view, and a close zoom from selected edit components, selected objects, the active object, or the 3D cursor.
- Focus reviews persist PNG hashes and a JSON manifest, attach bounded previews to ChatGPT, and restore the original Blender viewport after capture.
- Added a versioned Blender 5.2 addon installer so the localhost bridge loads automatically for normal interactive Blender sessions while remaining inactive in background/batch runs.
- Updated the Blender sidebar instructions, integration docs, generated tool catalog, and regressions for the 135-tool registry.


## 0.6.60 - 2026-08-04

- Added `godot_mcp_action` for the 36 non-read-only tools in the live Godot provider catalog.
- `godot_mcp_tool_list` now returns all live Godot tools with `read-only` or `action` classification instead of hiding authoring operations.
- Godot action dispatch does not require a separate user confirmation for each operation; exact live tool names, schemas, upstream technical arguments, and automatic readback remain in force.
- Updated Bridge regressions and generated docs for the 134-tool registry.

## 0.6.59 - 2026-08-04

- Removed the Godot provider token file, HTTP auth header, and credential-loading path after the single-user localhost deployment proved the layer unnecessary.
- Godot tools now connect directly to `127.0.0.1:6506` while preserving the provider observe catalog and Bridge's independent read-only allowlist.
- Updated the Godot regression to prove credential-free localhost access, mutation blocking, verified PNG capture, and unchanged project identity reporting.
- Updated three vulnerable runtime dependencies; `npm audit --omit=dev` now reports zero findings.

## 0.6.58 - 2026-08-04

- Added an authenticated Godot provider family for ChatGPT Web: `godot_mcp_status`, `godot_mcp_tool_list`, `godot_mcp_instance_list`, `godot_mcp_query`, and `godot_screen_capture_save`.
- Godot dispatch now requires both the live provider catalog and an independent Bridge read-only allowlist; mutation tools such as `create_scene`, `edit_script`, `run_scene`, and `send_input` are denied even if a future provider exposes them.
- Godot captures preserve and verify the original PNG bytes, dimensions, size, and SHA-256 before attaching them to the tool result.
- Provider health reports target project, stable project id, editor/runtime instance ids, authentication state, and observe/full mode without exposing the local token.
- Added `godot` to MSSR's canonical domain vocabulary with dedicated project-inspection, visual-review, and runtime-debugging skills and regression fixtures that keep Godot and Blender routes separate.

## 0.6.57 - 2026-08-03

- Persistent process continuation tools now accept optional `traceId` control metadata across write/read/stop and the `work_feed`/`work_peek`/`work_finish` aliases, preserving MSSR attribution through the complete terminal lifecycle without forwarding control metadata to the child process.
- MSSR context observability now separates required-context overflow, optional-context pressure, and optional skills skipped for budget; the dashboard retains the legacy aggregate while showing the actionable category and emitting distinct maintenance recommendations.
- Regression coverage now verifies trace-aware schemas across the whole process lifecycle and the new context-pressure classifications.

## 0.6.56 - 2026-08-03

- MSSR model identifiers are canonicalized before telemetry storage and profile grouping, collapsing case, spacing, and underscore variants such as `GPT-5.6 Thinking` into `gpt-5.6-thinking`.
- `run_command`, `work_once`, `terminal_start`, and `work_begin` accept optional `traceId` control metadata so cross-project or cross-process work can be correlated explicitly without passing that value to the shell.
- Web closure reminders now expose a read-only `mssr_trace_evidence` action and report missing required skill loads before an outcome is recorded.
- Trace-contract regressions cover explicit work correlation, model normalization, and assisted closure evidence.

## 0.6.55 - 2026-08-02

- `roblox_screen_capture_save` now validates the returned image MIME against its binary signature and requires the destination extension to match PNG, JPEG, or WebP before writing.
- Capture format regressions cover valid PNG/JPEG/WebP payloads, misleading extensions, mismatched declared MIME, and unsupported destinations.


## 0.6.54 - 2026-07-30

- Add `roblox_asset_upload` for bounded, hash-verified GLB/GLTF/FBX Model uploads through the official Roblox Open Cloud Assets API.
- Require explicit creator confirmation, read the API key only from a named environment variable, poll operations, read assets back, and optionally persist a secret-free provenance manifest.
- Classify uploads as destructive external side effects and keep local Studio import as a separate fallback rather than accepting cookies or raw secrets in tool arguments.

## 0.6.53 - 2026-07-30

- Return an exact `direct → bridge_tool_query/action` execution policy from MSSR routing, including a ready-to-run delegated `skill_bootstrap` fallback when the connector omits the dedicated schema.
- Skip redundant schema discovery when Bridge already supplied authoritative fallback arguments; retain `bridge_tool_schema` for validation recovery and unknown contracts.
- Add per-caller/model MSSR execution metrics for physical direct calls, delegated query/action calls, fallback rate, discovery detours, time to first domain action, tool span and idle-closure reminders.
- Add a dashboard table that exposes those connector-path metrics without treating delegated target attribution as a second physical execution or idle as proof of a stalled UI.

## 0.6.52 - 2026-07-30

- Add `bridge_connector_catalog_compare` to compare caller-observed dedicated schemas with the live runtime catalog without conflating wrapper reachability with direct exposure.
- Report exact runtime hash/count, recognized and unrecognized observed names, total and MSSR-focused direct coverage, and the correct query/action fallback split while preserving the host observation boundary.
- Expand tool and HTTP regressions to 127 registered tools and cover the observed ChatGPT Web baseline of 3/11 direct MSSR schemas.

## 0.6.51 - 2026-07-30

- Serve MCP protocol revision `2026-07-28` beside the existing sessionful 2025-era route from the same `/mcp` endpoint.
- Use the SDK's authoritative `isLegacyRequest` classifier, a strict modern `createMcpHandler` leg, and the unchanged v1 `StreamableHTTPServerTransport` leg instead of replacing ChatGPT Web's validated session lifecycle.
- Share one Bridge tool registry, execution pipeline, MSSR handling, notices, and tool metrics across both eras while keeping v1 and v2 SDK objects isolated.
- Expose per-era request/error counters in `/status` and add a regression covering modern discovery, modern tool listing, header/body disagreement, and legacy session initialization.

## 0.6.50 - 2026-07-30

- Accept bounded non-canonical MSSR intent vocabulary at the MCP transport edge, normalize only explicit safe aliases and exact cross-field values, and return a same-trace correction action instead of failing opaque schema validation or guessing unknown values.
- Add privacy-preserving intent normalization/correction telemetry and recovery-rate observability by caller.
- Add regression coverage for canonical, normalized, relocated, ambiguous, empty-after-normalization, same-trace recovery, and telemetry-redaction paths.
- Update the maintained v1 MCP TypeScript SDK line from 1.29 to 1.30. Protocol revision `2026-07-28` remains an explicit, separate dual-era migration because the current production HTTP route is sessionful.

## 0.6.49 - 2026-07-29

- Isolate the primary project of a newly started MSSR route from any unrelated trace that remains open in the same Bridge process.
- Prefer freshly loaded project context when projecting route metrics, while preserving the prior trace project for continuation calls.
- Add a regression that keeps one trace open, loads a different project, starts an independent route, and proves the new route is attributed to the fresh project.


## 0.6.48 - 2026-07-28

- Make MSSR Roblox skill discovery reuse the last-known catalog without waiting for the exclusive Studio operation queue, so long Roblox actions no longer freeze unrelated routing.
- Preserve live catalog refresh for explicit Roblox status, tool listing, and dispatch paths.


## 0.6.47 - 2026-07-28

- Add `systemAwareness` to `skill_route_plan` and `skill_bootstrap` for Roblox-routed work, reporting Bridge reachability/version, live Roblox MCP catalog health, connected Studios, active target, and Edit/Play mode.
- Classify `single-studio-inactive` separately from disconnection and expose a no-restart recovery action through `get_studio_state`.
- Cache the snapshot for five seconds so route planning and immediate bootstrap do not duplicate Studio probes, and treat the first ten seconds without a registered Studio as quiet `studio-warming-up` instead of a false disconnection warning.
- Emit in-band, deduplicated notices only when the Roblox target or provider requires attention, plus one recovery notice when a prior unhealthy state becomes active again.
- Add a focused regression matrix for route relevance, mode parsing, and target-state classification.


## 0.6.46 - 2026-07-28

- Accept a legacy nested `arguments.traceId` control in `bridge_tool_query` and `bridge_tool_action` when a stale static connector catalog cannot expose the canonical wrapper-level field.
- Use the nested value only for MSSR trace attribution and remove it before invoking targets that do not declare `traceId`, preserving strict target schemas.
- Add concurrent named-session and anonymous-session regressions proving that both canonical and legacy wrapper trace controls disambiguate the intended trace without contaminating `search_files` arguments.
- Preserve the canonical top-level `traceId` contract for refreshed connectors; this release is a backward-compatible transport bridge, not a schema replacement.


## 0.6.45 - 2026-07-28

- Preserve `tool_calls.ok` as MCP handler/transport success while recording nullable `result_ok`, `result_code`, and `result_status` for `run_command` and `work_once` child-process outcomes.
- Project delegated process results through `bridge_tool_query` / `bridge_tool_action`, classify non-zero exits separately, and use the semantic result in Tool Portfolio evidence when available.
- Show `handler error`, `handler ok`, `command ok`, `command failed`, or `command timeout` explicitly in recent dashboard activity instead of presenting every completed handler as a successful command.
- Keep historical rows intact with unknown semantic result fields; no SQLite reset or retroactive relabeling is performed.


## 0.6.44 - 2026-07-28

- Isolate invalid workflow-guide manifests during discovery so one oversized or malformed guide no longer blocks `project_context_load` or `workflow_guide_recommend`.
- Preserve strict guide validation without silent truncation: invalid guides are excluded with bounded `guideWarnings`, while explicit loads fail with the exact validation reason.
- Prevent an invalid project guide from silently falling back to a same-named global guide.
- Add regressions for 41 activation phrases, 25 phases, surviving context/recommendation and explicit invalid-guide load rejection.

## 0.6.43 - 2026-07-28

- Replace sequential per-skill budgeting with the `global-required-core-first` planner: reserve every required core, then required modules, then globally rank optional modules.
- Admit optional skills only as complete minimum packages and preserve explicit required-context overflow evidence.
- Avoid reinjecting module text already contained in loaded context and report `duplicateCharsAvoided` plus allocation tiers.
- Add MSSR context-assembly aggregates and dashboard views for loaded/full/saved characters, traces, fallbacks, skips, overflow, planner mode, and per-skill migration pressure.
- Add starvation, duplicate-section, handler aggregation, and observatory regressions.
- Migrate `conversation-history-review` after repeated full-file fallback evidence; retain evidence-driven migration and avoid inventing real exclusive groups without contradictory procedures.


## 0.6.42 - 2026-07-27

- Make `skill_bootstrap` assemble selective Codex skill context by default from `context-modules.json` manifests.
- Add `contentMode`, `includeReferences`, and `maxContextChars` controls while preserving exact full-file `skill_load` behavior and explicit `contentMode=full` rollback.
- Resolve exact Markdown sections and bounded reference files only inside the owning skill directory; reject traversal and ambiguous headings.
- Record privacy-safe context metrics per skill: core/module/full/loaded/saved characters, selected modules, ambiguous candidate groups, manifest status, fallback, skip reason, and budget overflow.
- Enforce the global budget for optional skill context by skipping a whole optional context that cannot fit; only required context may overflow with explicit evidence.
- Support `exclusiveGroup` alternatives: one unique winner loads, while a top-score tie returns candidates without injecting multiple contradictory procedures.
- Add real-skill, handler-level, core-only, full, fallback, optional-budget-skip, ambiguity, and traversal regressions.


## 0.6.41 - 2026-07-27

- Require an explicit `workflowKey` on every new MSSR route instead of inheriting a stale pending workflow from an earlier task in the same Web session.
- Make `taskKey` trace-scoped for existing executions and derive it from the new route's explicit task text, preventing later context changes from contaminating an active trace.
- Clear pending workflow/task context when a new project context omits those values and consume both pending keys after one route start.
- Add regression coverage for stale pending workflow/task rejection, explicit new-route identity and existing-trace immutability.

## 0.6.40 - 2026-07-27

- Make workflow attribution trace-scoped after a trace is resolved, preventing a later workflow in the same Web session from contaminating an existing scoped or `unscoped` trace.
- Carry `workflowKey` in the in-memory/persisted trace coordinator snapshot and preserve the original workflow across replans.
- Add regression coverage for two traces sharing one `sessionKey`, including unscoped isolation, scoped immutability and explicit workflow selection for a new route.
- Strengthen ChatGPT Web server instructions with bounded user-visible progress checkpoints and explicitly document that Bridge notices are in-band reminders: they cannot interrupt an opaque tool call or push directly to the user outside a later tool response.

## 0.6.39 - 2026-07-27

- Add a process-unique `runtimeBootId` UUID to HTTP status, metrics and MSSR events so restarts are distinguishable without treating a reusable PID as task identity.
- Add optional stable `workflowKey` control metadata to project context and MSSR route/bootstrap calls, allowing repeated cycles such as `mauroprime-system-loop` to group separate traces without claiming a ChatGPT conversation id.
- Add protected read-only `mssr_trace_evidence`, correlating route/load/checkpoint events, tool calls, workflow/task/session keys, runtime generations and explicit evidence refs for one trace.
- Keep trace closure explicit: idle periods remain reminders and never synthesize a successful outcome.
- Add dashboard runtime-boot visibility, additive SQLite columns and regression coverage for open/closed evidence, workflow propagation, privacy and runtime UUIDs.

## 0.6.38 - 2026-07-27

- Add optional wrapper-level `traceId` control to `bridge_tool_query` and `bridge_tool_action` for stateless or concurrent callers that cannot expose a stable session/task key.
- Preserve target schemas by forwarding the control trace only when the delegated runtime tool declares `traceId`; generic targets receive their original arguments unchanged.
- Add a regression with two concurrent open traces proving explicit dispatch attribution avoids ambiguous/unrouted notices and records the selected trace on the wrapper metric.


## 0.6.37 - 2026-07-27

- Defer required-skill boundary checks for `skill_bootstrap` until its returned phase loads have been attributed to the active trace.
- Prevent false `mssr-required-skill-not-loaded` notices when a verify/persist/close bootstrap itself loads a newly required skill.
- Extend the delegated MSSR regression through a verification-stage bootstrap for both named and anonymous sessions.


## 0.6.36 - 2026-07-27

- Attribute delegated fallback executions to both the fallback wrapper and the actual runtime target in Tool Portfolio evidence.
- Preserve fallback-overuse visibility while preventing delegated tools such as `bridge_tool_audit`, `skill_bootstrap`, or `mssr_observatory_query` from appearing unused.
- Add regression coverage proving one delegated call contributes evidence to both `bridge_tool_query` and its target without storing raw arguments.


## 0.6.35 - 2026-07-27

- Mark successful Codex skill loads explicitly with `loaded: true`, matching the existing Roblox skill-load contract.
- Ensure delegated `skill_bootstrap` results are attributed as loaded skills by the MSSR trace coordinator so required-load gates accept the automatic phase load.
- Replace the delegated-route regression's manual `skill_load` fallback with a full `bridge_tool_query -> skill_bootstrap -> outcome` assertion for named and anonymous sessions.

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

## 0.6.77 — 2026-08-08

- Tighten `git_restore_file` input schema so callers cannot request the invalid
  `staged=false` plus `worktree=false` combination that the handler already rejects.
- Add regression coverage for the schema guard while preserving the normal
  worktree restore default.

## 0.6.76 — 2026-08-08

- Correlate OpenCode host identity with MSSR lifecycle profiles only through an
  exact shared `traceId`; lifecycle-only traces stay unknown and mixed agent
  handoffs remain explicitly `multiple-observed`.
- Separate Bridge-executed, delegated, and OpenCode host-observed physical tool
  calls from route/load/checkpoint lifecycle events in dashboard totals.
- Persist the optional OpenCode parent-session relationship only as a salted
  hash and expose cardinality rather than identifiers in the dashboard.
- Add a descriptive reasoning-effort comparison to MSSR observability, assigning
  each trace to one canonical effort bucket, preserving physical-call cardinality,
  and reporting discovery detours as a true per-trace average rather than a rate.

## 0.6.75 — 2026-08-08

- Accept authenticated `mssr-host-call-v1` events from the OpenCode plugin and
  persist them as idempotent tool-call metrics rather than lifecycle claims.
- Add exact OpenCode agent, variant, anonymized message/call/project keys, real
  provider/model, duration, status, and optional MSSR trace attribution.
- Keep raw prompts, arguments, outputs, error text, transcripts, secrets, and
  private reasoning out of host-observed metrics; surface agent and variant in
  dashboard execution profiles.

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
