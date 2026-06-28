# AGENTS.md

Guía de trabajo para agentes que operen este repo.

## Proyecto

`bridge-mcp` es un MCP local propio para operar MauroPrime desde ChatGPT mediante OpenAI Secure MCP Tunnel.

Stack principal:

- Node.js / TypeScript
- `@modelcontextprotocol/sdk`
- `zod`
- MCP por stdio y Streamable HTTP
- OpenAI Secure MCP Tunnel con `tunnel-client`
- métricas locales con `node:sqlite`

Ruta principal del repo:

```text
C:\dev\bridge-mcp
```

## Estado recomendado

Modo actual recomendado:

```text
HTTP production-candidate
```

Arquitectura:

```text
ChatGPT
  -> Secure MCP Tunnel
  -> bridge-local-http
  -> http://127.0.0.1:3001/mcp
  -> bridge-mcp en MauroPrime
```

`stdio` sigue disponible como rollback.

## Reglas de seguridad

- No tocar perfiles de túnel estables sin dejar rollback.
- No commitear secretos, tokens, `.env`, logs ni bases SQLite.
- No borrar backups ni scripts de rollback.
- No matar procesos del bridge sin verificar cómo volver a levantarlo.
- No reemplazar archivos grandes a ciegas; preferir patches puntuales.
- Antes de cambiar código de transporte MCP, probar handshake completo.

## Comandos obligatorios antes de commitear

Desde `C:\dev\bridge-mcp`:

```powershell
npm run check
npm run build
```

Para HTTP:

```powershell
.\scripts\test-bridge-http.ps1
Invoke-RestMethod http://127.0.0.1:3001/status
Invoke-RestMethod http://127.0.0.1:8081/readyz
```

## Watchdog HTTP

Arranque manual recomendado:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bridge-http-watchdog.ps1 `
  -ProjectRoot C:\dev\bridge-mcp `
  -Profile bridge-local-http `
  -TunnelBaseUrl http://127.0.0.1:8081
```

Health esperado:

```text
http://127.0.0.1:3001/readyz -> ready
http://127.0.0.1:8081/readyz -> ready
```

Diagnóstico seguro sin matar procesos:

```powershell
.\scripts\bridge-doctor.ps1
```

Limpieza segura de procesos dev/test, primero en modo simulación:

```powershell
.\scripts\clean-bridge-dev-processes.ps1
.\scripts\clean-bridge-dev-processes.ps1 -Apply
```

El watchdog HTTP usa protección singleton. No arrancar otro watchdog production encima del activo salvo que se esté haciendo una prueba controlada con `-NoTunnel`, `-Once`, `-DryRun` o `-AllowDuplicate`.

## Rollback stdio

Si HTTP falla, volver a stdio:

```powershell
cd C:\dev\bridge-mcp
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bridge-watchdog.ps1 -ProjectRoot C:\dev\bridge-mcp
```

Perfil estable histórico:

```text
bridge-local -> stdio
```

Perfil HTTP production-candidate:

```text
bridge-local-http -> http://127.0.0.1:3001/mcp
```

## Métricas

Archivos runtime ignorados por Git:

```text
logs/bridge-events.jsonl
data/bridge-metrics.sqlite
```

Consultas:

```powershell
node .\scripts\query-bridge-metrics.mjs status
node .\scripts\query-bridge-metrics.mjs summary 50
node .\scripts\query-bridge-metrics.mjs recent 25
node .\scripts\query-bridge-metrics.mjs errors 25
```

## Visualizaciones

El módulo `src/visualizations.ts` genera specs para gráficos renderizables en ChatGPT.

Tools relacionadas:

```text
bridge_visualization_catalog
bridge_visualize_metrics
```

Tipos disponibles:

```text
calls_by_tool
avg_duration_by_tool
errors_by_tool
activity_timeline
success_mix
```

## Dashboard local

Dashboard navegador local:

```text
http://127.0.0.1:3001/dashboard
```

No confundir con widgets internos de ChatGPT. La UI local sirve para MauroPrime; las cards internas del chat se generan desde specs de visualización.

## Flujo de trabajo recomendado

1. Leer `README.md` y `HTTP_LOCAL_MCP.md`.
2. Verificar estado con `/status` y `/readyz`.
3. Hacer cambios pequeños y testeables.
4. Ejecutar `npm run check` y `npm run build`.
5. Probar HTTP si se tocó transporte, métricas o tools.
6. Commitear con mensaje corto y claro.
7. Pushear sólo si el estado queda estable.

## Convenciones

- Preferir TypeScript estricto y funciones pequeñas.
- Mantener herramientas peligrosas explícitas y auditables.
- Los scripts PowerShell deben ser copy-paste friendly.
- Los logs deben ayudar a diagnosticar sin filtrar secretos.
- Las métricas deben guardar nombres, tiempos y estados, no argumentos crudos.

## Notas para agentes futuros

Mauro usa este bridge como “mini-Codex” local. Priorizar estabilidad sobre features rápidas. Si hay duda entre probar y asumir, probar. Si el puente se cae, recuperar primero el acceso y recién después seguir programando.
