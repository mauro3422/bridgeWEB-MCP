# Bridge host health projections

## Host health ownership boundary

Bridge owns host-side Skill Health and Project Context Health projections: bounded metadata snapshots under ignored `data/`, dashboard exposure, trend fingerprints, and Bridge-native notice delivery. Portable MSSR owns health classification, project discovery, modularization/maintenance semantics, and Operational Notice transitions. Health/scheduler paths never silently edit AGENTS, `.mssr/PROJECT_*`, skills, routing, or project meaning.

## Quiet attention and recoverable notice history

Stable WATCH/REVIEW evidence is deduplicated; meaningful change/resolution may emit through `bridgeNotices`. From Bridge 0.6.130, ordinary `project_context_load` presents one full advisory WATCH fingerprint and suppresses unchanged repeated findings until that fingerprint changes or severity escalates; explicit `project_context_health` always returns the complete current health state. `bridge_notice_status` exposes compact pending/history counts, normal responses deliver bounded pending notices once, and `bridge_notice_history` explicitly recovers recent delivered/pending evidence. A bounded 24-hour queue/history snapshot is persisted under ignored `data/` with debounced atomic writes so restart does not erase missed notices and request-path I/O remains asynchronous.

## Explicit safe Project Context maintenance

`project_context_maintain` exposes MSSR's explicit safe maintenance action. It may relocate only exact already-indexed non-core sections into `.mssr/knowledge/`, preserving identity, selectors, and bytes. Notices may recommend it but do not execute it. Core narrowing, whole-file semantic splits, overlapping consumers, and pressured declared segments remain `review-required`.
