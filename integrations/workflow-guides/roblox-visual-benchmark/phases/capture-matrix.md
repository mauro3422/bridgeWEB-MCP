# capture-matrix

## Goal

Capturar todas las combinaciones requeridas con progreso incremental y recuperación.

## Instructions

Seleccionar explícitamente el Studio correcto antes de preparar, exportar, capturar o limpiar. Hacer una captura warm-up descartable antes de la matriz. Guardar cada imagen inmediatamente con bytes, hash, cámara, fase, estado e intento. Reanudar imágenes válidas. Reintentar una captura aislada sin borrar las anteriores. Aceptar JSON con o sin BOM. Un timeout de screen_capture no debe cerrar automáticamente la sesión MCP; hacerlo puede desconectar el host WebSocket y provocar falsos fallos en cascada.
