# verify-equivalence

## Goal

Ejecutar la matriz completa de sintaxis, tests, build, runtime y regresión visual.

## Instructions

Regenerar outputs desde las plantillas canónicas. Ejecutar tests dirigidos y completos, verificador estático y browser real. Revisar consola, navegación, responsive y rutas profundas.

Comparar con exactamente los mismos datos, viewport, ruta y estado inicial. Usar hash de captura sólo cuando el render sea determinista; ante variación de rasterizado o antialiasing, combinar DOM normalizado, diff de píxeles acotado y región de diferencia antes de declarar regresión. No ocultar diferencias funcionales eliminando nodos salvo metadata de carga explícitamente esperada, como los `<script>` reorganizados por la modularización.
