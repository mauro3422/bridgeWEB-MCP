# MSSR Librarian and Jev Evidence Composition

## Purpose

Use the existing MSSR Librarian tools to retrieve, select and verify exact project evidence, review contradictions, and compose citation-grounded host paragraphs. Jev makes bounded text decisions; the host owns retrieval scope, writing, verification and any approved persistence.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **scope-and-query** — Define a question and an explicit, authorized Markdown corpus before retrieval.
2. **retrieve-and-select** — Search explicit project sources and use Jev only for bounded selection decisions.
3. **verify-and-pack-evidence** — Re-read exact source ranges and produce a bounded cited evidence pack.
4. **review-relations-and-conflicts** — Surface support, duplication, contradiction and unresolved relations without silently merging claims.
5. **compose-and-verify** — Let the host write useful paragraphs whose claims remain traceable to exact evidence.
6. **resume-and-record** — Resume safely across tool calls and leave privacy-safe, evidence-backed progress.

## Tool policy

Recommended tools:

- `mssr_librarian_search`
- `mssr_librarian_jev_select`
- `mssr_librarian_fetch`
- `mssr_librarian_evidence_pack`
- `mssr_semantic_evidence_relation_review`
- `mssr_semantic_evidence_synthesis_preview`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
