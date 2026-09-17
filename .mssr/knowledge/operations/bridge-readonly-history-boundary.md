# Bridge read-only external-history path boundary

## Read-only external-history path boundary

A host-owned history/session store that must be inspectable for cross-agent recovery does not need to become a normal Bridge allowed root. Path policy keeps writable/`cwd` roots and read-only roots as separate capabilities: a path admitted through `BRIDGE_MCP_READONLY_ROOTS` may be used only by explicit tools requesting `read`, while `write` and shell-working-directory access remain denied; canonical-path/junction escape checks and sensitive denied-path/name rules still apply. Codex recovery uses this narrower boundary for `~/.codex/sessions`, `~/.codex/archived_sessions` and the exact `~/.codex/history.jsonl`, avoiding exposure of the rest of the `.codex` profile.
