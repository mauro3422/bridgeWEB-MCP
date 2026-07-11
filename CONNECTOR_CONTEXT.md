# Connector context model

This document explains how `bridge-mcp` becomes usable from ChatGPT and what context the assistant receives.

## Short version

The assistant does not automatically see the whole machine, the whole repo, or all files.

It receives context from:

```txt
system/developer instructions
current conversation
available connector/tool declarations
selected tool outputs
uploaded/attached files, when present
```

For `bridge-mcp`, the important injected part is the MCP tool catalog:

```txt
tool name
tool description
input schema
optional tool annotations or metadata
```

The model uses that catalog to decide which tool to call. When a tool is called, the returned output becomes additional context for the next reasoning step.

## What ChatGPT gets from the connector

When ChatGPT or the API connects to an MCP server, it can list the available tools. For this bridge, the server exposes tools from `src/tool-registry.ts`.

Practical flow:

```txt
ChatGPT lists tools
bridge-mcp returns tool schemas
ChatGPT sees names/descriptions/schemas
ChatGPT chooses a tool call when useful
bridge-mcp executes locally on MauroPrime
bridge-mcp returns output
ChatGPT uses that output as context
```

The assistant does not get direct invisible access to the filesystem. It only sees file contents after tools such as `read_text_file`, `read_file_lines`, `read_many_files`, `search_files`, `analyze_code`, or `dependency_graph` return data.

## Why descriptions matter

Tool descriptions and schemas are part of the model's selection context. If descriptions are vague, duplicated, misleading, or incomplete, the model may choose the wrong tool or call it with wrong arguments.

That is why this repo now generates `TOOLS.md` from the live registry schemas:

```powershell
npm run docs:tools
```

Generated file:

```txt
TOOLS.md
```

Generation script:

```txt
scripts/generate-tools-doc.mjs
```

## Why tools sometimes look cached

A host can cache or retain a previously listed tool catalog inside the conversation or workflow context. In practice, after adding new tools to the MCP server, an existing ChatGPT conversation may not immediately show them.

Operational fix:

```txt
restart bridge if needed
refresh or reopen connector
start a new chat if catalog still looks stale
verify with direct /mcp tools/list when needed
```

For this bridge, use:

```txt
bridge_verify_all
```

or direct HTTP `tools/list` sanity checks.

## Tool output as context

Tool output is not just a side effect. It becomes the assistant's evidence for the next step.

Examples:

```txt
read_file_lines -> assistant now sees exact lines
search_files -> assistant now sees matching files and context
impact_analysis -> assistant now sees definitions/references/risk
dependency_graph -> assistant now sees graph summary/cycles/unresolved imports
bridge_self_check -> assistant now sees health/build/git/tunnel state
```

That is why outputs should be:

```txt
bounded
structured
clear
redacted where needed
small enough to reason over
large enough to be useful
```

## What is not injected automatically

The assistant does not automatically receive:

```txt
full source tree
full file contents
local runtime files
Git history
terminal state
local environment values
```

Those only appear if a tool returns them. The bridge should avoid returning sensitive local data and should keep operational telemetry minimal.

## Approval and sensitive actions

Write actions are more useful but riskier than read actions. This bridge separates read/analyze tools from write/process/Git/restart tools, but it still needs a future permission layer.

Current safe practice:

```txt
prefer read/analyze tools first
use apply_patch/edit_lines instead of raw shell edits
run check/build/smoke/regressions before commit
use bridge_request_restart instead of killing processes
commit/push only after verification
```

Current safety posture:

```txt
allowed roots and denied paths enforced
sensitive `.env*`/credential names blocked
explicit risk annotations for every tool
Git inspection/commit flows filter sensitive paths
workspace rollback requires exact confirmation and complete snapshots
trusted shell tools remain outside an operating-system sandbox
```

## Local bridge-specific context

Current bridge assumptions:

```txt
Project root: C:\dev\bridge-mcp
Server: bridge-mcp v0.6.2
Active profile: bridge-local-http
Bridge MCP: http://127.0.0.1:3001/mcp
Tunnel admin: http://127.0.0.1:8081
Rollback: stdio watchdog
```

Important: the connector executes tools on the machine where the bridge and tunnel run. If ChatGPT is opened from a laptop but the tunnel points to MauroPrime, tools execute on MauroPrime.

## References to keep in mind

OpenAI's MCP/connectors docs describe connectors and remote MCP servers as tools that give models new capabilities by connecting to external services. The same docs show that the API lists tools from MCP servers and that listed tools include descriptions and input schemas. They also recommend caution, approvals for sensitive actions, and review of data shared with MCP servers.


