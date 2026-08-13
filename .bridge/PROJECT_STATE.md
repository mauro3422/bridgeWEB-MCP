# Bridge project state

## Current release
Bridge `0.6.90` is closed in the working tree and pending publication/restart. It packages MSSR core `0.2.12` and delivers the durable project context plane: `skill_route_plan` and `skill_bootstrap` select messages from `.bridge/mssr-context-inbox.json`, redeliver pending messages until `mssr_context_ack` records an explicit receipt, then suppress identical acknowledged evidence on the Bridge delivery surface (`filterAcknowledgedContextMessages` in `src/mssr-context-plane.ts`). Reappearance requires changed revision or content. Runtime version `0.6.90` readback, tunnel health, and catalog count are pending until a controlled restart.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
