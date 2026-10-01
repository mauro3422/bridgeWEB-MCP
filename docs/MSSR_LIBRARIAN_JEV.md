# MSSR Librarian and Jev in Bridge

Bridge integrates five Librarian and semantic-evidence capabilities from the versioned `@mauroprime/mssr` package. MSSR owns deterministic retrieval, revision-bound handles, EvidenceAtom validation, Jev selection/relation contracts, and reversible synthesis previews. Bridge owns project-root authorization, Markdown reads, exact-source revalidation, provider transport, and Windows Credential Manager access.

## Capabilities

- `mssr_librarian_search` searches only explicit project-relative Markdown `sourceRefs`. It uses deterministic lexical matching and metadata filters; it does not crawl the repository, discover undeclared files, or scan runtime stores. It returns exact revision-bound section/block candidate handles.
- `mssr_librarian_jev_select` makes a live Jev choice. It can use heading candidates or up to 100 exact handles returned by `mssr_librarian_search`. MSSR revalidates owner, explicit source, privacy class, revision, range, and fingerprint before the provider call. The result is only a selected handle; fetch it before using source text.
- `mssr_librarian_fetch` rereads the selected Markdown file and rejects stale handles or ranges whose revision/fingerprint changed.
- `mssr_semantic_evidence_relation_review` rereads cited ranges, ignores caller-supplied replacement text, and asks Jev for bounded typed relations such as supports, contradicts, supersedes, duplicate, unrelated, or unresolved. Judgments remain unverified and advisory; raw confidence is uncalibrated.
- `mssr_semantic_evidence_synthesis_preview` rereads exact sources and creates an immutable, relation-aware preview. The text is assembled from source ranges; it does not generate new paragraphs or perform generative compaction. Conflicts, stale evidence, unverified judgments, or unknown comparability remain review-only. Bridge never applies the preview to project files.

The composed workflow is explicit retrieval → Jev selection (when requested) → exact fetch → typed relation review → optional reversible preview → independent host verification. Jev does not search beyond the host-supplied corpus, establish truth, grant permissions, execute tools, or write files. Deterministic source assembly is distinct from model-authored prose generation.

## Source and privacy boundary

Each call requires a Git project root containing the canonical `.mssr/project-context.json`. Sources must be explicit, project-relative UTF-8 Markdown paths. Bridge caps each source at 2 MB, each batch at 4 MB and 32 files, and each semantic operation at the packaged MSSR limits. It validates the resolved canonical target as well as the requested path, so an internal symlink or junction cannot alias `data/`, `logs/`, `.git/`, `.bridge/`, `node_modules/`, `.mssr/runtime/`, or sensitive-looking paths. Absolute paths, traversal, and colon-containing paths (including Windows Alternate Data Streams) are rejected.

Live Jev selection and relation review may incur account usage. On Windows, Bridge reads the `TypeSafe:MSSR:JevLab` credential from Windows Credential Manager on demand through `scripts/read-windows-credential.ps1`. `BRIDGE_MSSR_JEV_CREDENTIAL_TARGET` can select a different target and `BRIDGE_MSSR_JEV_MODEL` can select a model. The API endpoint is pinned to `https://api.typesafe.ai`; inherited `TYPESAFE_BASE_URL` configuration cannot redirect the credential. The API key is not accepted in MCP arguments, copied to an environment file, logged, or placed in telemetry. If the credential is absent, a Jev operation fails with a generic unavailable message; other Bridge tools remain available.

## Evaluation evidence and limits

The 2026-10-01 live exact-handle smoke used three frozen real MSSR document cases. Jev selected the author-preferred handle in 3/3 cases and exact fetch passed 3/3. Blind review found each selected passage useful but also found overlapping equivalent ranges, so this is an integration smoke, not retrieval recall or general decision quality. A selected answer with score 0.42 was judged valid; the scores are uncalibrated and do not support a 0.5 threshold.

An earlier four-pair real-evidence run found all expected retrieval passages in top five but none top one, and Jev matched 3/4 author-created exploratory relation labels. It included no adjudicated contradiction-positive pair, so contradiction precision/recall remains unmeasured. The frozen run records live use of the actual provider; neither run authorizes automatic merges or writes.

The live Bridge runtime reported version 0.6.144, boot `b39f841c-6d96-4df1-a05e-98879004df61`, and 185 tools. The isolated Jev candidate generates a 181-tool catalog; the four additional live tools are `binary_file_attach`, `image_chat_preview_prepare`, `project_reference_resolve`, and `mssr_skill_maintenance_index`, present in the shared mixed checkout. The live processes observed through `C:\Dev\bridge-mcp` resolve through the valid junction to `D:\Dev\bridge-mcp`; they are not the isolated candidate worktree. Keep that runtime/candidate distinction explicit until the extra tools and the candidate's separate Dashboard verification failure are reconciled.

## Ignored runtime data

`data/` and `logs/` remain outside Git and protected from this Librarian adapter. A historical metadata-only inventory of the Bridge checkout found 10,675 files totaling about 1.69 GB. Jev reviewed only an aggregated, path-free summary against the repository's preserve-by-default rule: preserving/classifying was supported, deletion contradicted the rule, and the inventory alone did not justify deletion. Those answers are unverified guidance; no file-level retention or deletion decision follows from them.

Use deterministic cache/storage tools and explicit owner, activity, freshness, and regeneration evidence to review runtime data. Keep protected stores unless their owning policy authorizes bounded pruning. Never treat Jev confidence as a deletion threshold or as permission to mutate canonical data.

## Source and package ownership

Portable semantic behavior is versioned in `D:\Dev\mssr`. This Bridge candidate consumes the exact local MSSR 0.2.96 tarball in `vendor/` (SHA-256 `e9d3af566d3a1a334f0b66ec87a2cdaeccac3e1af45a90b6ba51c19f4b3c78a5`); source tarball and vendored bytes must match before runtime adoption. `TOOLS.md` is generated from `src/tool-registry.ts` and the module schemas.
