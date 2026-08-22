# Bridge project state

## Current release
Bridge `0.6.114` is source/dist and live current and adopts the exact vendored MSSR `0.2.53` package (608830 bytes; SHA-256 `1805ac508f7a1828247d63df38f61b0d2bbc8c583d5158acfa2cca28f20c8571`). The controlled HTTP-only restart request `82c852b5-62ca-479b-abb5-f36494fa0830` was acknowledged by watchdog PID `27356`; live readback reports Bridge `0.6.114`, PID `21792`, boot `638f8477-5596-4b8b-81ba-f8430393c5ed`, 161 tools and read-only `skill_context_next`, while Bridge and tunnel health remain `live/ready` and the dashboard responds successfully. Bounded resumable skill context includes exact response-envelope measurement, required/accepted preservation, cursor freshness, core/module duplicate avoidance, RAM-only continuation state and privacy-safe aggregate dashboard telemetry. Typecheck/build, generated docs, Project Health/consistency and the complete isolated Bridge regression suite pass.

## Staged remote-node adapter

Source includes a Bridge-owned `remote-node` SSH adapter independent of Kairos runtime, with pinned host-key verification, local ignored node configuration, LAN rediscovery, bounded remote exec and verified SFTP upload. A real configured-node SSH smoke passed without persisting node identity or connection metadata; this adapter and the new context continuation bring source and live runtime to 161 tools.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Bridge's Project Memory storage parity remains source-complete: six indexed optional memories live in selector-backed `.mssr/knowledge/<topic>/` refs, the root has no legacy fanout pressure, and no other repository was mass-rewritten. Packaged, installed and live runtime now use MSSR 0.2.53 continuation plus duplicate-avoidance semantics.
