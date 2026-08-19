# Situation Model adapter

Bridge 0.6.105 consumes the portable MSSR C2e Situation Model from `@mauroprime/mssr` 0.2.26.

## Purpose

Project knowledge is operational evidence, not just documentation. Bridge watches the bounded revision metadata already produced by MSSR Context Plane and compares what an agent was actually delivered with the current canonical repository owners.

```text
PROJECT_CONTEXT / PROJECT_MEMORY / PROJECT_STATE
ADRs / changelogs / incidents / receipts
                  +
current canonical repository revisions
                  ↓
          MSSR Situation Model
                  ↓
         C2c consistency diagnosis
                  ↓
       C2d evidence-first planning
                  ↓
        existing bridgeNotices transport
```

This applies to any host that consumes the same Context Plane contract: ChatGPT Web, Codex, OpenCode, or another provider. `Kairos` is not a technical component of this architecture.

## Watcher contract

`src/project-situation.ts` discovers the managed workspace but performs repository collection only for projects with operationally active Context Plane delivery receipts. It then compares receipt revisions with current canonical repository revisions through portable MSSR C2e/C2c/C2d.

The watcher persists metadata-only snapshots under ignored `data/project-situation.json` (or `BRIDGE_MCP_PROJECT_SITUATION_PATH`) so stable REVIEW does not reopen after a Bridge restart. No raw PROJECT_MEMORY body, prompt, transcript, private reasoning, or arbitrary document content is written to this store.

A current/newer delivery supersedes older receipts for the same authority. Re-selecting an existing Context Message refreshes its durable `sources`, `traceId`, and `nextGate` in MSSR 0.2.26, so a real context refresh can emit `resolved` and stay resolved.

## Attention and classification

C2e does not create another severity or queue system. Operational attention still uses:

`OK < WATCH < REVIEW < ERROR`

Situation metadata adds orthogonal routing fields such as:

- `noticeClass`: `context-refresh`, `release-integrity`, `runtime-integrity`, or generic `consistency`;
- category: `project-memory`, `project-state`, `project-context`, `changelog`, `architecture`, etc.;
- bounded priority;
- evidence/reason codes and stale refs.

All notices are adapted into the existing `bridgeNotices` queue/history/TTL/automatic-drain path. Stable fingerprints remain silent; changed/escalated/deescalated/resolved transitions remain observable.

## Recommendation boundary

C2d remains the sole owner of recommendation order. Bridge may turn only `ready` recommendations into notice actions. `deferred` items remain evidence and cannot be promoted by host convenience.

For a stale project-knowledge receipt, `revalidate-context-evidence` may render `project_context_load({ projectRoot })` as the next advisory action. The action is never executed automatically.

## Evidence reliability

C2e distinguishes `observed`, `declared`, `inferred`, and `learned` evidence. Reliability does not override semantic ownership. Inferred/learned evidence cannot become canonical merely because its confidence is high.

The current watcher is revision-first. It does not parse arbitrary free-form memory prose into truth. Contract-defined semantic claim producers can be added later under separate tests and ownership rules.

## HTTP projection

`GET /api/mssr/project-situation` returns the current metadata-only watcher report.

The endpoint is a human/host projection of the Situation Model; it is not a second source of truth and does not grant mutation authority.
