# Operational Notice Plane host boundary

Portable MSSR owns attention transitions plus C2b routing compliance, C2c consistency, C2d evidence-first recommendation planning, C2e Situation Model normalization/classification, and the strict `MssrNotice v1` semantic envelope. Bridge owns host observation, timers/watchdog/provider I/O, metadata-only persistence, queue/TTL/history and automatic delivery.

From Bridge 0.6.106 / MSSR 0.2.31, genuine MSSR notices are relayed through the existing `bridgeNotices` transport with the validated `mssrNotice` payload preserved as a separate semantic object. Bridge queue ids, timestamps, TTL, occurrence counters, UI/details projections and executable suggestions remain outside it. Bridge does not reconstruct or reinterpret the portable payload, create a second MSSR queue, or relabel foreign/native host notices as MSSR.

The C2e host adapter `src/project-situation.ts` watches only managed projects with operationally active Context Plane delivery receipts, compares their latest delivered PROJECT_CONTEXT/PROJECT_MEMORY/PROJECT_STATE/changelog/ADR revisions with current canonical repository revisions, persists metadata-only snapshots for cross-restart suppression, exposes `/api/mssr/project-situation`, and emits classified transitions through the existing `bridgeNotices` transport. Evidence class (`observed`/`declared`/`inferred`/`learned`) never overrides semantic ownership; free-form memory is not parsed into canonical truth.

C2d remains recommendation owner and Bridge may render only `ready` recommendations, never autoexecute them. Trace, outcome, Context Message, Situation observation, consistency diagnosis, recommendation plan and operational notice remain distinct.
