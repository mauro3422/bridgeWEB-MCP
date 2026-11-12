# Handoff — Reconexión selectiva del proveedor Bambu MCP

**Actualizado:** 2026-11-12 (America/Argentina/Buenos_Aires)
**Owner:** `D:\Dev\bridge-mcp`, adaptador MCP del Bridge. Bambu sigue siendo dueño de sus herramientas y comportamiento.
**Estado:** implementación 0.6.185 activada y verificada; pruebas de contrato pasan. El reinicio completo de Bridge del 2026-11-12 19:33 UTC terminó el proceso hijo anterior. La lista local de procesos no encontró un hijo bajo el PID nuevo; el adaptador crea el proveedor bajo demanda con la primera llamada Bambu, por lo que falta verificar el nuevo proceso y catálogo desde el host autorizado.

## Problema y evidencia

- El Bridge retenía un único cliente stdio Bambu en `current`; editar `D:\Dev\bambu-studio-mcp\server.py` no reiniciaba el proceso ni refrescaba su catálogo.
- El proceso hijo del Bridge se conectó el 2026-11-11 y anunció 47 herramientas. La fuente local actual es Bambu MCP v0.12.0 y contiene `bambu_filament_profile_draft_save`; el MCP directo de Codex informa la huella actual `c24c917d88e8080464fa2e026245916f0a6cf04a5e743e458d52a0ae94275f44`. Son procesos distintos.
- En el readback previo a la activación, Bridge HTTP 0.6.184 y el túnel 8081 estaban listos. El árbol `main` era el único worktree registrado; los cambios locales de image-import y archivos untracked de otras tareas se preservaron fuera del release.

## Contrato implementado

- `bambu_mcp_reconnect` exige la confirmación literal `RECONNECT_BAMBU_PROVIDER`. `force` permite recuperación explícita si la huella fuente no cambió; sin cambios, la operación es un no-op idempotente.
- El servidor está limitado a la ruta configurada y allowlisted de Bambu; el llamador no puede pasar ruta ni comando. El proveedor candidato debe iniciar, completar MCP initialize y responder `tools/list` antes del reemplazo.
- La sesión vieja sigue disponible si el inicio candidato falla. Tras el swap, llamadas nuevas usan la sesión nueva; las llamadas viejas se drenan hasta 10 segundos y luego terminan antes de cerrar su transporte. El cierre afecta solo el proceso stdio propiedad del adaptador Bambu.
- `bambu_mcp_status` y `bambu_mcp_tool_list` exponen versión del proveedor, `connectedAt`, generación, conteo y huellas SHA-256 de fuente y catálogo. La reconexión informa herramientas añadidas/eliminadas, motivo y estado del último intento.
- No se reinician Bridge HTTP, túnel, Studio, AMS ni impresora; no se manda input al escritorio ni se imprime. Este control no instala presets ni cambia estado de impresora.

## Verificación

- `npm run check`, `npm run test:bambu-proxy-contract`, `npm run test:mcp-dual-era`, `npm run test:http:isolated`, `npm run docs:tools:check` y `npm run test:regressions` pasaron.
- El proveedor MCP ficticio v1→v2 cubre descubrimiento, drenaje de llamada en vuelo, refresh concurrente, no-op por fuente idéntica, confirmación, timeout de initialize y conservación de la sesión sana tras fallas.
- Las pruebas no acceden a Bambu Studio ni a la impresora. En ese readback de verificación del candidato, el HTTP activo permanecía en 0.6.184; la versión 0.6.185 se activó después, el 2026-11-12.

## Activación inicial verificada — 2026-11-12, 14:50 UTC

- Después del reinicio del equipo, Bridge HTTP 0.6.185 quedó activo en PID `14488`, boot `705f8218-6b50-4e50-8284-f3be02da75e6`, iniciado `2026-11-12T14:50:03.746Z`. `/status` y `/readyz` informaron listo; el proceso pertenece al watchdog documentado PID `15424`.
- El túnel `127.0.0.1:8081/readyz` también informó `ready`. El catálogo HTTP MCP contiene 195 herramientas, incluida `bambu_mcp_reconnect`.
- El hijo Bambu informa `bambu-studio-mcp` v0.12.0, 48 herramientas, generación 1 y `sourceChanged=false`; `sourceFingerprint` y `liveSourceFingerprint` coinciden. El host ya inició el proveedor actualizado, por eso no se llamó reconnect ni se forzó un reinicio adicional.
- El MCP Bambu directo de Codex también informó fuente `current`; `bambu_window_status` devolvió `windows: []`. Solo indica que no se enumeraron ventanas de Studio; la conectividad de impresora es desconocida.
- No se interactuó con Bambu Studio, AMS ni la impresora y no se inició ninguna impresión. La activación inicial queda cerrada; las futuras actualizaciones del hijo pueden usar `bambu_mcp_reconnect` sin reiniciar Bridge HTTP ni el túnel.

## Readback tras reinicio completo — 2026-11-12, 19:33 UTC

- El watchdog confirmó `restart-full` para la solicitud `3941e6dd-5ab5-4088-9263-f9d25a417f39`. Bridge HTTP 0.6.185 está listo con PID `26100` y boot `af13f224-3575-43d3-a9c2-984cd889f941`; el túnel 8081 también está listo.
- El proceso Bambu anterior terminó con HTTP. No se observó un hijo bajo el PID nuevo de Bridge: el adaptador lo inicia al pedir `bambu_mcp_status`, `bambu_mcp_tool_list` o `bambu_mcp_tool_call`. La salud del hijo/catálogo tras este reinicio sigue pendiente de lectura en el host autorizado.
- Studio, AMS, impresora y trabajos de impresión no se tocaron.

## Handoff relacionado

`docs/HANDOFF_BAMBU_WINDOW_STATUS_2026-11-09.md` conserva pendiente la causa del `Unknown tool` original: no se recuperó el nombre/wrapper exacto de la llamada de ChatGPT. La reconexión arregla la discrepancia de catálogo del proveedor, pero no prueba por sí sola qué produjo aquel error.
