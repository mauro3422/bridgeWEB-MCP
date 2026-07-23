# bridge-mcp current status

Snapshot verified against the live HTTP bridge runtime.

```text
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.6.8
Mode: HTTP production-candidate
Bridge MCP: http://127.0.0.1:3001/mcp
Bridge status: http://127.0.0.1:3001/status
Tunnel admin: http://127.0.0.1:8081
Tunnel profile: bridge-local-http
Runtime tools: 109
Runtime modules: 22
Git expected: ## main...origin/main
```

## Confirmed working

- TypeScript typecheck passes with `npm run check`.
- Build passes with `npm run build`.
- `npm audit` reports 0 vulnerabilities; `@hono/node-server` is pinned through an override to the patched 2.0.11 release and the full MCP regression suite passes with it.
- Regression suite passes with `npm run test:regressions`.
- TabletWhiteboard capture module passes `npm run test:whiteboard`, including fresh PNG attachment, latest/list access, proxy image hoisting and private-network URL guards.
- HTTP health, readiness, MCP initialize, session lifecycle and `tools/list` pass.
- `TOOLS.md` is generated from the registry and reports 109 tools with no neutral risk annotations.
- Tunnel health is live/ready on `http://127.0.0.1:8081`.
- Restart flow uses request/ack files; do not kill active bridge processes directly.
- `bridge_verify_all` passes against live server v0.6.8.
- Live `blender_review_bundle` testing against the CBAnimal fox returned four renders, structured scene context, completed restoration, and mixed MCP content containing both JSON text and an attached `image/png` contact sheet.

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
tablet-whiteboard
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
- Blender 5.1.2 interactive and batch control, including multi-view review bundles with attached contact-sheet previews and structured model/rig/animation diagnostics.
- TabletWhiteboard viewport inspection: fresh PC capture at exact pan/zoom, latest saved capture and bounded album metadata, with PNG attachments returned directly to ChatGPT.
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
