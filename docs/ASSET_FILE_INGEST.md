# Bridge: importación de archivos de ChatGPT

## Propósito

`asset_import_files` copia archivos adjuntos/autorizados por ChatGPT al equipo MauroPrime con sus bytes originales. Cubre imágenes, audio, video, documentos, archivos comprimidos, `.blend` y otros bytes. No interpreta, descomprime, ejecuta ni instala el contenido. Para flujos de imagen con validación visual y preparación Blender, sigue existiendo `image_asset_import_files` y el pipeline de referencias.

## Prioridad de herramientas y biblioteca canónica (probado 2026-10-09)

**Destino por defecto para recursos reutilizables:** `D:\ChatGPT\Biblioteca`, organizado por formato y tema; detalles en `D:\ChatGPT\AGENTS.md` y `D:\ChatGPT\Biblioteca\README.md`. Los proyectos pueden recibir copias verificadas; no mover ni borrar originales. Guardar trazabilidad (nombre, tipo, origen, bytes y SHA-256) en `manifiestos`.

- **Imagen generada/editada o adjunta → `image_asset_import_files` PRIMERO**, con `files` top-level y `targets` locales. Conserva bytes, valida firma/MIME/dimensiones.
- **Audio, video, ZIP, PDF, documentos, modelos u otros → `asset_import_files`**, solamente si la URL temporal HTTPS suministrada por ChatGPT supera su política de host permitido; no ampliar indiscriminadamente la allowlist.
- **PC → ChatGPT:** `image_file_attach` para inspección visual, `binary_file_attach` para recursos arbitrarios.
- **Archivos ya en el PC:** `D:\ChatGPT\tools\import_local_asset.py` copia sin sobrescribir por SHA-256 hacia la Biblioteca; nunca mover ni recodificar.
- **Postflight de cualquiera de estas vías:** `binary_file_info` sobre cada destino final, comparar bytes/MIME/SHA-256 y escribir un manifiesto; `saved` sin readback NO alcanza.

**Fallo y recuperación reales:** la llamada a `asset_import_files` con dos imágenes ImageGen autorizadas devolvió `[unsafe-url] Download hostname not allowlisted` sin crear archivos. Sin relajar controles SSRF se reintentó mediante **`image_asset_import_files`**, que sí transfirió los dos PNG originales a `D:\Dev\blender-mcp\practice\references\mano_20261008` (anatomía 1.955.933 bytes, SHA-256 `6349a39f46d1348bc3843228984cfd77061f6353e37f12ca682bff751d3a8dee`; maqueta 1.921.099 bytes, SHA-256 `243a0b499496fb6eaf2e10fd35a42c45afd5a671288321fa66ced02bb40f27fa`). Ambas fuentes se copiaron intactas también a `D:\ChatGPT\Biblioteca\imagenes\referencias\blender\mano_20261009` y tienen manifiesto. Ese resultado NO implica que haya una nueva mano 3D aceptada.

Si falla el dominio con otro tipo de archivo, registrar el hostname sin los tokens de la URL, mantener `transfer-blocked` y revisar seguridad por separado. No inventar URL, usar Drive como bypass ni introducir Base64 de archivos autorizados en Blender.

## Contrato MCP

La tool recibe `files` como parámetro superior declarado en `_meta["openai/fileParams"]`. Cada elemento requiere `download_url` y `file_id`; `mime_type` y `file_name` son opcionales. `targets` debe tener un destino por archivo y puede declarar `expectedSha256` / `expectedBytes`. `manifestPath` es opcional. `overwrite` se mantiene por compatibilidad de schema, pero `true` se rechaza: la importación nunca reemplaza destinos existentes.

OpenAI define que el host inyecta este objeto autorizado y que la metadata lista el nombre del parámetro superior; no se acepta un `file_id` aislado ni una ruta del sandbox del cliente.

## Protección de datos y límites

- Sólo HTTPS en puerto estándar, sin credenciales en URL, con host incluido en `BRIDGE_ASSET_FILE_HOSTS` (por defecto `files.oaiusercontent.com`). No sigue redirecciones. Revalida las respuestas DNS contra rangos privados/especiales antes de solicitar el archivo.
- Limita cada archivo a 512 MiB, cada lote a 1 GiB y cada lote a ocho archivos. Aplica el presupuesto del lote mientras transmite y rechaza de antemano presupuestos declarados que ya excedan el máximo.
- Descarga por streaming a un temporal exclusivo junto al destino, calcula SHA-256 y MIME por firma, compara hash/tamaño declarados y confirma cada destino con hard link sin reemplazo. Ante fallo limpia temporales y destinos creados por ese lote.
- `resolveToolPath(access=write)` aplica la política de rutas del Bridge. La tool se anuncia como escritura destructiva y de mundo externo; la llamada requiere la decisión/confirmación normal del host.
- El manifiesto contiene ruta, tamaño, hash, MIME detectado, `file_id` y nombre de origen, pero nunca `download_url`.

Guardar un binario no equivale a instalar o ejecutar software. Los archivos comprimidos tampoco se extraen automáticamente.

## Verificación

`npm run check`, `npm run build`, `npm run test:asset-file-import`, `npm run test:mcp-dual-era` y `npm run docs:tools:check` cubren compilación, bytes exactos PNG/WAV/MP4, manifiesto, hash y MIME, protección de rutas, URLs inseguras, redirecciones, exceso de tamaño, presupuesto de lote, no sobrescritura, rollback completo y publicación del schema en HTTP `tools/list`.

## Estado de adopción

**Readback histórico 2026-10-09:** Bridge 0.6.162 / MSSR 0.2.110 expuso 187 tools, incluidas ambas herramientas de importación. Esa evidencia corresponde a esa versión; no describe el runtime actual.

**Readback actual 2026-10-11:** el release Bridge 0.6.171 / MSSR 0.2.127 está publicado en `origin/main` desde el source commit `e9d91c4`; el watchdog activo conserva `BridgeCodeRoot=D:\Dev\bridge-mcp-mssr-0.2.112-query-variants`, que ejecuta ese mismo source commit. Tras el reinicio HTTP controlado, el Bridge reportó boot `e25742ff-0461-4afc-8a2c-d0a39c84f649`, PID 4440, 189 tools y catálogo `a4ce81b07ca9c90c`; el túnel quedó `live/ready`.

El catálogo observable de esta conversación expone `asset_import_files`, `image_asset_import_files` y `bridge_request_restart`; sus schemas tienen `files` como parámetro superior en las dos herramientas de importación. `bridge_connector_catalog_compare` reconoció las tres herramientas contra el runtime (3/3). Esto sólo certifica la sesión/conector observado: en otra conversación hay que comprobar el schema de esa sesión. La transferencia real de las dos imágenes con hashes en disco sigue siendo la prueba de bytes; ver una tool en el catálogo no equivale a una transferencia nueva.

Para recuperar exposición directa, refrescar/reconectar el plugin o abrir una conversación con catálogo actualizado; observar primero `ALL_TOOLS`/catálogo real y después `bridge_tool_schema` y `bridge_connector_catalog_compare`. **No solicitar restart de Bridge por este problema**: el servidor ya está correcto. Si el host aún no expone archivos como fileParams, dejar `awaiting-file-parameter-exposure`, mantener las imágenes originales en Biblioteca y documentar el bloqueo.

**La transferencia real de ambas imágenes ImageGen SÍ se completó**: `binary_file_info` verificó tamaños y SHA-256 en `D:\Dev\blender-mcp\practice\references\mano_20261008`, y los originales también se guardaron sin cambios en `D:\ChatGPT\Biblioteca\imagenes\referencias\blender\mano_20261009`. Quedan por completar la autorización del modelo 3D, el empacado de imágenes fuente en una escena nueva y la revisión del viewport real de Blender.
