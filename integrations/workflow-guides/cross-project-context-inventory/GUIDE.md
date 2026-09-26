# Cross-Project Context Inventory

## Purpose

Reconstruct and maintain MauroPrime's daily/weekly work context across projects by joining MSSR history, project context, Git state and live capability catalogs; recover unfinished/abandoned traces without auto-closing them; publish a bounded resume-oriented dashboard and defer dirty-tree cleanup until ownership is explainable.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **collect-evidence** — Collect bounded authoritative evidence from MSSR scope=all, Project Context/Health, Git and live catalogs without mutating project state.
2. **reconstruct-work** — Build daily/weekly project and task projections from observed evidence, preserving provenance and avoiding inferred completion.
3. **recover-unfinished** — Identify substantive traces or grouped tasks lacking observable closure, inspect evidence, and emit resumable next gates without auto-closing.
4. **inventory-capabilities** — Project current capabilities from live Bridge tools, skills, workflow guides and provider health, distinguishing available, degraded, unavailable and review states.
5. **persist-snapshot** — Persist only bounded derived inventory snapshots needed for fast daily/weekly resume views; never duplicate canonical project truth.
6. **publish-dashboard** — Expose resume-oriented dashboard views such as Al volver, Esta semana, open tasks, capability inventory and project pressure while preserving liveness isolation.
7. **organize-workspace** — Classify projects as active, paused, finished, experimental or review-needed and produce a bounded next-action map without renaming or deleting automatically.
8. **dirty-tree-cleanup** — Only after ownership is explainable, partition shared dirty changes into safe batches with verification; never use blind add/restore/cleanup.
9. **maintain-workflow** — Convert repeated false positives, routing defects or recovery friction into the smallest reusable guide/routing/test correction.

## Tool policy

Recommended tools:

- `project_context_load`
- `skill_bootstrap`
- `mssr_observatory_query`
- `mssr_trace_evidence`
- `git_status`
- `skill_catalog`
- `bridge_health`
- `bridge_metrics_query`
- `workflow_guide_recommend`
- `workflow_guide_load`
- `work_once`
- `workspace_snapshot`
- `mssr_trace_record`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
