# Bambu Studio — provider MCP independiente

## Arquitectura

El servidor MCP es un proyecto autónomo: `D:\Dev\bambu-studio-mcp\server.py`.

MauroPrime Bridge es **cliente** de este servidor mediante el SDK MCP y el transporte `stdio`. El adaptador vive en `src/tools/bambu-tools.ts`; no contiene ningún algoritmo de 3MF ni de renderizado.

```text
ChatGPT → Bridge MCP (bambu_* tools)
             ↓ stdio MCP client
         bambu-studio-mcp/server.py
             ├─ bambu_probe.py  (ZIP / 3MF / objetos / partes / texto)
             └─ bambu_render.py (render ortográfico headless / Pillow)
```

Se puede conectar cualquier otro cliente MCP directamente a `python D:\Dev\bambu-studio-mcp\server.py`. Para despliegues portátiles, configurar `BRIDGE_BAMBU_MCP_SERVER_PATH` y opcionalmente `BRIDGE_BAMBU_MCP_PYTHON`.

## Herramientas

Consulta (read-only):

- `bambu_mcp_status`: conexión al MCP independiente.
- `bambu_mcp_tool_list`: catálogo real del servidor proveedor.
- `bambu_project_inspect`: objetos, partes, dimensiones, transforms, textos y negative parts desde el 3MF guardado.
- `bambu_project_diagnose`: negativas sin intersección de sus cajas con geometría positiva (heurístico, sin rebanar).
- `bambu_project_compare`: diferencias estructurales entre dos 3MF guardados.
- `bambu_window_status`: estado de ventanas, sin cambiar foco.

Generación de evidencias (crea PNGs, no modifica el proyecto):

- `bambu_offscreen_views_save`: vistas superior, isométrica, frontal y lateral desde geometría 3MF aun con Bambu minimizado.
- `bambu_saved_views_save`: miniaturas ya incluidas en 3MF.
- `bambu_capture_save`: captura del área de Bambu, solo visible y en primer plano; no captura escritorio entero y no roba foco.

**Limitaciones explícitas:** ninguna herramienta accede a modificaciones no guardadas, guarda la ventana Bambu, modifica geometría ni acciona impresoras. El render fuera de pantalla es reconstrucción 3D, no captura literal GPU de Bambu; visualiza las partes negativas como volúmenes diagnósticos sin realizar CSG. El diagnóstico por bounding boxes no sustituye comprobar la rebanada.

## QA y activación

```powershell
cd D:\Dev\bambu-studio-mcp
python -m unittest discover -s tests -v

cd D:\Dev\bridge-mcp-mssr-0.2.112-query-variants
npm run check
node node_modules\typescript\bin\tsc --outDir .bridge\bambu-stage-dist
set BAMBU_BRIDGE_TEST_BUILD=.bridge\bambu-stage-dist&& node scripts\test-bambu-standalone-proxy.mjs
```

No reiniciar el Bridge activo por cambios de docs. Para activar una versión nueva del código, primero QA, preservar rollback/estados, compilar desde el `BridgeCodeRoot` real y usar el watchdog con `bridge_request_restart`, comprobando `bridge_health` y el catálogo posterior.

## Activación verificada (2026-10-22)

- Build del Bridge 0.6.180, `npm run check` y prueba de extremo a extremo con SDK Cliente MCP: **PASS**.
- Rollback de `dist` anterior conservado fuera del checkout antes de despliegue; reinicio HTTP solicitado mediante watchdog (request `5e904c85-0e17-4f0a-9b3a-72c8c83f53a9`).
- Bridge regresó con boot `74a78a55-e408-40c5-9df0-3db6fa1b20e5` y **198 tools**, incluidas 9 entradas `bambu_*`. El proveedor externo informó **7 tools** y la consulta live de `bambu_project_inspect` + `bambu_project_diagnose` fue correcta.
- Código portable en repo independiente `D:\Dev\bambu-studio-mcp`, commit inicial `aeddc58`. Sin cambios de perfil del túnel, sin despliegue remoto ni controles de impresora.
- Si el conector ChatGPT mantiene el catálogo viejo, descubrir el schema runtime con `bridge_tool_schema` y utilizar `bridge_tool_query` para las consultas read-only; el runtime nuevo ya las admite.
