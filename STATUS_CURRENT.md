# Legacy status pointer — deprecated

`STATUS_CURRENT.md` is kept only as a compatibility pointer. It is **not** a current-state authority and must not copy release numbers, PIDs, boot ids, dependency versions, tool counts, health results, or other facts that become stale after a restart or release.

Use these sources instead:

- `.mssr/PROJECT_STATE.md` — durable current project/release/adoption state.
- `changelogs/INDEX.md` — canonical versioned release history.
- `bridge_health(check="all")` — live Bridge/tunnel/restart/tool-catalog state.
- `git status` plus remote readback — repository persistence state.
- `AGENTS.md` and `.mssr/project-context.json` — repository rules and selectable project-context contract.

For a new session, call `project_context_load` for `D:\Dev\bridge-mcp`, then use structured MSSR routing/bootstrap and inspect live health as needed. Do not restore a duplicated "current snapshot" in this file; keeping volatile state in its canonical owner prevents this compatibility path from becoming stale again.
