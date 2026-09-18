# Legacy chat handoff — deprecated

This file used to contain a pasted startup prompt with copied version numbers, tool counts and operating state. That approach became stale and is no longer the canonical continuation path.

## Current continuation contract

A new ChatGPT or Codex session should not trust copied runtime facts from this document. Instead:

1. connect to `BrigdeMCP-WEB`;
2. call `project_context_load` for `D:\Dev\bridge-mcp` with the resolved task;
3. use structured MSSR intent through `skill_route_plan` or `skill_bootstrap`;
4. call `bridge_health(check="all")` for the live server version, tunnel state, module list and tool count;
5. inspect `git status` and the relevant source before mutation;
6. run the project gates before commit and `bridge_verify_all` for release/runtime closure.

Durable authorities and live evidence:

```text
AGENTS.md
.mssr/project-context.json
.mssr/PROJECT_CONTEXT.md
.mssr/PROJECT_MEMORY.md
.mssr/PROJECT_STATE.md
changelogs/INDEX.md
docs/INCIDENTS.md
README.md
TOOLS.md
bridge_health(check="all")
```

`STATUS_CURRENT.md` is only a deprecated compatibility pointer and must not be treated as a current-state authority.

Do not restore a large pasted prompt here. Project context, live health and Git are the sources of truth.
