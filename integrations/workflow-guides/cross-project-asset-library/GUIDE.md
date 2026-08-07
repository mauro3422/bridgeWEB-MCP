# Cross-Project Asset Library Loop

## Purpose

Use and maintain MauroAssetLibrary as the shared read-only catalog across Blender, Godot, Roblox and future asset projects: resolve ownership, inspect or refresh normalized evidence, preserve approval/source-drift gates, hand work back to the owning project, and verify the generated dashboard without turning the library into source authority.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **resolve-intent-and-owner** — Determine whether the user wants to browse, refresh, onboard a provider, publish asset evidence, or continue work in an owning project; identify the authoritative project before any mutation.
2. **inspect-library-state** — Read the current normalized catalog and asset state before changing anything.
3. **refresh-or-onboard-provider** — Rebuild existing providers or add a new provider adapter without copying canonical project sources into the library.
4. **evaluate-gates-and-drift** — Represent current usability truthfully when validated snapshots, working sources, approvals or permissions differ.
5. **handoff-to-owner** — Continue actual asset work in the authoritative project when the library reveals a pending action.
6. **publish-and-verify** — Refresh the library after provider work and prove the dashboard reflects durable evidence without mutating the provider from the library workflow.
7. **maintenance-feedback** — Feed repeated operational friction back into the correct owner without bloating the library workflow.

## Tool policy

Recommended tools:

- `project_context_load`
- `workflow_guide_recommend`
- `workflow_guide_load`
- `skill_bootstrap`
- `git_status`
- `workspace_snapshot`
- `workspace_diff`
- `read_many_files`
- `read_file_lines`
- `binary_file_info`
- `image_file_attach`
- `work_once`
- `mssr_trace_record`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
