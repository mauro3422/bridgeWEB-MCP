# Changelog

## 0.6.12 - 2026-07-25

- Added `whiteboard_add_text`, `whiteboard_add_svg`, `whiteboard_add_diagram`, and `whiteboard_insert_image` for writing into ChatGPT's separate TabletWhiteboard layer.
- Structured diagrams support rectangles, ellipses, lines, arrows, polylines, polygons, labels, and quadratic/cubic Bézier SVG paths.
- Existing local PNG, JPEG, and WebP files can be inserted after Bridge path-policy, size, MIME, and signature validation.
- SVG writes are sanitized by TabletWhiteboard and reject scripts, event handlers, links, embedded resources, CSS, and unsafe SVG elements.
- Expanded the whiteboard regression suite to verify seven tools, request payloads, Bézier preservation, image bytes, MIME, placement, and SHA-256.
## 0.6.11 - 2026-07-24

- Added read-only `skill_route_vocabulary`, exposing the canonical closed MSSR enums before routing metadata or fixtures are authored.
- Fixed `git_commit_all` to stage large path sets through NUL-delimited stdin pathspecs instead of expanding every filename into the Windows argument vector.
- Fixed `git_show_commit` and `git_compare_branches` to avoid safe-path expansion, while retaining bounded sensitive-path exclusions and an explicit degraded-filter flag when exclusions themselves exceed the safe argument budget.
- Added a real 320-file long-path Git regression covering commit, show and branch comparison.
- Filtered synthetic `__test_*` and legacy `metrics_regression` events from operational metrics summaries, recent calls, timelines, errors and slowest-call views.
- Fixed Bridge skill frontmatter extraction so ordinary `name:` and `description:` fields use whitespace matching instead of requiring a literal backslash; the registry now preserves descriptions and regression-tests parser parity.
- Made successful Bridge routing tests compact by default and reduced duplicate live-provider work to 10 adapter integration cases; MSSR remains the owner of the full 83-case semantic suite, while `--full-integration` preserves exhaustive Bridge replay when explicitly needed.
- Expanded the generated registry to 116 tools.


## 0.6.10 - 2026-07-24

- Integrated verified TabletWhiteboard capture integrity, origin/board validation and LAN allowlisting.
- Added Roblox visual-capture diagnostics, notices, deterministic Photo Rig support and 115-tool generated documentation.
- Made release consistency derive from package metadata instead of hard-coded regression versions, while keeping live-version verification as a post-restart gate.
- Closed the skill-routing test MCP client explicitly so successful fixtures terminate without leaking an open process handle.

## 0.6.9 - 2026-07-23

- Extracted the MSSR engine, routing contract, fixtures, audit and canonical documentation to the independent `C:\Dev\mssr` repository.
- Bridge now consumes `@mauroprime/mssr` and remains the ChatGPT/local/Roblox integration adapter.
- Added compatibility entrypoints so Bridge routing tools and verification continue to use the canonical MSSR contract.
- Added read-only `image_file_attach` for direct full-quality PNG/JPEG/WebP inspection through MCP image content, with batch support, dimensions, SHA-256 verification and original-byte preservation.
- Updated visual-review workflows to avoid manual Base64, binary chunk reads, temporary HTTP servers, tunnels and tiny recompressed previews when local image attachment is available.

## 0.6.8 - 2026-07-23

- Added mandatory semantic `signals` to MSSR intent classification, with backward-compatible `nominal` normalization and no automatic conversion of generic fallback ambiguity into an incident.
- Added deterministic verification and maintenance phase inference for errors, degradation, uncertainty, recovery needs, repeated friction, workarounds, skill gaps, and reusable patterns.
- Added routing and regression fixtures for Roblox MCP incidents, nominal Roblox work, contextual continuations, and maintenance closure.
- Added the routed `roblox-mcp-incident-recovery` procedure from the versioned MauroPrime skills repository.
- Hardened Roblox Studio MCP discovery with explicit `healthy`, `degraded`, and `unavailable` source state, bounded retry, discovery-only cache, and nonzero live-catalog verification.
- Hardened multi-client StudioMCP lifecycle and ownership diagnostics while preserving valid direct and Bridge-managed routes.
