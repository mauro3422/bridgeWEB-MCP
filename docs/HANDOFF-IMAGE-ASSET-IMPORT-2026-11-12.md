# Handoff técnico — importación de imágenes ChatGPT → MauroPrime (2026-11-12)

## Hallazgo reproducido
- El conector directo `image_asset_import_files` y `asset_import_files` aparece con `files: string[]`, pero el runtime espera `OpenAIFile[]` con `file_id` y `download_url`. Al pasar un ID como `files: ["file_..."]`, Bridge devuelve `invalid_type expected object received string`; el problema está en la transformación de parámetro del host/conector, no en que la herramienta falte.
- **Ruta que SÍ funciona sin instalar ni crear tools:** llamar `bridge_tool_action` con `toolName=confirmToolName="image_asset_import_files"`, archivo autorizado en el parámetro `files` **top-level**, y `arguments={targets:[{outputPath:...}], overwrite:false}`. Si el identificador de Biblioteca no se transforma, usar un archivo previamente materializado por la herramienta Files de ChatGPT y pasar su ruta del contenedor como parámetro superior `files`; el host inserta el objeto autorizado. No introducir `files` dentro de `arguments` ni transformar manualmente a Base64.
- Se importaron y verificaron **6 fotos originales, 1 baseline sintético aprobado y 1 recorte de referencia** originalmente al laboratorio, pero el dueño comercial ya estaba definido: originales en `D:\Dev\Auro-3D\compras\flexi\evidencias\2026-11-11` (manifiesto y hashes) y baseline/recorte copiados y verificados bajo `D:\Dev\Auro-3D\marketing\fotoproductos\compra-flexi-2026-11-11`. La copia educativa es histórica, NO autoridad del marketing.
- Para imágenes, `asset_import_files` puede fallar con `[unsafe-url]` aunque `image_asset_import_files` sí descargue. **No relajar allowlist/SSRF ni interpolar URLs.**

## Segundo fallo y corrección fuente (verificada localmente; despliegue pendiente)
- Algunos PNG generados son etiquetados por el host `application/octet-stream` aun cuando sus bytes/firma/extensión son PNG reales; runtime anterior rechaza con `[expected-integrity-mismatch] File MIME mismatch ... declared application/octet-stream, measured image/png`.
- En `src/tools/image-tools.ts`, dentro de `downloadFileImage`, aceptar `application/octet-stream` como declaración genérica/no específica; **mantener rechazo del MIME explícito contradictorio** y `inspectImageBytes` obligatorio para firma, extensión y dimensiones.
- Pruebas incorporadas a `scripts/test-image-file-import.mjs`: PNG 1×1 con `application/octet-stream` se importa exactamente, con `image/jpeg` se rechaza y no crea archivo.
- La corrección y regresiones están en `src/tools/image-tools.ts`, `src/tool-registry.ts` y `scripts/test-image-file-import.mjs`. En 0.6.185, `npm run test:image-file-import` y la regresión completa pasaron; los bytes PNG se mantienen exactos y el MIME explícito contradictorio sigue rechazado. **El HTTP activo sigue en 0.6.184**, por lo que el arreglo aún no está desplegado. Para cerrarlo, activar el release con el watchdog, confirmar `runtimeBootId` nuevo y probar un PNG genérico mediante conexión real. El workaround materializado+file param ya funcionó sin restart.
- No modificar worktrees de estabilización, túnel, perfiles, secretos ni reiniciar automáticamente mientras haya trabajo en progreso. Antes de despliegue: `AGENTS.md`, status runtime `bridge_health`, `git status`, pruebas handshake HTTP, estrategia de rollback.

## Estado de handoff — 2026-11-12

El código y el handoff se preservaron junto con la reconexión selectiva Bambu en Bridge 0.6.185. `npm run test:regressions`, HTTP/MCP aislados y documentación generada pasaron. No se reimportaron imágenes ni se sobrescribieron archivos comerciales. La comprobación local no cambia el estado del HTTP/túnel; la activación y prueba en runtime siguen pendientes.

## Próximo trabajo agente
1. Continuar trabajo fotográfico comercial desde `D:\Dev\Auro-3D\marketing\fotoproductos\compra-flexi-2026-11-11\HANDOFF-MSSR.md`; AURO 3D es dueño canónico, no el laboratorio educativo. Usar `photo-asset-composition` y una traza MSSR propia del proyecto propietario. Proyecto MSSR documenta la prevención de errores de dueño en `D:\Dev\mssr\docs\CROSS_REPO_OWNERSHIP_TRANSACTION_HANDOFF_2026-11-12.md` (propuesta, guardia automática aún pendiente).
2. Después de la actualización controlada del Bridge, comprobar el MIME genérico con la ruta de import autorizada y verificar rollback. No arrancar un segundo Bridge ni pedir imágenes nuevas por error de transporte.
3. Para otra transferencia usar `bridge_tool_action` top-level `files`, y verificar hash de cada destino. Las seis fuentes y baseline ya están en disco: evitar reimportación/sobrescritura.

**Trazas investigativas:** laboratorio `mssr-20261112025410-0e415e63-b65`, código Bridge `mssr-20261112030126-9470318e-088`. Son evidencia histórica, no se deben presentar como sesión de Codex iniciada ni reutilizar sobre otro projectRoot.
