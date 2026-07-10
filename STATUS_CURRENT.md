# bridge-mcp current status

Snapshot generated from the live bridge state and repo checks.

```text
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.6.0
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Runtime tools: 68
Git expected: ## main...origin/main
```

## Confirmed working

- TypeScript typecheck passes with `npm run check`.
- Build passes with `npm run build`.
- Regression suite passes with `npm run test:regressions`.
- Tool docs regenerate with `npm run docs:tools` and report 68 tools.
- Tunnel health is live/ready on `http://127.0.0.1:8081`.
- Restart flow uses request/ack files; do not kill active bridge processes directly.

## Tool modules

```text
core
file-navigation
file-writing
process
git
project
workspace
cache
bridge-ops
metrics
code-intelligence
code-graph
python-analysis
bridge-workflow
```

## Work completed in v0.6.0

- Persistent terminal state treats signal exits as completed, honors `cleanupAfterMs=0`, and terminates full process trees on Windows timeouts/stops.
- `work_*` aliases are statically typed and carry the correct read-only/destructive annotations.
- HTTP request bodies are bounded, session creation reserves capacity atomically, and the watchdog validates endpoint/process identity.
- Semantic dead-code analysis resolves shorthand assignments; the obsolete regex Python call-graph implementation was removed in favor of the AST helper.
- Allowed-root and denied-path enforcement covers explicit file, project, analysis, process-cwd and Git tools, including symlink/canonical-path checks and `.env*`/credential blocking.
- Git gained bounded diff/log/show/branch comparison, validated branch creation and file restore; diff/show/commit flows filter or reject sensitive paths.
- Project profiles detect stack, commands, important files and Git state; saved overrides are isolated under an `overrides` field.
- Workspace snapshots support labels, hash-based diff, manifest/path validation and rollback preflight; truncated snapshots cannot be restored.
- Persistent JSON cache now has TTL, byte/entry limits, automatic pruning, manual dry-run pruning and deletion-failure reporting.
- `TOOLS.md` is generated from the registry and reports 68 tools across 14 modules with no neutral risk annotations.
- Regression coverage exercises path policy, secret filtering, project profiles, Git tools, snapshot rollback/tamper protection and cache pruning.

## Remaining after this pass

- Call graphs remain intentionally conservative; richer cross-file signatures and class/member attribution can be improved from real project usage.
- JSON cache maintenance is now bounded; moving it to SQLite remains optional rather than required.
- The path policy reduces blast radius but trusted shell tools are not an operating-system sandbox.
- Full `bridge_verify_all` passed on v0.6.0 with doctor, typecheck, build, HTTP smoke, regressions, generated docs, watchdog, metrics and tool-catalog checks all green.
