# Bridge project state

## Current release
Bridge release `0.6.87` is prepared with 146 registered runtime tools. It measures the substantive MSSR-call denominator separately from route/bootstrap hooks and diagnostics, exposes routed/unrouted chain coverage without storing raw arguments, and records optional-skill decisions only when the host supplied an explicit decision/reason. Typecheck, build, focused MSSR coverage/learning regressions, the full regression suite, routing validation, generated-tool documentation and the cross-repository source maintenance gate pass. Persistence/publication readback and live restart verification remain pending; no runtime restart or publication was performed.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Workspace audit over 14 managed Git repositories reports 7 modular authorities, 4 legacy authorities (`LLM-Rig`, `MauroAssetLibrary`, `MyceliumFront`, `TabletWhiteboard`), and 3 managed repositories without initialized project memory (`Kairos`, `mauroprime-skills`, `OmnySystem`). Legacy repositories are migration debt because PROJECT_* authorities already exist; not-initialized repositories are reviewed separately and must not receive synthetic memory automatically.
