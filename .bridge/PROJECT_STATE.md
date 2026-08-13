# Bridge project state

## Current release
Bridge release `0.6.88` is prepared with 146 registered runtime tools. It discovers the five packaged MSSR first-party skills directly through the portable manifest/root API, includes `mssr-first-party` in catalog health and schemas, and lets auto load select the packaged reserved skill ahead of divergent local/system/plugin catalogs while preserving that shadow as an explicit routing-audit error. Typecheck, build, the isolated package-discovery conformance regression, routing validation, MSSR learning-loop regression, and generated-tool documentation checks pass. Full regression rerun, persistence/publication readback, and live restart verification remain pending; no runtime restart or publication was performed.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
