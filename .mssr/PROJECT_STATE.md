# Bridge project state

## Current release
Bridge `0.6.115` is source/dist and live current and adopts the exact vendored MSSR `0.2.54` package (615637 bytes; SHA-256 `2d91e9911430e058d19e6e51270362bcf0e02d13ee61c5bc2d1aad8c859479d7`). The final controlled full restart request `b2529cc3-c84d-4c94-8938-4eb5404f0e09` was acknowledged by watchdog PID `27356`; a later build/readiness transition produced bounded automatic recovery ack `e568c0e8-d8dc-4ed3-96a5-2fa0e36b0a62`. Final readback reports Bridge `0.6.115`, PID `8136`, boot `71184ced-6786-4879-a03b-018a10056f1d`, no pending request, tunnel `live/ready`, catalog hash `6a0b3e4cab22ee95`, 162 tools, and direct read-only `skill_context_next` plus `mssr_context_proposal_review`; the dashboard and tools portfolio respond successfully. Compact bootstrap now summarizes repetitive project/message decisions and defers workflow guides above 6,000 serialized characters to an exact lifecycle `postContextAction`, while required/accepted units retain cursor freshness, exact-once delivery and explicit non-automatic checkpoint/outcome. Real trace `mssr-codex-5c735e66-57ce-4dbc-8ba6-98b9a52b6f3a` reproduced the former 30,650-character metadata starvation, then completed after correction in two pages (31,427 and 8,108 characters), six required units exactly once and zero pending. `npm run verify:all` passes completely, including doctor, check/build, readiness-gated HTTP/dashboard smoke, dual-era MCP, full isolated regressions, 224 routing fixtures and generated 162-tool docs.

## Staged remote-node adapter

Source includes a Bridge-owned `remote-node` SSH adapter independent of Kairos runtime, with pinned host-key verification, local ignored node configuration, LAN rediscovery, bounded remote exec and verified SFTP upload. A prior configured-node SSH smoke passed without persisting node identity or connection metadata; no SSH configuration, identity, key, credential, `.env`, or authentication store was read or changed in the 0.6.115 release. The current source and live runtime expose 162 tools.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Bridge's Project Memory storage parity remains source-complete: six indexed optional memories live in selector-backed `.mssr/knowledge/<topic>/` refs, the root has no legacy fanout pressure, and no other repository was mass-rewritten. Packaged, installed and live runtime now use MSSR 0.2.54 continuation, lifecycle-gate and duplicate-avoidance semantics.
