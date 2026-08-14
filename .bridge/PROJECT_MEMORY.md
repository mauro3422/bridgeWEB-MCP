# Bridge project memory

## MSSR learning boundary

Historical learning is currently `observe-only`. Learning digests and empirical priors may be measured and reviewed, but `routingInfluence=false`: they do not change deterministic routing, scores, context selection, permissions, or required workflow obligations. Activation requires separate replay, calibration, shadow evaluation, and an explicit versioned feature flag.

## Change and memory consistency

Every substantive release should have one versioned `changelogs/X.Y.Z.md` summary and explicitly review PROJECT_CONTEXT, PROJECT_MEMORY, and PROJECT_STATE impact. `project_change_consistency` is a read-only persistence gate: it may report drift or block publish readiness, but it never writes project memory automatically. `reviewed-none` is a deliberate review result; `pending` means persistence is incomplete.

## Debug history strategy

When MSSR intent indicates debugging, recovery, history-recovery, repeated friction, conflicting evidence, or comparable non-nominal history needs, load only `changelogs/INDEX.md` and the current release note first. Load `changelogs/LEGACY.md` or another historical release only when the index/current evidence points to a specific older regression window.

## MSSR Context Plane ack tombstone semantics

`mssr_context_ack` records durable delivery receipts in `.bridge/mssr-context-inbox.json`. Ack suppresses identical evidence during delivery: a message whose id, kind, and evidence identity (revision included) match an acknowledged receipt is not redelivered. Evidence reappears only when its revision or content changes. The canonical re-selection suppression is now consumed from packaged MSSR core, currently `0.2.14`; Bridge owns only host delivery/runtime integration and must never extend ack suppression beyond identical evidence. Separately, Godot scene lifecycle work now has a native no-click boundary: opening or creating scenes must use provider/editor operations (`open_in_godot`, `create_scene`, `read_scene`, `scene_tree_dump`) through dedicated Bridge tools, reuse the connected intended editor, and treat persistence, editor state, visual review, and runtime behavior as separate evidence layers.
