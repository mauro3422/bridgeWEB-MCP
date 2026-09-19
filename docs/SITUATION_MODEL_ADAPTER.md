# Situation Model adapter

Bridge 0.6.135 consumes the portable MSSR Situation Model from `@mauroprime/mssr` 0.2.67, including the original receipt/revision path and C2e-D explicit semantic claim producers.

## Purpose

Project knowledge and explicit host facts are operational evidence, not just documentation. Bridge compares bounded Context Plane delivery revisions with current canonical repository owners and can also supply contract-defined scalar semantic claims such as package/source/generated/installed/runtime version facts. Free-form project prose is not converted into claims.

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

`src/project-situation.ts` discovers the managed workspace and composes two bounded evidence channels. Receipt-derived C2e observations are collected only when operationally active Context Plane delivery receipts still point at current canonical candidates. Explicit C2e-D semantic claims are independent of receipt presence; Bridge currently auto-produces them only for its own release/install/runtime contract by reusing `src/release-consistency.ts`. Both channels enter the same portable MSSR Situation Model/C2c/C2d evaluation.

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

The watcher remains evidence-first and never parses arbitrary free-form memory prose into truth. From 0.6.135, Bridge's release-consistency observer is the first production C2e-D producer: it maps already-structured package/source/generated/installed/runtime facts into bounded scalar semantic claims. Adding another producer requires an explicit structured contract plus host tests; lexical similarity, prose search, or model confidence alone cannot assert contradiction.

## HTTP projection

`GET /api/mssr/project-situation` returns the current metadata-only watcher report.

The endpoint is a human/host projection of the Situation Model; it is not a second source of truth and does not grant mutation authority.
