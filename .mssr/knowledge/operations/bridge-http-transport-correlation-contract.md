# Bridge HTTP transport correlation contract

The HTTP/tunnel connection contract must avoid stale pooled-socket races: the Bridge keep-alive window must outlive the tunnel client's normal idle reuse window, with headers timeout above the combined keep-alive timeout plus buffer. Bridge 0.6.126 uses 120 seconds keep-alive, a 5-second keep-alive buffer, and a 130-second headers timeout. A tunnel 502 must be correlated with local `POST /mcp` no-status evidence before attributing it to the Bridge transport; reclaimed MCP sessions remain a separate 404 lifecycle case.
