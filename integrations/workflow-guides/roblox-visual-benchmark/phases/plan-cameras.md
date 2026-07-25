# plan-cameras

## Goal

Diseñar cámaras repetibles según bounds, defecto investigado y contexto de uso.

## Instructions

Para modelos, props y carriers estáticos, preferir un turnaround de cámara fija:

1. Resolver bounds exclusivos del sujeto y construir un volumen conservador para todo el giro usando `max(width, depth)` en ambos ejes horizontales.
2. Calcular una sola cámara hero desde las ocho esquinas, el FOV y el aspect ratio reales.
3. Mantener idénticos posición, `lookAt`, FOV y distancia para frontal, tres cuartos, lateral y trasera.
4. Girar únicamente el objeto sobre su pivote base con yaw 0°, 45°, 90° y 180°.
5. Restaurar el pivote original después del lote.
6. Usar una cámara superior separada sólo cuando la huella, la corona, las conexiones o la distribución superficial sean relevantes.

Para VFX, animación, sujetos transparentes o defectos locales, se permiten cámaras por vista cuando el turnaround fijo no represente correctamente el fenómeno. Registrar explícitamente la estrategia elegida.

Mantener nombres, FOV, posiciones, `lookAt`, viewport y firma de cámara idénticos entre versiones comparables. Si una toma incluye sujetos ajenos, encuadra mal o cambia cámara cuando debía girar el objeto, clasificarlo como fallo de cámara y no usarla para juzgar el artefacto.
