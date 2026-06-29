# bridge-mcp current status

Snapshot generated from the live bridge state and repo checks.

```text
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.5.4
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Runtime tools: 45
Git expected: ## main...origin/main
```

## Confirmed working

- TypeScript typecheck passes with `npm run check`.
- Build passes with `npm run build`.
- Regression suite passes with `npm run test:regressions`.
- Tool docs regenerate with `npm run docs:tools` and report 45 tools.
- Tunnel health is live/ready on `http://127.0.0.1:8081`.
- Restart flow uses request/ack files; do not kill active bridge processes directly.

## Tool modules

```text
core
file-navigation
file-writing
process
git
bridge-ops
metrics
code-intelligence
code-graph
python-analysis
bridge-workflow
```

## Work completed in v0.5.4 cleanup

- Documentation references updated from v0.5.1 / 36 tools to v0.5.4 / 45 tools.
- `TOOLS.md` regenerated from the runtime registry.
- Semantic TypeScript cache now keys by root, includeTests, maxFiles, tsconfig path, symbol filter, and source file stamps.
- Import graph cache now includes `tsconfig.json` stamp and bounded in-memory retention.
- Semantic impact now builds a project-wide index, so alias references can be attributed to the original symbol.
- Regression coverage added for tsconfig paths, barrel/index resolution, semantic aliases, cache invalidation, exported dead-code behavior, and metrics privacy.

## Remaining after points 1-4

- Allowed-roots / denied-path policy is still a separate safety design item.
- Project-wide call graph remains optional future work.
- Cache is in-memory only; no persisted cache layer yet.
- Full `bridge_verify_all` should be run before committing/pushing final changes.
