# MCP TypeScript SDK v2 migration

## Current decision

Bridge 0.6.50 stays on the maintained monolithic SDK v1 line (`@modelcontextprotocol/sdk` 1.30) while the production HTTP endpoint remains sessionful and compatible with the existing Secure MCP Tunnel.

The split TypeScript SDK v2 packages are stable. Installing them alone does not enable protocol revision `2026-07-28`; modern wire behavior is an explicit opt-in.

## Why this is a staged migration

The production Bridge currently owns:

- sessionful Streamable HTTP lifecycle and bounded session reclamation;
- per-session caller and trace correlation;
- a stdio rollback route;
- legacy HTTP smoke tests that require `initialize`, `initialized`, `Mcp-Session-Id`, and session deletion.

Protocol `2026-07-28` removes the protocol handshake and `Mcp-Session-Id`. Its HTTP entry creates a fresh server per request and carries client identity, capabilities, protocol version, and trace metadata on each request. Replacing the current transport directly would discard validated lifecycle and attribution behavior.

## Compatible target

Use a dual-era endpoint:

1. Keep the existing sessionful v1 HTTP handler as the legacy route.
2. Add the v2 packages alongside v1 and keep SDK objects on their own side of the wire boundary.
3. Route requests classified as legacy to the existing handler.
4. Route modern envelope-bearing requests to `createMcpHandler(factory, { legacy: "reject" })`, adapted to Node with `toNodeHandler`.
5. Preserve explicit Bridge application handles and MSSR trace recovery independently of protocol sessions.
6. Adopt modern per-request client metadata and W3C Trace Context as attribution inputs, without claiming model, effort, project, or conversation values the host does not expose.
7. Add cache hints for `tools/list` only after verifying how ChatGPT refreshes the catalog and how Bridge invalidates dynamic provider changes.

## Required gates

- v1 check, build, regressions, stdio smoke, HTTP handshake, session release, dashboard, metrics, and tunnel health remain green.
- Modern in-process HTTP tests cover `server/discover`, `tools/list`, one tool call, invalid header/body disagreement, and a same-trace MSSR continuation.
- A live tunnel test proves both a current ChatGPT Web conversation and a refreshed conversation can list and call tools.
- Rollback remains the current v1 sessionful endpoint and stdio watchdog.

## References

- MCP TypeScript SDK: `docs/migration/upgrade-to-v2.md`
- MCP TypeScript SDK: `docs/migration/support-2026-07-28.md`
- MCP protocol release: `2026-07-28`
