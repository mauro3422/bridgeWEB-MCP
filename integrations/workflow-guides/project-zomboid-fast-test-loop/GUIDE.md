# Project Zomboid Fast Test Loop

## Purpose

Reusable Build 42 mod-development loop for Mauro's Windows PC: inspect active PZ processes/RAM first, use isolated `-cachedir` profiles and dev-only Debug Scenarios, keep the expensive client open, and prefer terminal/file-trigger Lua hot reload plus bounded request/response runtime commands over focus-stealing debugger input. Reserve restarts and two-client MP only for changes that require them.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **preflight** — Resolve the owning PZ mod project and prevent accidental duplicate/over-budget launches.
2. **cheap-verification** — Reject bad iterations before paying PZ startup cost.
3. **prepare-isolated-smoke** — Prepare a repeatable dev profile without touching the user's normal Zomboid profile.
4. **debug-lab-autolaunch** — Enter a tiny deterministic lab without menus or character setup.
5. **hot-reload-loop** — Keep the expensive PZ client alive across ordinary Lua edits without stealing focus.
6. **singleplayer-smoke** — Exercise the smallest observable behavior in one client.
7. **lifecycle-check** — Verify save/load/chunk/object lifecycle only when the change can be affected by it.
8. **multiplayer-gate** — Use MP only for authority/network/cross-client behavior.
9. **verify-close** — Close with observable evidence and persist durable lessons.

## Tool policy

Recommended tools:

- `project_context_load`
- `skill_bootstrap`
- `work_once`
- `work_begin`
- `work_peek`
- `work_feed`
- `work_finish`
- `search_files`
- `read_file_lines`
- `run_command`
- `mssr_trace_record`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
