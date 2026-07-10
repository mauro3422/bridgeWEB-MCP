# bridge-mcp current status

Snapshot generated from the live bridge state and repo checks.

```text
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.5.5
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Runtime tools: 47
Git expected: ## main...origin/main
```

## Confirmed working

- TypeScript typecheck passes with `npm run check`.
- Build passes with `npm run build`.
- Regression suite passes with `npm run test:regressions`.
- Tool docs regenerate with `npm run docs:tools` and report 53 tools.
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

## Work completed in v0.5.5 hardening

- Persistent terminal state now treats signal exits as completed and honors `cleanupAfterMs=0`.
- Windows timeouts and stops terminate the full process tree.
- `work_*` aliases are statically typed and carry correct read-only/destructive annotations.
- HTTP request bodies are bounded and session creation reserves capacity atomically.
- The watchdog verifies endpoint and process identity before adoption or termination.
- Semantic dead-code analysis resolves shorthand property assignments correctly.
- Regression coverage now exercises all of the above behavior.

## Work completed in v0.5.4 cleanup

- Documentation references updated from v0.5.1 / 36 tools to v0.5.4 / 47 tools.
- `TOOLS.md` regenerated from the runtime registry.
- Semantic TypeScript cache now keys by root, includeTests, maxFiles, tsconfig path, symbol filter, and source file stamps.
- Import graph cache now includes `tsconfig.json` stamp and bounded in-memory retention.
- Semantic impact now builds a project-wide index, so alias references can be attributed to the original symbol.
- Regression coverage added for tsconfig paths, barrel/index resolution, semantic aliases, cache invalidation, exported dead-code behavior, and metrics privacy.
- `call_graph` now builds a semantic TypeScript call graph for project functions/methods.
- Semantic index, import graph, and call graph can use persisted JSON cache under `data/cache`.
- `bridge_verify_all` now checks watchdog restart status and metrics status through MCP calls.

## Remaining after this pass

- Allowed-roots / denied-path policy is still a separate safety design item.
- Persisted cache currently stores JSON files; future work can add pruning/TTL or move it into SQLite.
- Call graph is semantic but intentionally conservative; deeper project-wide call signatures can be improved later.
- Full `bridge_verify_all` passed after loading the new runtime.
