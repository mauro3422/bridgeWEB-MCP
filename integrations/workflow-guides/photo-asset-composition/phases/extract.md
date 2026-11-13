# extract

## Goal

Extraer background, máscara y assets individuales con procedencia.

## Instructions

Guardar original inmutable, baseline aprobado, asset RGBA con alfa REAL, máscara y manifest de fuente/tamaño; tipos: carretes por color/marca, vasos, clickers azul arriba/transparente centro/blanco base, llavero argolla-cadena-herraje. Preview o recorte rectangular no implica PNG con alfa real; verificar bytes. Para guardar desde ChatGPT Web a PC, usar archivos materializados/autorizados en `files` top-level de `bridge_tool_action` delegado a `image_asset_import_files` con `targets` de escritura en `arguments`, NO IDs sueltos o Base64 ni URLs inventadas; verificar SHA-256 vía `binary_file_info`. Mantener baseline y fuentes inmutables. No extraer recursos externos con licencia incierta sin distinguir referencia de activo reutilizable.
