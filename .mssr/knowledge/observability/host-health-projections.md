# Bridge host health projections

## Host health ownership boundary

Bridge owns host-side Skill Health and Project Context Health projections: bounded metadata snapshots under ignored `data/`, dashboard exposure, trend fingerprints, and Bridge-native notice delivery. Portable MSSR owns health classification, project discovery, modularization/maintenance semantics, and Operational Notice transitions. Health/scheduler paths never silently edit AGENTS, `.mssr/PROJECT_*`, skills, routing, or project meaning.

## Quiet attention and recoverable notice history

Stable WATCH/REVIEW evidence is deduplicated; meaningful change/resolution may emit through `bridgeNotices`. From Bridge 0.6.130, ordinary `project_context_load` presents one full advisory WATCH fingerprint and suppresses unchanged repeated findings until that fingerprint changes or severity escalates; explicit `project_context_health` always returns the complete current health state. `bridge_notice_status` exposes compact pending/history counts, normal responses deliver bounded pending notices once, and `bridge_notice_history` explicitly recovers recent delivered/pending evidence. A bounded 24-hour queue/history snapshot is persisted under ignored `data/` with debounced atomic writes so restart does not erase missed notices and request-path I/O remains asynchronous.

## Current-canonical Project Situation boundary

Project Situation may retain delivery receipts longer than a source remains part of the repository provider's current canonical candidate set. Retention is audit history, not proof that the source is still current context. Before Bridge evaluates the watcher projection, it therefore keeps only receipt evidence whose exact `canonicalOwner + ref` identity is also present in current authoritative project observations. The durable inbox is not rewritten, acknowledged, expired, or deleted by this projection. Current authorities such as PROJECT_MEMORY/PROJECT_STATE remain comparable against historical delivered revisions and may still produce REVIEW; obsolete version-changelog receipts do not create a synthetic `canonical-baseline-missing` merely because their TTL remains live.

## Document Freshness host adoption

From Bridge 0.6.135, Project Context Health also evaluates the opt-in portable MSSR Document Freshness registry at `.mssr/document-freshness.json`. Bridge supplies only exact-path availability plus Git/worktree revision-order evidence; portable MSSR remains the evaluator. A later impact ref can raise REVIEW and an indeterminate ordering can raise WATCH, but neither signal proves a semantic contradiction or authorizes a document rewrite. Historical documents remain outside the registry unless a repository explicitly opts them in. The result reuses the existing Project Health snapshot/notice path rather than creating another watcher, queue, or authority.

## Explicit semantic claims in Project Situation

From Bridge 0.6.135, the existing release-consistency observer also projects its bounded package/source/generated/installed/runtime facts through MSSR C2e-D semantic claims. `project-situation` composes those typed observations with receipt-derived Context Plane observations when present, but a semantic claim does not require an active context receipt in order to be checked. Bridge currently auto-produces these semantic claims only for its own release/install/runtime contract; arbitrary project prose is never parsed into claims. C2c/C2d remain the consistency/recommendation owners and `bridgeNotices` remains the sole delivery transport.

## Explicit safe Project Context maintenance

`project_context_maintain` exposes MSSR's explicit safe maintenance action. It may relocate only exact already-indexed non-core sections into `.mssr/knowledge/`, preserving identity, selectors, and bytes. Notices may recommend it but do not execute it. Core narrowing, whole-file semantic splits, overlapping consumers, and pressured declared segments remain `review-required`.
