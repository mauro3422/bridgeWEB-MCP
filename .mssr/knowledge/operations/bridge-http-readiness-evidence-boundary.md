# Bridge HTTP child readiness and lost-response evidence boundary

## HTTP child readiness and lost-response evidence invariant

Tests and live smokes after build/watchdog transitions must treat endpoint availability as a bounded readiness condition; an earlier successful request does not guarantee the next one. Distinguish temporary connection refusal from an exited child and preserve its exit code/output in test evidence. A lost MCP response, 502, timeout, or `request terminated without response` also does not prove the underlying operation failed: inspect Bridge metrics, terminal/process state, or another authoritative receipt before retrying work that could duplicate side effects.

Watchdog recovery evidence must not depend only on `/readyz` or `/status`, because both share the HTTP event loop under investigation. Before replacing an alive-but-unready child, capture bounded external metadata: PID/parent, start/uptime, sampled CPU, working/private memory, thread/handle counts and listener ownership; use `/status` only as supplemental evidence. Preserve the managed exit code when the child already exited. Never store command lines, raw output, prompts or secrets in this diagnostic evidence. Recovery proves service restoration, not root cause.
