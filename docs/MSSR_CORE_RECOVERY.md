# MSSR core recovery — fail-closed bootstrap deadlock

## Incident: October 11, 2026

The indexed `project-identity` section of `.mssr/PROJECT_CONTEXT.md` reached 2,003 bytes with a declared `maxChars: 1800`. Portable MSSR rejected `project_context_load` and `skill_bootstrap`. Bridge's managed lifecycle preflight correctly rejected all untraced writes, including those which could shrink the section. The user restored the source to the prior Git commit to regain access. No bridge or portable MSSR code was broken by Git; the failure was a missing narrow recovery path.

## Fix candidate

This branch implements **host-only, direct** `project_context_recover_core`.

- Requires an existing, valid canonical `.mssr/project-context.json`; never reads `.bridge/`.
- Accepts only one indexed **core** heading in a canonical `.mssr/PROJECT_CONTEXT.md`, `PROJECT_MEMORY.md`, or `PROJECT_STATE.md`.
- Requires the full current-file `expectedSha256` (not a wildcard) and a fully reviewed replacement **body**. Does not perform autonomous summarization.
- Refuses requests unless the selected core section **already exceeds** its explicitly declared budget and the proposed section shrinks beneath it.
- Calls portable `preflightMssrProjectContextWrite` and checks `contractValid`. Never increases budgets, changes manifest entries, suppresses errors, or truncates required context.
- Uses temporary same-directory file + checksum/readback and rechecks source hash just before replacement. Does not change or roll back unrelated files.
- **Only this direct tool** bypasses the normal managed-trace preflight; `run_command`, `write_text_file`, normal `project_context_update`, proxies and ordinary tools remain guarded.
- Normal `project_context_update` now applies the portable preflight before any file write, preventing a repeat on known indexed sources.

## Emergency workflow (only for an over-budget indexed core)

1. Read the canonical `.mssr/project-context.json` and target PROJECT_* source by authorized read-only tools; determine the precise over-budget core and proposed human-reviewed reduced section.
2. Obtain SHA-256 of the **whole current source file**. Do not guess the value.
3. Call `project_context_recover_core` with `projectRoot`, exact `heading`, replacement `content` (without duplicating the heading), and `expectedSha256`.
4. If the dedicated recovery tool is **missing from ChatGPT's connector catalog**, inspect the *live* schema with `bridge_tool_schema({toolName:"project_context_recover_core"})`, then call `bridge_tool_action` with `toolName` and `confirmToolName` both exactly `project_context_recover_core`, and `arguments` matching the live schema. This narrow fallback has the same SHA, section, size, and project restrictions; ordinary delegated actions never bypass lifecycle protections.
5. Inspect the returned before/after SHA and bytes and re-run `project_context_load`, `project_context_health`, and `skill_bootstrap` normally; resume a managed trace.
6. If other authorities are invalid, a manifest is broken, another actor changes the file, or a section cannot be reduced safely, **stop** and use normal explicit/manual recovery. Never mutate unknown content merely to pass a length gate.

Jev/Librarian may later propose what to retain, split, and retrieve; its judgments remain advisory. Human/project-authorized review, exact-source verification and write gates continue to determine persistence. This patch intentionally makes no Jev/runtime/provider changes.

## Verification

```
npm run check
npm run build
npm run test:project-context
npm run test:mssr-lifecycle-host-adoption
```

New regression `scripts/test-project-context-core-recovery.mjs` checks: all normal untraced mutations still blocked; over-budget core repair succeeds via direct MCP without bootstrap; stale hashes, non-core headings and oversized attempts fail without altering files; manifest remains identical; recovered healthy cores no longer allow emergency writes; normal writer cannot re-grow core beyond budget.

## Deployment boundary

Worktree `D:\Dev\bridge-mcp-context-recovery-lab`, branch `feat/mssr-core-recovery-20261011`. This is a **candidate**, not an adopted/live server fix. Do not update the concurrently dirty canonical `D:\Dev\bridge-mcp`, restart the running Bridge, replace the package, or alter Jev tests during concurrent work. Integration needs reconciliation against current live changes, release gate, version/changelog, full Bridge HTTP health and fresh end-to-end smoke.
