# Context resume and inventory projection

Bridge's resume/orientation layer derives current context from observable owners rather than chat memory. **Al volver** separates previous-local-day work, current human work, and MSSR lifecycle debt. A substantive trace with `needsClosureReview` stays auditable/resumable but is not ordinary active product work; review decides whether to resume it or record an outcome. Nothing in the projection auto-closes lifecycle state.

MSSR 0.2.77 owns explicit `taskKey`; optional parent/supersedes refs correlate executions without closing them. Older history keeps labeled project+workflow/trace fallback. Active and debt items carry bounded resume packets only: owner/project, identity/provenance, latest summary/stage, required/completed phases, next gate, bounded evidence ref and latest activity. Raw prompts, transcripts, secrets and private reasoning are excluded.

Periodic inventory uses a bounded derived cache (`data/context-inventory-state.json`) refreshed on material lifecycle changes or the freshness fallback, with rolling daily snapshots and seven-day reconstruction; `scope=all` remains the recovery path. Capability inventory is derived from runtime tools, Skill Health and workflow guides instead of copied into AGENTS or assistant memory. Provider-backed availability requires an on-demand live probe.

**En qué está cada proyecto** is conservative: active/paused/experimental/review-needed may be projected from current evidence; finished and abandoned-or-replaced require explicit owner evidence. Git is supporting state, never proof of completion. Workspace classification and capability inventory are read-only orientation evidence, not new project authority.

Full UX/contract: `docs/HUMAN_COCKPIT.md`; priorities: `docs/CONTEXT_LAYER_ROADMAP.md`; workflow: `cross-project-context-inventory`.
