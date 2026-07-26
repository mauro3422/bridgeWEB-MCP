# Legacy chat handoff — deprecated

This file used to contain a pasted startup prompt with copied version numbers, tool counts and operating state. That approach became stale and is no longer the canonical continuation path.

## Current continuation contract

A new ChatGPT or Codex session should not trust copied runtime facts from this document. Instead:

1. connect to `BrigdeMCP-WEB`;
2. call `project_context_load` for `C:\Dev\bridge-mcp` with the resolved task;
3. use structured MSSR intent through `skill_route_plan` or `skill_bootstrap`;
4. call `bridge_health(check="all")` for the live server version, tunnel state, module list and tool count;
5. inspect `git status` and the relevant source before mutation;
6. run the project gates before commit and `bridge_verify_all` for release/runtime closure.

Durable authorities:

```text
AGENTS.md
STATUS_CURRENT.md
docs/REPOSITORY_STRUCTURE.md
docs/INCIDENTS.md
README.md
TOOLS.md
```

Do not restore a large pasted prompt here. Project context, live health and Git are the sources of truth.
