# Roblox Object-Driven Visual Review

## Purpose

Generate deterministic Roblox visual-review stations and camera plans from a selected Model or ProceduralModel, including bounds-based turnarounds, growth/state strips, animation extrema, warm-up, retries, evidence manifests, comparisons, and dashboards.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **resolve-target** — Resolve one canonical selected object or explicit instance path and reject ambiguous runtime clones.
2. **prepare-clean-stage** — Isolate the subject and suppress unrelated visual noise.
3. **derive-cameras** — Compute front, side, top, three-quarter, detail, state-strip, and animation cameras from bounds.
4. **capture-resiliently** — Produce complete frames despite cold-renderer or individual-frame failures.
5. **compare-and-critique** — Create machine-readable metrics plus human visual judgment.
6. **publish-and-verify** — Publish artifact and global dashboards with no missing or mismatched files.

## Tool policy

Recommended tools:

- `workflow_guide_load`
- `roblox_mcp_status`
- `roblox_mcp_query`
- `roblox_mcp_action`
- `run_command`
- `write_text_file`
- `binary_file_info`
- `roblox_place_save`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
