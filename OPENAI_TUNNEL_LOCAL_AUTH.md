# OpenAI Secure MCP Tunnel local auth model

## Decision

`bridge-mcp` keeps the HTTP MCP server local-only and no-auth at the MCP listener layer.

The security boundary is:

```text
ChatGPT / OpenAI product
  -> OpenAI Secure MCP Tunnel control plane
  -> tunnel-client authenticated with runtime key and tunnel permissions
  -> localhost-only bridge-mcp HTTP listener
```

The local HTTP listener is not a public API and must remain bound to loopback by default.

## Why this is valid for this project

OpenAI Secure MCP Tunnel is intended for private MCP servers running on a developer machine, on-premises, or behind access controls. The private MCP server does not need a public listener; `tunnel-client` runs where it can reach the MCP server and forwards MCP requests locally.

The OpenAI `tunnel-client` documentation also provides a built-in profile sample named:

```text
sample_mcp_remote_no_auth
```

That sample is explicitly for HTTP MCP servers that do not advertise OAuth / Protected Resource Metadata. For this local bridge, that is the correct profile family.

## What `oauth_metadata` means here

`tunnel-client doctor` probes OAuth Protected Resource Metadata for diagnostics. For OAuth-protected MCP servers, `authorization_servers[0]` from Protected Resource Metadata is used as the source of truth for auth-server metadata enrichment.

`bridge-mcp` is intentionally not OAuth-protected at the local listener. Therefore it should not pretend to expose OAuth metadata.

Expected behavior for local no-auth mode:

```text
GET /.well-known/oauth-protected-resource/mcp -> 404
```

That 404 is not an application bug for this project. It means the local MCP listener is not advertising OAuth.

## Hard requirements

Keep these true:

```text
BRIDGE_MCP_HTTP_HOST defaults to 127.0.0.1
BRIDGE_MCP_HTTP_ALLOW_REMOTE is false by default
bridge-local-http profile uses sample_mcp_remote_no_auth
no OAuth metadata endpoint is implemented unless real OAuth is added later
no public port, no Worker, no VPS required
```

## If OAuth is added later

Only add OAuth if a real authorization server exists and the product flow needs it. Do not add fake metadata just to silence diagnostics.

A real OAuth design would need:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
authorization endpoint
token endpoint
client registration or fixed client config
clear browser-flow reachability
```

That is intentionally out of scope for the current local-first bridge.
