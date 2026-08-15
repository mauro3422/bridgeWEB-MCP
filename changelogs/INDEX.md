# Bridge changelog index

Versioned release notes are the canonical change-history surface for MSSR debugging, maintenance, and persistence checks.

## Current releases

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
