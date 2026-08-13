# Bridge project state

## Current release
Bridge `0.6.89` is published and live. It adapts portable MSSR Context Messages v1 in `skill_route_plan` and `skill_bootstrap`; MSSR remains the semantic owner while Bridge validates, delegates selection and piggybacks selected messages without executing actions or persistence proposals. Controlled full restart `50c28186-54b4-47fe-9f96-39232d7285be` was acknowledged on 2026-08-13. Live readback proved version `0.6.89`, tunnel `live/ready`, no pending restart, 146 tools, and Context Messages v1 schemas on both route/bootstrap tools.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
