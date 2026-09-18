# Bridge project memory

Optional durable project memories are reference-backed under `.mssr/knowledge/` and indexed by `.mssr/project-context.json`. This root intentionally stays compact and contains no subsystem-specific history. Repository-wide reconciliation and continuity handoffs are recorded in `PROJECT_STATE.md` plus bounded docs rather than duplicated here; MSSR selects the relevant modules by stage and structured intent.
