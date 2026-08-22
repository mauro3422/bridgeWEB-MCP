# Bridge project state

## Current release
Bridge `0.6.117` is source/dist/live current on exact vendored MSSR `0.2.57` (620786 bytes; SHA-256 `c71289377739bb3e7285fb2e9bfe36e6227f42c6a1c1aa26380ecbc5424032ca`). It measures Context Messages, derives compact project/message sub-budgets from the outer envelope, compacts continuation metadata, uses page-local procedural budgets and bounds notice delivery. Full `npm run verify:all` passes with `failedRequired=0`, 162 tools and 224 effective routing fixtures. Final full restart ack `70b3ca79-c6f2-45c2-a18c-7a622b4b1a3c` adopted PID `37868`, boot `bbf6cf53-1166-4f7a-89b2-d3f8507728fe`; tunnel/readiness and dashboard HTTP 200 pass. The original trace `mssr-codex-5c735e66-57ce-4dbc-8ba6-98b9a52b6f3a` completes at a 32,000-character envelope in four pages (31,180 / 28,149 / 31,716 / 14,943), no blockers, `contextChain=complete`. Release commit `7ccfaea2fb75e0246d6e6f432d496c777b03f3c7` is published on `origin/main` with direct remote-ref equality. No public npm-registry publication is claimed.

## Staged remote-node adapter

Source includes a Bridge-owned `remote-node` SSH adapter independent of Kairos runtime, with pinned host-key verification, local ignored node configuration, LAN rediscovery, bounded remote exec and verified SFTP upload. A prior configured-node SSH smoke passed without persisting node identity or connection metadata; no SSH configuration, identity, key, credential, `.env`, or authentication store was read or changed in the 0.6.117 release. The source contract remains 162 tools.

## Current MSSR learning state

Learning digest collection is active in `observe-only` mode with `routingInfluence=false`. Strict digests are accumulating; historical priors remain observability only and must not affect routing/context decisions yet.

## Project knowledge migration
Bridge's Project Memory storage parity remains source-complete: six indexed optional memories live in selector-backed `.mssr/knowledge/<topic>/` refs, the root has no legacy fanout pressure, and no other repository was mass-rewritten. Packaged, installed and live runtime use MSSR 0.2.57 continuation, lifecycle-gate, duplicate-avoidance, bounded friction-module, measured-message and page-local budget semantics.
