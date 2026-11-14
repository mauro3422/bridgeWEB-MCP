# Bridge project state

## Current local release and recovery (2026-11-14)
**Source:** Bridge 0.6.192 is published at `origin/main` commit `fe2666f5963e805c863a01378ef2d036b34c0522`. It adds a one-time migration refresh for legacy Project Health snapshots missing `referenceCandidates`.
**Runtime:** HTTP-only restart acknowledged by watchdog PID `19504` (request `93e13e41-f439-44cc-bf26-4ee05685f2d0`). Bridge 0.6.192 PID `38780`, boot `822ea8d2-6181-4575-bf50-df9e0d9ce8fd`, is ready; 0 stalls, 38 ms maximum lag and 0 HTTP client errors. `/readyz` passed on 3001 and 8081. Tunnel PID `19000` remained unchanged.
**Adoption verified:** `/api/mssr/project-health` has snapshot `2026-11-14T14:33:42.196Z`, 54 projects and candidate arrays for all 54; the largest candidate list is capped at 12 with path, priority and reasons. A fresh `/api/dashboard/snapshot` carried that data, including 24 findings for `elemental-frontier` with codes, targets and recommendations. `/dashboard` returned 200 with the expandable Project Health detail renderer. Policy remains `watchesNotify=false`, `reviewsNotify=true`; operational-notice regression confirms WATCH silence and REVIEW delivery. Direct browser inspection was unavailable because CUA could not initialize its kernel assets; endpoint payload, served renderer, and UX tests passed.

## Other open work
- Resolve a safe Codex-local MSSR reload; investigate historical 0.6.188 stalls/client errors and per-probe tunnel readiness; profile an isolated SQLite snapshot; finish the authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 10 reference candidates (4 medium, 6 low). Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
