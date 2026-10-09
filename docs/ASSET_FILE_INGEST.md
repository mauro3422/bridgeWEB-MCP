# Bridge: importación de archivos de ChatGPT

## Propósito

`asset_import_files` copia archivos adjuntos/autorizados por ChatGPT al equipo MauroPrime con sus bytes originales. Cubre imágenes, audio, video, documentos, archivos comprimidos, `.blend` y otros bytes. No interpreta, descomprime, ejecuta ni instala el contenido. Para flujos de imagen con validación visual y preparación Blender, sigue existiendo `image_asset_import_files` y el pipeline de referencias.

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

El módulo está portado a la rama de desarrollo basada en Bridge 0.6.161. La producción observada sigue en Bridge 0.6.161 / MSSR 0.2.110, que expone `image_asset_import_files` pero aún no `asset_import_files`. No se reinició el proceso ni se afirma que archivos reales hayan llegado al disco. La activación requiere primero pasar los gates de esta rama, construir el paquete 0.6.162 y hacer un restart controlado con readback del catálogo; después puede requerir que ChatGPT vuelva a escanear/refrescar el catálogo para exponer `files` directamente.
