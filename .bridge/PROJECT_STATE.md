# Bridge project state

## Current release
Bridge source release `0.6.89` adapts portable MSSR Context Messages v1 in `skill_route_plan` and `skill_bootstrap`. MSSR remains the semantic owner: Bridge validates the portable batch, asks MSSR to select against normalized intent/stage and bounded budgets, returns the complete selection evidence, and piggybacks only selected messages through the existing per-response notice delivery. It preserves canonical owner, provenance, freshness, evidence, continuation receipts, dedupe, and advisory actions as data; it does not execute those actions or persist proposals. The source gates are passing, but `0.6.89` is not yet published, restarted, or proven live. The currently running Bridge remains the previously verified `0.6.88` runtime with 146 tools.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
