# Changelog

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
