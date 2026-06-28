# Conectar bridge-mcp con ChatGPT por OpenAI Secure MCP Tunnel

Estado local:

```text
C:\dev\bridge-mcp
node dist/index.js
```

El servidor MCP ya responde por stdio y fue probado con `scripts/smoke.mjs`.

## Lo que falta conseguir desde UI

Necesitás dos valores:

```text
CONTROL_PLANE_API_KEY = sk-...
TUNNEL_ID = tunnel_...
```

La API key se crea con el flujo seguro de OpenAI Platform. No pegarla en ChatGPT.

El `tunnel_id` se crea en OpenAI Platform → Tunnel settings.
## Comandos base

Cuando tengas la key y el tunnel id:

```powershell
Set-Location C:\dev\bridge-mcp
$env:CONTROL_PLANE_API_KEY="sk-..."
$tunnelId="tunnel_..."

# Ajustar si tunnel-client.exe está en otra ruta.
tunnel-client init `
  --sample sample_mcp_stdio_local `
  --profile bridge-local `
  --tunnel-id $tunnelId `
  --mcp-command "node C:\dev\bridge-mcp\dist\index.js"

tunnel-client doctor --profile bridge-local --explain
tunnel-client run --profile bridge-local
```

## En ChatGPT

1. Settings → Apps / Connectors.
2. Advanced settings → Developer mode ON.
3. Create connector/app.
4. Connection: Tunnel.
5. Elegir o pegar el `tunnel_id`.
6. Crear.
7. En un chat nuevo, abrir `+` / Developer mode y seleccionar `bridge-mcp`.
