# Bridge changelog index

Versioned release notes are the canonical change-history surface for MSSR debugging, maintenance, and persistence checks.

## Current releases

- [0.6.115](0.6.115.md) - Adopt MSSR 0.2.54, expose review-only Context Plane proposals, and make post-pagination lifecycle closure explicit without inferred success.
- [0.6.114](0.6.114.md) - Bounded resumable MSSR context delivery with `skill_context_next`, opaque cursor validation, required/accepted preservation, and privacy-safe envelope observability.
- [0.6.113](0.6.113.md) - Adopt MSSR 0.2.50 and add privacy-safe repeated tool-friction clustering/prioritization to `bridge_tool_audit`, preserving legacy metrics while surfacing recurring cross-workflow maintenance debt.
- [0.6.112](0.6.112.md) - Workspace snapshot retention: automatically keep two complete rollback points plus one truncated diagnostic generation per project root, prune historical excess before quota evaluation, and keep the 1 GiB cap as the final steady-state guard.
- [0.6.111](0.6.111.md) - Architecture Impact host adoption C: Bridge/ChatGPT Web uses packaged MSSR 0.2.47 for explicit-path pre/post observation, optional structural/import-graph evidence, host-local reviewed receipts, and bounded REVIEW/context-feedback notices without moving semantic ownership into Bridge.
- [0.6.110](0.6.110.md) - Adopt exact MSSR 0.2.45 release artifact, close packaged routing drift for `steam-workshop-publication`, and publish the accumulated Bridge host checkpoint without a Bridge-local routing exception.
- [0.6.109](0.6.109.md) - MSSR trace owner integrity: known project/workflow identity now outranks session continuity across local, RAM and SQLite recovery; same-owner rotation and supporting repositories remain supported without cross-project evidence contamination.
- [0.6.108](0.6.108.md) - Situation Model C2f-B host adoption on MSSR 0.2.34: exact declared architecture refs observed on demand with SHA-256/availability evidence and portable normalization, without baseline comparison, possible-impact classification, notices, watchers, queues, or a new MCP tool.
- [0.6.107](0.6.107.md) - Operational Notice Plane Gate E5: adopt MSSR 0.2.32 and prove final migration invariants across MSSR, Bridge-native, external-MCP and direct-host delivery without adding a queue or MCP tool.
- [0.6.106](0.6.106.md) - Operational Notice Plane Gate E3 on MSSR 0.2.31: preserve genuine `MssrNotice v1` semantics through the existing Bridge delivery queue while host delivery metadata stays outside and foreign/native notices retain their own identity.
- [0.6.105](0.6.105.md) - Operational Notice Plane C2e on MSSR 0.2.26: Situation Model watcher over current project-knowledge revisions versus durable Context Plane delivery receipts, classified context/release/runtime attention, metadata-only cross-restart suppression, and C2d ready-only recovery actions.
- [0.6.104](0.6.104.md) - Operational Notice Plane C2d on MSSR 0.2.24: evidence-first governed recommendation plans over C2c, with ranked ready/deferred actions, dependencies, confidence, information gain, risk/cost/blast-radius metadata, and ready-only Bridge action rendering.
- [0.6.103](0.6.103.md) - Operational Notice Plane C2c on MSSR 0.2.23: portable consistency projection over bounded canonical/replica/historical claims plus automatic Bridge release/install parity observation and explicit resolution.
- [0.6.102](0.6.102.md) - Operational Notice Plane C2b on MSSR 0.2.22: portable routing compliance for route/trace/required-skill/required-phase anomalies with exact recovery recommendations and explicit resolution.
- [0.6.101](0.6.101.md) - Operational Notice Plane C2a on MSSR 0.2.21: infrastructure correlation, metadata-only runtime health, and provider/target transitions without treating transport symptoms as proof of failure.
- [0.6.100](0.6.100.md) - Operational Notice Plane second slice on packaged MSSR 0.2.20: lifecycle idle, project-maintenance debt and Context Plane freshness share portable semantic transitions with explicit resolution behavior.
- [0.6.99](0.6.99.md) - packaged MSSR 0.2.19 Operational Notice Plane plus live project-context/routing hardening and workflow-guide precision for modular architecture tasks.
- [0.6.98](0.6.98.md) - packaged MSSR 0.2.18, canonical-only `.mssr` project knowledge, recursive initialization, Project Context Health, reviewed knowledge capture, and health-aware maintenance notices.
- [0.6.97](0.6.97.md) - packaged MSSR 0.2.17, canonical `.mssr/` project-control home, legacy `.bridge/` migration fallback, and metadata-driven project-knowledge maintenance notices.
- [0.6.96](0.6.96.md) - fixed UAC cleanup profiles for Windows Update downloads and stale Microsoft EdgeCore versions, preserving live WebView2 runtimes.
- [0.6.95](0.6.95.md) - fixed elevated read-only Windows storage audit for VSS, Reserved Storage, pagefile, and recovery diagnostics.
- [0.6.94](0.6.94.md) - profile-scoped UAC cache maintenance, packaged MSSR 0.2.16 host integration, and advisory daily skill-health snapshots/dashboard.
- [0.6.93](0.6.93.md) - route uploaded audio/video through narrated-media review and canonical media ingest before ad-hoc ASR fallback.
- [0.6.92](0.6.92.md) - explicit multi-editor targeting for native Godot scene open/create; ambiguous mutations fail closed.
- [0.6.91](0.6.91.md) - native Godot scene open/create tools with persistence/editor readback and packaged MSSR 0.2.14 `godot-scene-authoring` routing; no UI click automation.
- [0.6.90](0.6.90.md) - durable MSSR Context Plane delivery with ack tombstone suppression on packaged MSSR core 0.2.12.
- [0.6.89](0.6.89.md) - Bridge delivery adapter for portable MSSR Context Messages v1.
- [0.6.88](0.6.88.md) - packaged MSSR first-party skill discovery, reserved precedence, and Bridge conformance coverage.
- [0.6.87](0.6.87.md) - substantive MSSR routing coverage and explicit optional-skill decision telemetry.
- [0.6.86](0.6.86.md) — project-memory authority audit, post-change consistency, selective changelog loading.

## Historical archive

- [LEGACY](LEGACY.md) — preserved monolithic changelog for releases before the versioned-per-file migration. Do not load this archive by default; inspect it only when a historical version or regression requires it.

## Contract

Every new `X.Y.Z.md` must declare:

- `Summary`
- `Areas`
- `PROJECT_CONTEXT`: `updated`, `reviewed-none`, or `pending`
- `PROJECT_MEMORY`: `updated`, `reviewed-none`, or `pending`
- `PROJECT_STATE`: `updated`, `reviewed-none`, or `pending`

`pending` blocks persistence. `reviewed-none` means the impact was explicitly checked and no durable project-knowledge update was required.
