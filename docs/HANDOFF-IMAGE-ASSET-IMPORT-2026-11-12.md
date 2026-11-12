# Handoff técnico — importación de imágenes ChatGPT → MauroPrime (2026-11-12)

## Hallazgo reproducido
- El conector directo `image_asset_import_files` y `asset_import_files` aparece con `files: string[]`, pero el runtime espera `OpenAIFile[]` con `file_id` y `download_url`. Al pasar un ID como `files: ["file_..."]`, Bridge devuelve `invalid_type expected object received string`; el problema está en la transformación de parámetro del host/conector, no en que la herramienta falte.
- **Ruta que SÍ funciona sin instalar ni crear tools:** llamar `bridge_tool_action` con `toolName=confirmToolName="image_asset_import_files"`, archivo autorizado en el parámetro `files` **top-level**, y `arguments={targets:[{outputPath:...}], overwrite:false}`. Si el identificador de Biblioteca no se transforma, usar un archivo previamente materializado por la herramienta Files de ChatGPT y pasar su ruta del contenedor como parámetro superior `files`; el host inserta el objeto autorizado. No introducir `files` dentro de `arguments` ni transformar manualmente a Base64.
- Se importaron y verificaron **6 fotos originales, 1 baseline sintético aprobado y 1 recorte de referencia** originalmente al laboratorio, pero el dueño comercial ya estaba definido: originales en `D:\Dev\Auro-3D\compras\flexi\evidencias\2026-11-11` (manifiesto y hashes) y baseline/recorte copiados y verificados bajo `D:\Dev\Auro-3D\marketing\fotoproductos\compra-flexi-2026-11-11`. La copia educativa es histórica, NO autoridad del marketing.
- Para imágenes, `asset_import_files` puede fallar con `[unsafe-url]` aunque `image_asset_import_files` sí descargue. **No relajar allowlist/SSRF ni interpolar URLs.**

## Segundo fallo y corrección fuente (desplegada; prueba con archivo real pendiente)
- Algunos PNG generados son etiquetados por el host como `application/octet-stream` aunque sus bytes, firma y extensión correspondan a PNG. Bridge acepta esa declaración genérica después de inspeccionar y validar la imagen; los MIME explícitos contradictorios siguen rechazados.
- Las pruebas locales en `scripts/test-image-file-import.mjs` cubren PNG 1×1 genérico y rechazo de `image/jpeg` contradictorio sin crear el archivo. `npm run test:image-file-import` y la regresión completa pasaron antes de publicar 0.6.185.
- Readback de activación inicial 2026-11-12, 14:50 UTC: Bridge HTTP 0.6.185 estaba activo (PID `14488`, boot `705f8218-6b50-4e50-8284-f3be02da75e6`), `/readyz=ready`, túnel 8081 listo y catálogo de 195 herramientas. La corrección está desplegada, pero no se ejecutó una importación real con MIME genérico durante esa activación.
- El workaround materializado + parámetro superior `files` ya había funcionado sin restart. No reimportar ni sobrescribir las fotos comerciales existentes.

## Estado de handoff — 2026-11-12

Bridge 0.6.185 quedó activo y listo tras el reinicio del equipo. El arreglo de MIME está desplegado. Sigue pendiente una prueba de importación en runtime con un archivo ChatGPT autorizado etiquetado genéricamente como `application/octet-stream`, verificación SHA-256 del destino y comprobación de que no hubo overwrite. No se reimportaron imágenes ni se sobrescribieron archivos comerciales en esta sesión.

## Readback tras reinicio completo — 2026-11-12, 19:33 UTC

- El watchdog confirmó `restart-full` para `3941e6dd-5ab5-4088-9263-f9d25a417f39`. Bridge HTTP 0.6.185 volvió con PID `26100`, boot `af13f224-3575-43d3-a9c2-984cd889f941` y `/readyz=ready`; túnel 8081 también `ready`.
- El gate de importación real con `application/octet-stream`, comparación de bytes/SHA-256 del destino y no-overwrite sigue pendiente. Este reinicio no generó ni importó archivos.

## Próximo trabajo agente
1. Continuar trabajo fotográfico comercial desde `D:\Dev\Auro-3D\marketing\fotoproductos\compra-flexi-2026-11-11\HANDOFF-MSSR.md`; AURO 3D es dueño canónico, no el laboratorio educativo. Usar `photo-asset-composition` y una traza MSSR propia del proyecto propietario. Proyecto MSSR documenta la prevención de errores de dueño en `D:\Dev\mssr\docs\CROSS_REPO_OWNERSHIP_TRANSACTION_HANDOFF_2026-11-12.md` (propuesta, guardia automática aún pendiente).
2. Con Bridge 0.6.185 ya activo, verificar el MIME genérico mediante una importación autorizada y leer de vuelta los hashes de destino. No usar imágenes comerciales existentes para reimportación ni sobrescribir archivos; si no hay archivo autorizado de prueba, dejar este gate pendiente.
3. Para otra transferencia usar `bridge_tool_action` top-level `files`, y verificar hash de cada destino. Las seis fuentes y baseline ya están en disco: evitar reimportación/sobrescritura.

**Trazas investigativas:** laboratorio `mssr-20261112025410-0e415e63-b65`, código Bridge `mssr-20261112030126-9470318e-088`. Son evidencia histórica, no se deben presentar como sesión de Codex iniciada ni reutilizar sobre otro projectRoot.
