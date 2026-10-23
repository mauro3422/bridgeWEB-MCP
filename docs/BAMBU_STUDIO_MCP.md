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

## Mejoras de texto negativo y cámaras ortográficas (2026-10-23)

- Nuevo `bambu_text_cut_diagnose` (read-only): comprueba si la parte de texto negativo persiste en el 3MF tras `Fusionar`, identifica su tipo, posiciones 3D, e intersecciones XYZ con `Merged Parts`. Una parte negativa enterrada puede dejar de verse en «Preparar» sin haber desaparecido; la verificación del grabado real se hace **laminando**.
- `bambu_offscreen_views_save` ahora admite `top,bottom,front,rear,left,right,isometric` y alias de compatibilidad `side`. Son renders ortográficos desde **el archivo guardado**, sin manipular foco ni cámara de la app.
- Selección en el viewport Bambu: `Ctrl + clic` para varios objetos, `Alt + clic` para partes internas; para volúmenes negativos invisibles, elegir exactamente la fila `Proceso > Objetos`.
- Atajos de vistas señalados en guías Bambu Studio, sujetos a versión: Ctrl+1..7 = superior, inferior, frontal, trasera, izquierda, derecha, isométrica. Verificar en Ayuda > Atajos del programa instalado.
- Límites: intersección de cajas no demuestra operación booleana real; el render offline no representa los píxeles originales de Bambu; las ediciones sin guardar no se inspeccionan.
- Pruebas: standalone `python -m unittest discover -s tests -v` **8/8 PASS**; Bridge `npm run check`, `npm run build`, `node scripts/test-bambu-standalone-proxy.mjs` PASS, incluyendo nuevo diagnóstico y vistas top/front/right/isometric.

## Slicer toolpath diagnostics v0.2.0 — actual `.gcode.3mf`

El usuario confirmó que `3D Tech` desaparece **también en Previsualización tras Fusionar**, aunque `text_shape` negativo continúa en el 3MF. La inspección de bounding boxes no alcanza. El proveedor MCP independiente ahora expone cuatro funciones nuevas:

- `bambu_slice_inspect` (**read-only**): abre exportación `.gcode` o `.gcode.3mf` con `Metadata/plate_N.gcode`, extrae movimientos de extrusión reales y capas Z. No acepta falso positivo de archivo 3MF editable sin G-code.
- `bambu_slice_layer_render`: crea PNG ortográfico por capa desde trayectorias G-code reales, no captura de ventana.
- `bambu_slice_text_diagnose`: cruza caja de texto editable guardada con G-code de placa exportada, mide segmentos/recorridos sobre esa región y captura hasta tres capas de Z dentro del texto.
- `bambu_slice_compare` (**read-only estricto en Bridge**): compara `antes.gcode.3mf` vs `despues.gcode.3mf`, con restricción opcional a `projectPath` y `text`. No escribe archivos.
- `bambu_slice_compare_images_save` (**escritura explícita en Bridge**): genera además un par de PNG con la misma región de la capa que mayor diferencia presenta. El proveedor independiente tiene `bambu_slice_compare` con `outputDir` opcional y está etiquetado como herramienta con efectos de escritura.

Flujo desde la app: Archivo → Exportar → Exportar archivo laminado de placa (o equivalente localizado, Ctrl+G donde exista). Exportar con nombres distintos la pieza **sin fusionar** y la **fusionada**. Conservar 3MF del diseño y no reescribir. El MCP puede inspeccionar la exportación en segundo plano sin cambiar el foco. No hay acceso a la caché de rebanado sin exportar ni control de UI automática en v0.2.0.

QA: prueba sintética con M83, M82, G92, G90/G91, 2 capas, extracción ZIP G-code, rechazo de proyecto no laminado, generación PNG y comparación de zona; proveedor suite 15/15 PASS y Bridge check/build/proxy smoke PASS. Pruebas contra G-code **real del llavero aún pendientes de exportación**.

## Bambu cache QA provider v0.3.0 — portable case builder and general XYZ analysis

Bridge consumes the **standalone** MCP in `D:\Dev\bambu-studio-mcp`; its TypeScript code is only an SDK stdio proxy. The v0.3.0 provider now exposes cache/variant workflows:

- `bambu_cache_discover` (query) → read-only matching `%TEMP%/bamboo_model` sessions whose `origin.txt` exactly resolves to requested saved 3MF; returns checksummed cache scene and temporary sliced `.gcode`.
- `bambu_cache_slice_snapshot_save` (action) → copy newest existing G-code with SHA-256 verification and timestamp in QA directory. It **does not press Slice Plate**.
- `bambu_case_pair_prepare_save` (action) → self-contained QA file A (saved defect) + file B (recovered cached candidate with companion nested zip `.model` meshes) + optional cached sliced G-code, with separate provenance/timestamp gap and `structuralRegression.lostNegativeTextInSaved`. Never label B as proved working without slicing.
- `bambu_slice_region_inspect` (query) + `bambu_slice_region_images_save` (action) → actual existing sliced G-code analysis by coordinates `minX/maxX/minY/maxY/minZ/maxZ` or `projectPath` with `objectName`, `partName` or `text`.
- `bambu_slice_region_compare` (query) + `bambu_slice_region_compare_images_save` (action) → A/B G-code differences with XY + Z filter for any selected region, not text-only.

**Real Auro case evidence (2026-10-23):** source saved defect has `Merged Parts` positive and `Genérico-Cilindro` negative but **no** `3D Tech`. Matching Bambu cache at `Thu_Oct_22/23_07_14#3004#210` has `text_shape` negative `3D Tech` in addition to merged positive and cylinder. Two independent QA 3MF files created under `qa/bambu/cases/Llavero_Auro-20261023T011053-6e71dad`, cache G-code copied separately. Cache 3MF timestamp +33.25s vs cache G-code: **not valid to assign that G-code as verified B slice**. Provider G-code snapshot includes 25 Z layers, 8087 linear deposit segments (169 arcs omitted). No independent B slice has been created/validated yet.

Testing and safety: no GUI focus changes or Bambu project mutations; temp caches are private implementation artifacts, not official APIs. Python unit suite 18/18 PASS; Bridge `npm run check`, `npm run build`, `node scripts/test-bambu-standalone-proxy.mjs` PASS in staging, including XYZ-Z comparisons. CLI headless slicing support was located in official Bambu Studio wiki, but Windows CLI behavior cannot yet be established as safe/noninteractive on user's installed build, so **automatic fresh slicing is not implemented or claimed**.
