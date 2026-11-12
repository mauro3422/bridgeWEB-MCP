# Handoff — Bambu Studio / Bridge (2026-11-09)

## Incidente observado
Durante consulta desde ChatGPT, la herramienta `bambu_window_status` figuró en el catálogo accesible, pero su invocación devolvió `Unknown tool`. También se observó latencia elevada en operaciones de lectura y recuperación de previews.

## Hipótesis del usuario (NO confirmada)
La impresora Bambu podría haber estado apagada. Verificar si el estado offline influye; **`Unknown tool` indica en principio un problema de registro/exposición/ruteo de herramientas, no demuestra que la impresora esté apagada**. Distinguir estado de impresora, Bambu Studio, proveedor MCP y Bridge.

## Comportamiento solicitado
Cuando la impresora esté apagada o desconectada, devolver aviso explícito y comprensible (`impresora apagada o sin conexión`, solo si el diagnóstico lo sustenta), no `Unknown tool`. Si la herramienta no está registrada, reportar `herramienta no disponible` con causa y diagnóstico separado. No atribuir offline sin evidencia.

## Para Codex
1. Reproducir `bambu_window_status` con impresora encendida/apagada y Bambu Studio abierto/cerrado; comparar catálogo anunciado contra registro efectivo y errores.
2. Comprobar mapeo de nombres, lifecycle del proveedor y manejo de `Unknown tool`; añadir estado de conectividad con timeout acotado y errores tipados.
3. Medir latencia por fase (descubrimiento, routing MSSR, llamada MCP, transferencia de imagen) y registrar tiempos, trazas y posibles reintentos.
4. Agregar pruebas de regresión para offline, herramienta ausente, timeout y respuesta normal. No cambiar procesos ni configuración sin diagnóstico.

Estado: **la causa de la llamada original sigue sin confirmarse**. La discrepancia de ciclo de vida/catálogo del hijo Bambu de Bridge se reprodujo por separado y tiene una corrección local; su despliegue está pendiente. Este documento no prueba que la impresora estuviera offline.

## Auditoría de solo lectura — 2026-11-09

Alcance: sin cambios de producción, reinicios, interacción con Studio ni cambios de estado de la impresora. La causa del incidente y su corrección siguen pendientes.

### Catálogos y `Unknown tool`

- En esta sesión Codex, el catálogo del MCP directo `bambu_studio` incluye `bambu_window_status`; cuatro llamadas respondieron `ok: true`, `windows: []`, `count: 0`. La fuente del proveedor `D:\Dev\bambu-studio-mcp\server.py` declara el nombre (línea 228) y lo despacha (línea 516). `bambu_server_status` informó huellas de código cargado y disponible iguales (`868425cb…ddb4a00`), estado `current`; su alcance excluye Studio, dependencias y conectividad de impresora. Esto verifica el proveedor directo de Codex, no la instancia hija de Bridge ni la sesión de ChatGPT del incidente.
- El código local de Bridge 0.6.184, `src/tools/bambu-mcp-connection.ts`, registra `bambu_mcp_status`, `bambu_mcp_tool_list` y `bambu_mcp_tool_call`. El último consulta el catálogo del proveedor, exige `toolName` y `confirmToolName` idénticos y llama al proveedor con ese nombre. `src/bridge-server.ts` genera `Unknown tool: <name>` cuando el nombre no está en el registro modular de Bridge. Por tanto, confundir un nombre del catálogo del proveedor con una herramienta top-level de Bridge es una hipótesis concreta, no una causa probada: falta la petición y el error completos originales, y la identidad/catálogo de la instancia de Bridge usada entonces.
- Una consulta manual de `tools/list` a HTTP con protocolo `2026-07-28` devolvió HTTP 400; no se obtuvo catálogo live de Bridge y no se infiere su contenido ni un desajuste efectivo de ChatGPT a partir de ese intento. El catálogo que ChatGPT anunció y la invocación original no son accesibles desde esta sesión. En ChatGPT, comparar el catálogo top-level real con `bambu_mcp_tool_list` y registrar el nombre y envoltorio exactos enviados, instancia y timestamps; no exponer credenciales. Para el camino proxy previsto, inspeccionar primero el esquema vivo y luego usar `bambu_mcp_tool_call` con `toolName` y `confirmToolName` iguales a `bambu_window_status` y `arguments: {}`.
- Cero ventanas no determina si la impresora está apagada. El alcance de `bambu_window_status` es ventanas de Studio; no debe presentar offline de impresora como resultado de esa consulta. Falta evidencia independiente de conectividad, y no se realizó la matriz encendido/apagado ni abierto/cerrado.

### Latencia y estado observado

- Cerca de `2026-11-09 04:56` Argentina, `/status` informó Bridge 0.6.184, PID 25664, boot `33419e3a-5914-417e-a38d-d4c71da987bf`, listo y almacenamiento listo; la solicitud tardó 307 ms medidos desde PowerShell. `/readyz` del túnel en 8081 devolvió `ready` en 16 ms. Son muestras puntuales locales, no prueban latencia extremo a extremo. `/status` informó máximo histórico de event-loop 6730 ms, 41 stalls y último stall `2026-11-08T16:32:23.070Z`; no hay correlación demostrada con este incidente.
- Las tres llamadas directas secuenciales de control a `bambu_window_status` tardaron 2138, 5 y 6 ms medidos alrededor del wrapper de herramientas de Codex. Otra llamada concurrente con `bambu_server_status` tardó 2588 ms; la concurrencia y el transporte impiden atribuir esa cifra al proveedor. No son tiempos de Bridge, MSSR, ChatGPT ni de previews y no identifican una causa. Medir con IDs y timestamps correlacionados descubrimiento, routing, dispatch/proveedor y transferencia de imagen en el recorrido original; distinguir frío/caliente y evitar interpretar salud como garantía de latencia por llamada.

### Límites y siguiente paso

El MCP local de MSSR no figuró en el catálogo disponible de esta sesión: se aplicó el protocolo local `mssr-agent-routing`, `systematic-debugging` y `capability-gap-recovery`, y se consultó el core `.mssr/` local; no se generó una traza estructurada MSSR. `Get-CimInstance` devolvió acceso denegado, por lo que no se verificaron argumentos ni identidad de procesos por esa vía. Los datos de estado y rutas en documentos históricos difieren del readback actual y no deben tomarse como estado vivo. Sin reiniciar ni alterar producción, obtener evidencia de la sesión ChatGPT y del catálogo live de Bridge por su host autorizado; después repetir el caso fallido y medir las fases. Las pruebas de regresión y cualquier cambio de comportamiento quedan para una intervención posterior autorizada.

## Readback y actualización — 2026-11-12

- El MCP Bambu directo informa huella cargada y disponible idénticas (`c24c917d88e8080464fa2e026245916f0a6cf04a5e743e458d52a0ae94275f44`) y estado `current`. `bambu_window_status` responde `ok: true`, `windows: []`, `count: 0`. Es una observación de ventanas de Studio en este momento; no comprueba conectividad de impresora ni explica la llamada histórica.
- El hijo Bambu conectado al Bridge se inició el 2026-11-11 y anunció 47 herramientas; la fuente actual v0.12.0 anuncia una herramienta adicional. La sesión directa Bambu de Codex y el hijo de Bridge son procesos distintos.
- Bridge 0.6.185 añade `bambu_mcp_reconnect` para reemplazar solo el hijo stdio Bambu y conservar la sesión anterior si el candidato falla. El contrato y pruebas usan un proveedor ficticio. La función todavía no está disponible en el HTTP activo 0.6.184; requiere activar esa revisión una vez.
- No se recuperó el payload, identidad de sesión ni error completo de la llamada ChatGPT original. Tras activar, el siguiente paso para cerrar este incidente es comparar el nombre exacto top-level con `bambu_mcp_tool_list` y llamar por `bambu_mcp_tool_call` con confirmación idéntica. Mantener la causa del `Unknown tool` como no probada hasta reproducirla.
- No se interactuó con Studio ni se consultó la impresora; no se hicieron cambios de foco, AMS o impresión.
