# Bridge/MSSR dirty-cohort reconciliation handoff — 2026-10-03

## Goal and result

Reconcile the preserved dirty Bridge checkout with the later MSSR Librarian/Jev candidate, retain every recovery artifact, and implement a small release candidate for binary resource isolation, image preview integrity, and stale Project Health abstention. Do not replay older cohort patches over the candidate: the feature history is already represented by later commits and several snapshot files have since been revised.

## Protected source and workspaces

- Protected original checkout: `D:\Dev\bridge-mcp`, branch `codex/jev-bridge-adoption-20260930`, HEAD `3b2f63cf56771be486db1575958096a3950d9fc9`. It was not edited, committed, reset, or pushed during this integration.
- Recovery snapshot: `D:\Dev\mssr-snapshots\bridge-primary-worktree-3b2f63c-1791001298123-8391da6b`. Manifest SHA-256: `479b0fcb793ab2b933e17579877311f1f3162f9b5e6411a66f653390702117a8`; captured `2026-10-03T04:21:38.825Z`.
- The snapshot preserves the exact Git index, a 31-path staged patch (SHA-256 `86145f3141aaf518c5808896179976607ca12ecc3419e0f30f284b60e1ab4a67`), a 16-path unstaged patch (SHA-256 `10682d9ac7e014602dafbc31e03c5afb62618ed675b58bd6b3f1e27fcc25a7ed`), and per-file hashes for all 30 untracked files. The index SHA-256 is `cfc77524c3707dc54b9a90b2fe38ac51f4e84e55386444a028e2fabc776df4ec`.
- Exact scratch reconstruction: `D:\Dev\bridge-mcp-snapshot-reconstruction`, detached at the protected source commit, with preserved patches and hash-checked payloads.
- Integration checkout: `D:\Dev\bridge-mcp-cohort-reconciliation`, branch `codex/bridge-dirty-cohort-reconciliation-20261003`, based on candidate commit `7b6fcd39e5d7d9c7513c231fcf98ceed76954c6b`. Candidate remote history is retained; this branch is the reviewable continuation.

## Reconciliation decisions

The relevant candidate history was read as a sequence: `0497ce3` adds opt-in project-context Librarian metadata; `b765ac2` adopts exact-fetchable Jev ranges; `0570bd2` adds the sidecar metadata mode; `052b06d` corrects the Streamable HTTP test protocol; and `7b6fcd3` fixes response framing. These commits supersede older snapshot patches for those features. The candidate also already carries the MSSR semantic-evidence tools, use-case documentation, and maintenance-index worker; no duplicate tools or worker were added.

The 30 untracked snapshot paths compare against candidate HEAD as follows:

- **Byte-identical (3):** `changelogs/0.6.143.md`, `vendor/mauroprime-mssr-0.2.95.tgz`, `vendor/mauroprime-mssr-0.2.96.tgz`.
- **Present but revised in the candidate (16):** `.mssr/knowledge/architecture/bridge-skill-maintenance-projection.md`, `changelogs/0.6.144.md`, `docs/DASHBOARD_UX_IDENTITY.md`, `docs/DASHBOARD_UX_V2_INFORMATION_ARCHITECTURE.md`, `docs/MSSR_JEV_USE_CASE_CATALOG.md`, `docs/dashboard-visual-qa/AUDIT_V2.md`, `docs/dashboard-visual-qa/FIRST_AUDIT.md`, `docs/dashboard-visual-qa/HARNESS.md`, `integrations/images/prepare_chat_preview.py`, `scripts/dashboard-visual-harness.mjs`, `scripts/test-dashboard-human-ux-browser.mjs`, `scripts/test-dashboard-human-ux.mjs`, `scripts/test-project-reference-resolver.mjs`, `src/local-resource-registry.ts`, `src/mssr-skill-maintenance-index-worker.ts`, and `src/project-reference.ts`. Keep the later candidate copies; the safety changes to image preview, resource registry, and project reference are recorded in 0.6.148.
- **Absent from the candidate (11), retained in the recovery snapshot:** `.bridge/host-tests/maestro_concept_chat_hd.jpg`; `.mssr/sessions/2026-09-26-context-director-handoff.md`; `.mssr/sessions/2026-09-27-mssr-friction-audit-handoff.md`; `.mssr/sessions/2026-09-29-dashboard-human-ux-v1-1-handoff.md`; `scripts/test-librarian-host-runtime-adapter.mjs`; `src/librarian-host-runtime-adapter.ts`; `vendor/mauroprime-mssr-0.2.86.tgz`; `vendor/mauroprime-mssr-0.2.87.tgz`; `vendor/mauroprime-mssr-0.2.88.tgz`; `vendor/mauroprime-mssr-0.2.89.tgz`; and the empty file `x[1])`.

Do not apply the snapshot deletion of `scripts/start-bridge-http-watchdog.ps1`: the candidate still calls it from watchdog installation, diagnostics, cleanup, and regression tests. The three `.mssr/sessions/` files are historical handoffs, not current state. The old vendor tarballs are not current dependencies. The Librarian host-runtime adapter is an unconnected prototype: defer it until source ownership, exact EvidenceAtom-to-source linkage, privacy, ingestion tests, and release scope are defined. Dashboard V2-A/B work is already in the candidate; V2-C/D and the old visual-QA artifacts remain separate follow-up material.

The tracked snapshot comparison was also classified: 43 paths match later candidate content, 15 differ because the candidate contains subsequent edits, and 11 are absent and remain available in the reconstruction/snapshot. The staged and unstaged source patches remain separately recoverable by their manifest hashes; they were not replayed wholesale.

## 0.6.148 candidate

- Legacy MCP servers now own independent local-resource registries and clear them on close. Reads revalidate size and SHA-256. Unknown, expired, cross-session, malformed, changed, or missing resources return JSON-RPC `InvalidParams` (`-32602`); unexpected I/O errors remain internal errors.
- The unauthenticated modern MCP endpoint stays stateless: attachments are embedded in the same response, link-only mode fails clearly, and deferred `resources/read` cannot expose another request's resource.
- Image preview conversion uses an immutable source-byte snapshot, verifies its SHA-256 in Python, rejects images above 40 million pixels and pre-existing outputs, and publishes through a no-clobber atomic hard link.
- Project Reference abstains when the latest Project Health snapshot is invalid or at least 24 hours old, matching the existing daily capture interval. It does not initiate a filesystem scan.
- `docs/MCP_BINARY_AND_IMAGE_TRANSPORT.md` records the transport boundary. The duplicate 2026-10-01 exact-handle benchmark paragraph was removed; benchmark claims and historical evidence remain in `docs/MSSR_LIBRARIAN_JEV.md`.

## Verification and adoption boundary

Passed on the integration checkout:

- `npm run check`
- `npm run test:mcp-dual-era` (including separate raw TCP/SSE response framing)
- `npm run test:regressions` (full aggregate suite)
- `npm run docs:tools:check` (generated 185-tool catalog)

`npm run verify:all` remains an adoption gate because port 3001 is owned by the live Bridge 0.6.144 runtime. No live Bridge restart, deployment, main merge, or package publication was performed. Verify the exact branch ref and final commit after Git persistence; then run the live-runtime adoption gate only as a separately controlled operation.

## Persistence and remaining gate

The 0.6.148 implementation is committed as `d881ab800e30c206cefef01207c02de7c6885ed3` on `codex/bridge-dirty-cohort-reconciliation-20261003`; the companion state/handoff closeout is recorded in the branch history. Keep the protected original checkout and recovery snapshot intact.

The only product adoption gate left is `npm run verify:all` against the candidate when port 3001 can be assigned to that candidate under a controlled restart. It currently belongs to the live Bridge 0.6.144 runtime. Do not treat this isolated candidate's passing local gates as a live deployment or restart.
