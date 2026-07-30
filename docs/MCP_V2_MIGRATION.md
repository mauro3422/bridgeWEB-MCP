# MCP TypeScript SDK v2 migration

## Current decision

Bridge 0.6.51 serves both protocol eras from `/mcp`:

- the existing monolithic SDK v1 (`@modelcontextprotocol/sdk` 1.30) remains the sessionful 2025-era route used by current ChatGPT Web traffic;
- stable split SDK v2 packages serve explicit `2026-07-28` envelope traffic through a strict modern handler.

Installing the v2 packages alone does not change wire behavior. Bridge opts in only after the SDK's `isLegacyRequest` classifier assigns the request to the modern route.

## Why this is a staged migration

The production Bridge currently owns:

- sessionful Streamable HTTP lifecycle and bounded session reclamation;
- per-session caller and trace correlation;
- a stdio rollback route;
- legacy HTTP smoke tests that require `initialize`, `initialized`, `Mcp-Session-Id`, and session deletion.

Protocol `2026-07-28` removes the protocol handshake and `Mcp-Session-Id`. Its HTTP entry creates a fresh server per request and carries client identity, capabilities, protocol version, and trace metadata on each request. Replacing the current transport directly would discard validated lifecycle and attribution behavior.

## Implemented architecture

Use a dual-era endpoint:

1. The existing sessionful v1 HTTP handler remains the legacy route.
2. The v2 packages live alongside v1; SDK objects never cross between them.
3. Requests classified by `isLegacyRequest` go to the existing handler.
4. Modern envelope-bearing requests go to `createMcpHandler(factory, { legacy: "reject" })`, adapted to Node with `toNodeHandler`.
5. Preserve explicit Bridge application handles and MSSR trace recovery independently of protocol sessions.
6. Adopt modern per-request client metadata and W3C Trace Context as attribution inputs, without claiming model, effort, project, or conversation values the host does not expose.
7. `tools/list` cache hints remain deferred until ChatGPT refresh behavior and dynamic provider invalidation are observable.

Both routes construct the same Bridge tool registry and use the same call pipeline. `/status` reports legacy and modern request totals separately. Modern requests are stateless at the MCP session layer and must carry the revision and client capabilities in `_meta`; the SDK also validates `MCP-Protocol-Version` and `Mcp-Method` against the body.

## Required gates

- v1 check, build, regressions, stdio smoke, HTTP handshake, session release, dashboard, metrics, and tunnel health remain green.
- `npm run test:mcp-dual-era` covers `server/discover`, `tools/list`, invalid header/body disagreement, absence of modern session ids, and legacy initialization.
- A safe modern tool call and same-trace MSSR continuation remain the next focused gate before declaring modern ChatGPT-host compatibility.
- A live tunnel test proves both a current ChatGPT Web conversation and a refreshed conversation can list and call tools.
- Rollback remains the current v1 sessionful endpoint and stdio watchdog.

## References

- MCP TypeScript SDK: `docs/migration/upgrade-to-v2.md`
- MCP TypeScript SDK: `docs/migration/support-2026-07-28.md`
- MCP protocol release: `2026-07-28`
