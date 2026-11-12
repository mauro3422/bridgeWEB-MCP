# Handoff — Reconexión selectiva del proveedor Bambu MCP

**Actualizado:** 2026-11-12 (America/Argentina/Buenos_Aires)
**Owner:** `D:\Dev\bridge-mcp`, adaptador MCP del Bridge. Bambu sigue siendo dueño de sus herramientas y comportamiento.
**Estado:** implementación local en 0.6.185; pruebas de contrato pasan. La activación en el Bridge HTTP existente queda pendiente.

## Problema y evidencia

- El Bridge retenía un único cliente stdio Bambu en `current`; editar `D:\Dev\bambu-studio-mcp\server.py` no reiniciaba el proceso ni refrescaba su catálogo.
- El proceso hijo del Bridge se conectó el 2026-11-11 y anunció 47 herramientas. La fuente local actual es Bambu MCP v0.12.0 y contiene `bambu_filament_profile_draft_save`; el MCP directo de Codex informa la huella actual `c24c917d88e8080464fa2e026245916f0a6cf04a5e743e458d52a0ae94275f44`. Son procesos distintos.
- Bridge HTTP 0.6.184 y túnel 8081 estaban listos en el último readback. El árbol `main` era el único worktree registrado y seguía en el commit remoto; había cambios locales de image-import y archivos untracked de otras tareas, preservados fuera de este release.

## Contrato implementado

- `bambu_mcp_reconnect` exige la confirmación literal `RECONNECT_BAMBU_PROVIDER`. `force` permite recuperación explícita si la huella fuente no cambió; sin cambios, la operación es un no-op idempotente.
- El servidor está limitado a la ruta configurada y allowlisted de Bambu; el llamador no puede pasar ruta ni comando. El proveedor candidato debe iniciar, completar MCP initialize y responder `tools/list` antes del reemplazo.
- La sesión vieja sigue disponible si el inicio candidato falla. Tras el swap, llamadas nuevas usan la sesión nueva; las llamadas viejas se drenan hasta 10 segundos y luego terminan antes de cerrar su transporte. El cierre afecta solo el proceso stdio propiedad del adaptador Bambu.
- `bambu_mcp_status` y `bambu_mcp_tool_list` exponen versión del proveedor, `connectedAt`, generación, conteo y huellas SHA-256 de fuente y catálogo. La reconexión informa herramientas añadidas/eliminadas, motivo y estado del último intento.
- No se reinician Bridge HTTP, túnel, Studio, AMS ni impresora; no se manda input al escritorio ni se imprime. Este control no instala presets ni cambia estado de impresora.

## Verificación

- `npm run check`, `npm run test:bambu-proxy-contract`, `npm run test:mcp-dual-era`, `npm run test:http:isolated`, `npm run docs:tools:check` y `npm run test:regressions` pasaron.
- El proveedor MCP ficticio v1→v2 cubre descubrimiento, drenaje de llamada en vuelo, refresh concurrente, no-op por fuente idéntica, confirmación, timeout de initialize y conservación de la sesión sana tras fallas.
- Las pruebas no acceden a Bambu Studio ni a la impresora. El HTTP activo permanece en 0.6.184.

## Activación pendiente

El Bridge HTTP actual ya cargó el catálogo de herramientas al arrancar y no puede importar este cambio en caliente. Publicar por primera vez `bambu_mcp_reconnect` requiere una actualización/restart controlado del proceso HTTP de Bridge; es un corte único de despliegue. Una vez cargado, futuras actualizaciones Bambu se aplican con reconnect selectivo sin reiniciar Bridge ni el túnel. No se ha reiniciado ni desplegado producción durante esta tarea.

Antes de activar: verificar el diff exacto y las pruebas, confirmar el procedimiento de watchdog/rollback, registrar PID/boot y salud actuales, luego leer de vuelta el catálogo Bridge, llamar `bambu_mcp_tool_list` y probar una herramienta inocua de Bambu. Dejar Studio, AMS e impresión fuera de la prueba.

## Handoff relacionado

`docs/HANDOFF_BAMBU_WINDOW_STATUS_2026-11-09.md` conserva pendiente la causa del `Unknown tool` original: no se recuperó el nombre/wrapper exacto de la llamada de ChatGPT. La reconexión arregla la discrepancia de catálogo del proveedor, pero no prueba por sí sola qué produjo aquel error.
