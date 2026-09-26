# Human Cockpit projection boundary

Bridge exposes **Dónde estoy** as a read-only projection over MSSR lifecycle, Project Context Health, bounded runtime evidence and Git. MSSR owns lifecycle/context truth; Bridge owns observation/UI; Git owns repository state. Cockpit never completes phases or turns WATCH/REVIEW into writes.

Analytics stays off the HTTP/MCP event loop through one isolated read-only worker plus a bounded last-good seed. Weekly reconstruction uses seven-day `scope=all` history and bounded Git joins; no remote fetch or global `D:\Dev` scan occurs. Synthetic/recovery support traces stay observable without inflating human backlog.

Trace cards prefer bounded MSSR summaries; technical/setup siblings remain `intermediate`. **Al volver** surfaces local-day work, open tasks and `needsClosureReview` only from observable lifecycle evidence. MSSR 0.2.77 owns explicit `taskKey`; parent/supersedes refs are correlation only. Cockpit prefers explicit identity and labels project+workflow+trace as legacy fallback while preserving provenance. Resume packets exclude prompts/transcripts/secrets/private reasoning.

**Qué puede hacer el sistema hoy** derives capability families from runtime tools, Skill Health and workflow guides; provider-backed availability requires an on-demand probe.

**En qué está cada proyecto** classifies only the observed seven-day workspace map. Active/paused/experimental/review-needed are conservative projections with visible basis; finished and abandoned-or-replaced require explicit owner evidence and are never inferred from silence, age, Git cleanliness or closed traces. The map supplies ownership evidence for later dirty-tree partitioning but performs no Git mutation.

Project-document candidates remain advisory. Implementation: `src/dashboard-cockpit.ts`; full contract: `docs/HUMAN_COCKPIT.md`; roadmap: `docs/CONTEXT_LAYER_ROADMAP.md`.
