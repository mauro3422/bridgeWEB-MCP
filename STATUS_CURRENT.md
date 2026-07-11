# bridge-mcp current status

Snapshot verified against the live HTTP bridge runtime.

```text
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.6.4
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Runtime tools: 91
Runtime modules: 18
Git expected: ## main...origin/main
```

## Confirmed working

- TypeScript typecheck passes with `npm run check`.
- Build passes with `npm run build`.
- Regression suite passes with `npm run test:regressions`.
- HTTP health, readiness, MCP initialize, session lifecycle and `tools/list` pass.
- `TOOLS.md` is generated from the registry and reports 91 tools with no neutral risk annotations.
- Tunnel health is live/ready on `http://127.0.0.1:8081`.
- Restart flow uses request/ack files; do not kill active bridge processes directly.
- `bridge_verify_all` passes against live server v0.6.4.

## Tool modules

```text
core
file-navigation
file-writing
workflow-guides
binary-files
images
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
blender
bridge-workflow
```

## Current capabilities

- Safe project/file navigation and verified text edits.
- Project context bootstrap from `AGENTS.md` and `.bridge` documents.
- Reusable workflow-guide recommendation, loading and creation.
- Image persistence, character-view normalization and Blender reference setup.
- Direct and resumable binary transfers with base64/base64url/hex, sequence checkpoints, byte/SHA-256 validation, bounded chunk reads, atomic writes and stale-session cleanup.
- Persistent terminal work, bounded commands and process-tree cleanup.
- Git inspection and controlled mutations with sensitive-path filtering.
- Workspace snapshots, diff and guarded rollback.
- TypeScript/JavaScript and Python static analysis.
- Blender 5.1.2 interactive and batch control.
- Metrics, visualization specs, health checks and watchdog-coordinated restart.

## Binary transfer rule

Do not route encoded binary data through `write_text_file`.

```text
small payload:
  binary_file_write
  -> binary_file_info

large/resumable payload:
  binary_upload_begin
  -> binary_upload_append (ordered chunks)
  -> binary_upload_status (as needed)
  -> binary_upload_finish
  -> binary_file_info
```

Use `binary_upload_abort` to discard an incomplete session without touching its target. Sessions expire after 24 hours and stale sessions are cleaned when a new upload begins.

## Remaining considerations

- Tool catalogs can remain cached in an already-open ChatGPT conversation; reopen the connector or begin a new chat when newly published tools do not appear as direct actions.
- The path policy reduces blast radius, but trusted shell tools are not an operating-system sandbox.
- Call graphs remain intentionally conservative; improve them only from evidence gathered on real projects.
