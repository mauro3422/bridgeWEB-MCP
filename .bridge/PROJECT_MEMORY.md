# Bridge project memory

## MSSR learning boundary

Historical learning is currently `observe-only`. Learning digests and empirical priors may be measured and reviewed, but `routingInfluence=false`: they do not change deterministic routing, scores, context selection, permissions, or required workflow obligations. Activation requires separate replay, calibration, shadow evaluation, and an explicit versioned feature flag.

## Change and memory consistency

Every substantive release should have one versioned `changelogs/X.Y.Z.md` summary and explicitly review PROJECT_CONTEXT, PROJECT_MEMORY, and PROJECT_STATE impact. `project_change_consistency` is a read-only persistence gate: it may report drift or block publish readiness, but it never writes project memory automatically. `reviewed-none` is a deliberate review result; `pending` means persistence is incomplete.

## Debug history strategy

When MSSR intent indicates debugging, recovery, history-recovery, repeated friction, conflicting evidence, or comparable non-nominal history needs, load only `changelogs/INDEX.md` and the current release note first. Load `changelogs/LEGACY.md` or another historical release only when the index/current evidence points to a specific older regression window.

## MSSR Context Plane ack tombstone semantics

`mssr_context_ack` records durable delivery receipts in `.bridge/mssr-context-inbox.json`. Ack suppresses identical evidence during delivery: a message whose id, kind, and evidence identity (revision included) match an acknowledged receipt is not redelivered. Evidence reappears only when its revision or content changes. The canonical fix for re-selection suppression belongs in MSSR core (`enqueue`/`select`, shipped in packaged core 0.2.12); while the core lacks it, Bridge enforces the contract on its delivery surface because the host adapter owns inbox/piggyback delivery and local retention. Bridge must never extend ack suppression beyond identical evidence, and selection never counts as delivery.
