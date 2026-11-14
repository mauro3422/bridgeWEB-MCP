# Bridge cross-repository write preflight

## Ownership boundary

MSSR 0.2.147 evaluates declared ownership but remains advisory (`authorizationGranted=false`). Bridge owns filesystem access and the write decision.

## Current host transaction

Generic `bridge_tool_action` blocks declared cross-repository writes; reviewed transfers must use `bridge_cross_repo_transaction`.

`stage` requires explicit copy review, one source and target ref, distinct projects, a matching `expectedOwnerProject`/`ownerClaim`, an active target trace plus a separate persisted source trace, matching observed root names, exact `confirmTransactionId`, and an absent destination. MSSR must return `host-preflight-required`; same-hash duplicates abstain and conflicting destination bytes block.

Bridge journals the transaction, stages source-owned bytes, verifies SHA-256 readback, and creates the destination without overwriting. Transaction identity binds roots, refs, owner, traces, and source hash. Exact replay is idempotent. After the target owner updates the consumer pointer, `commit` validates it and writes a receipt. `recover` resumes or rolls back; rollback removes only a destination created by that transaction. Keep source and target traces separate.

## Coverage limit

This is a one-file, route-scoped host transaction, not global filesystem/terminal enforcement or distributed ACID. Updating the consumer pointer remains the target owner's action. Test evidence and limits are recorded in `docs/INCIDENTS.md`.
