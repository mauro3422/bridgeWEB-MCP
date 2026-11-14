# Bridge project state

## Current local release and recovery (2026-11-14)
**Source:** Bridge 0.6.191 is published at `origin/main` commit `7ae5b4bacac31fc99f18aa83d96bcc7645174adb`. The 0.6.191 UI adds the collapsed finding and reference detail.
**Runtime:** Bridge 0.6.191 PID `44872`, boot `0331f48e-83c2-4afe-9dd4-f0c886f160a1`, acknowledged at 14:20Z. It was ready with 0 stalls, 14 ms maximum lag and 0 HTTP client errors. HTTP readiness on 3001 and tunnel readiness on 8081 passed. Watchdog PID `19504` remains HTTP-only; tunnel PID `19000` was preserved.
**Adoption issue:** `/api/mssr/project-health` still returns the 2026-11-13 snapshot with 53 projects but no `referenceCandidates` arrays. The restored dashboard snapshot is stale. The scheduler skipped recapture because the snapshot was less than 24 hours old, so the new disclosure had no candidate details to show.
**Candidate:** 0.6.192 refreshes a legacy snapshot once when any project row lacks `referenceCandidates`, through the existing scheduled capture and notice callback. Isolated migration/idempotency regression passes; publication and runtime adoption are pending. Then verify a current dashboard snapshot exposes 12 references with path, priority and reasons, WATCH remains silent, and REVIEW still notifies. Do not restart the tunnel.

## Other open work
- Resolve a safe Codex-local MSSR reload; investigate historical 0.6.188 stalls/client errors and per-probe tunnel readiness; profile an isolated SQLite snapshot; finish the authorized generic-MIME import/hash/no-overwrite check; refresh ChatGPT Web catalog; review 10 reference candidates (4 medium, 6 low). Historical `traceId=null` is reproduced; ambiguous writes remain blocked.

## Current MSSR learning state
Jev and semantic-experience proposals remain shadow evidence: they do not become training truth, change routing, or rewrite project authorities. Reliability evaluation still needs independent owner-labeled holdouts and separate retrieval, selection, exact-fetch, abstention and synthesis measurements.

## Project knowledge migration
Bridge project control is canonical under `.mssr/`. The September migration snapshot is preserved in `docs/archive/`; use current Project Context Health instead of archived module counts.
