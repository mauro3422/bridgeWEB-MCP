# MSSR Librarian and Jev in Bridge

Bridge exposes the four existing semantic-evidence capabilities from the versioned `@mauroprime/mssr` package. MSSR owns retrieval ranking, revision-bound handles, EvidenceAtom validation, relation evaluation, and synthesis preview. Bridge owns filesystem authorization, reading the selected project source, rereading exact evidence, and providing Jev credentials.

## Tools

- `mssr_librarian_search` searches only the explicit `sourceRefs` supplied by the caller. It does not crawl a directory or search runtime stores.
- `mssr_librarian_fetch` rereads the selected Markdown file and rejects stale handles or ranges whose revision/fingerprint changed.
- `mssr_semantic_evidence_relation_review` rereads all cited source ranges, replaces caller-provided evidence text with the current host-read text, then makes a bounded external Jev request. The returned judgments are advisory and unverified.
- `mssr_semantic_evidence_synthesis_preview` rereads its exact sources and builds an immutable proposal. It never edits project files; conflicts, stale evidence, unverified judgments, or unknown comparability remain review-only.

Each call requires a Git project root containing the canonical `.mssr/project-context.json`. Sources must be explicit, project-relative UTF-8 Markdown paths. Bridge caps each source at 2 MB, each batch at 4 MB and 32 files, and each semantic operation at the packaged MSSR limits. It validates the resolved canonical target as well as the requested path, so an internal symlink or junction cannot alias `data/`, `logs/`, `.git/`, `.bridge/`, `node_modules/`, `.mssr/runtime/`, or sensitive-looking paths. Absolute paths, traversal, and colon-containing paths (including Windows Alternate Data Streams) are rejected.

Relation review costs account usage because it calls TypeSafe Jev. On Windows, Bridge reads the `TypeSafe:MSSR:JevLab` credential from Windows Credential Manager on demand through `scripts/read-windows-credential.ps1`. `BRIDGE_MSSR_JEV_CREDENTIAL_TARGET` can select a different target and `BRIDGE_MSSR_JEV_MODEL` can select a model. The API endpoint is pinned to `https://api.typesafe.ai`; inherited `TYPESAFE_BASE_URL` configuration cannot redirect the credential. The API key is not accepted in MCP arguments, is not copied to an environment file, and is not logged or placed in telemetry. If the credential is absent, the relation tool fails with a generic unavailable message; other Bridge tools remain available.

## Ignored runtime data

`data/` and `logs/` remain outside Git and protected from this Librarian adapter. A metadata-only inventory of the Bridge checkout found 10,675 files totaling about 1.69 GB. Jev reviewed only an aggregated, path-free summary against the repository's preserve-by-default rule: preserving/classifying was supported, deletion contradicted the rule, and the inventory alone did not justify deletion. Those answers remain unverified guidance. No file-level retention or deletion decision follows from them.

Use deterministic cache/storage tools and explicit owner, activity, freshness, and regeneration evidence to review runtime data. Keep protected stores unless their owning policy authorizes bounded pruning. Never treat Jev confidence as a deletion threshold or as permission to mutate canonical data.

## Source and package ownership

Portable semantic behavior is versioned in `D:\Dev\mssr`. This Bridge integration consumes the exact local MSSR 0.2.93 tarball in `vendor/`; source tarball and vendor SHA-256 must match before runtime adoption. `TOOLS.md` is generated from `src/tool-registry.ts` and the module schemas.
