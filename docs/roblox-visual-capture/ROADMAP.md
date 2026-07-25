# Roblox Visual Capture Reliability Roadmap

**Fecha base:** 2026-07-23  
**Documento rector:** `PLAN.md`

## Estado general

| Fase | Estado | Resultado esperado |
|---|---|---|
| R0 — diagnóstico y contrato | completo | causa, backend principal y reglas documentadas |
| R1 — notificaciones efímeras | en implementación | anomalías entregadas automáticamente una vez |
| R2 — capture job resiliente | pendiente | una llamada lógica, secuencial, retries por shot |
| R3 — watchdog de Studio | pendiente | preflight/runtime/postflight y recuperación acotada |
| R4 — photo booth adaptable | parcialmente existente | staging y cámaras adaptativas verificadas |
| R5 — objeto de prueba N | pendiente | fixture determinista con matriz fotográfica |
| R6 — dashboard y handoff | pendiente | ingestión/verificación sin probes temporales |
| R7 — skill/MSSR | pendiente | guía y routing reflejan el sistema real |

## R0 — Diagnóstico y contrato

- [x] Separar fallos de transporte de defectos artísticos.
- [x] Confirmar que `CaptureService` y el watcher local son la ruta interna principal.
- [x] Mantener captura de ventana únicamente como fallback explícito.
- [x] Confirmar ejecución secuencial dentro de un solo Client.
- [x] Documentar estados `complete`, `partial`, `failed` y `cancelled`.
- [x] Documentar autoridad de PNG estable, no de callback.

**Salida:** `docs/roblox-visual-capture/PLAN.md`.

## R1 — Notificaciones efímeras del Bridge

### Entregable mínimo

- [ ] Crear cola acotada con TTL, deduplicación y contador de ocurrencias.
- [ ] Permitir que una herramienta emita avisos internos sin exponer campos privados.
- [ ] Agregar avisos automáticos por error, llamada lenta y respuesta excesiva.
- [ ] Entregar `bridgeNotices` en la respuesta de la siguiente herramienta y drenar la cola.
- [ ] Agregar `bridge_notice_status` y `bridge_notice_drain`.
- [ ] Propagar avisos a través de `bridge_tool_query/action`.
- [ ] Añadir pruebas de entrega única, expiración y deduplicación.

### Criterio de salida

Un aviso inyectado se ve exactamente una vez en una respuesta, desaparece de `status` después de entregarse y conserva un `occurrences` correcto cuando se repite.

## R2 — Capture job resiliente

### Entregable mínimo

- [ ] Exponer `roblox_photo_capture_job` como una sola herramienta Bridge.
- [ ] Reusar `capture_service_bundle.mjs`, sin crear otro solver.
- [ ] Ejecutar vistas secuencialmente dentro de una sola sesión Play Client.
- [ ] Implementar `retriesPerShot` y `shotTimeoutMs`.
- [ ] Preservar capturas exitosas cuando otra falla.
- [ ] Escribir manifest schema v2 con intentos y errores por toma.
- [ ] Detectar hashes repetidos inesperados.
- [ ] Copiar cada PNG de forma atómica.
- [ ] Devolver `complete`, `partial` o `failed` sin perder el manifest.
- [ ] Emitir avisos por retry, partial, hash repetido y cleanup incompleto.

### Criterio de salida

Una falla simulada en una sola vista produce un retry local; las demás vistas no se repiten y el job termina con manifest coherente.

## R3 — Watchdog de Studio

### Preflight

- [ ] conexión y catálogo saludables;
- [ ] Studio exacto activo;
- [ ] inicio en Edit;
- [ ] plan, rig, sujeto y marcadores válidos;
- [ ] rutas de salida escribibles.

### Runtime

- [ ] confirmar Client antes de cada intento;
- [ ] registrar heartbeat por shot;
- [ ] recuperar selección activa cuando desaparece temporalmente;
- [ ] no mover cámara hasta que el watcher reclama el PNG anterior;
- [ ] timeout independiente de RPC y archivo.

### Postflight

- [ ] detener Play en éxito, parcial o error;
- [ ] destruir módulo temporal;
- [ ] verificar retorno a Edit;
- [ ] emitir aviso si queda estado sucio.

### Criterio de salida

Una excepción deliberada no deja Play activo ni bloquea la conexión serializada.

## R4 — Photo booth adaptable

### Existente a conservar

- [x] `Workspace.VisualPhotoRig` regenerable.
- [x] un solo `RuntimeSubject`.
- [x] floor/background neutrales.
- [x] solver por ocho esquinas.
- [x] ajuste con viewport real.
- [x] matriz de formas extremas.

### Refuerzos

- [ ] dimensionar cabina según bounds y cámara máxima;
- [ ] versionar preset de iluminación/fondo;
- [ ] validar ocupación visible después del primer probe;
- [ ] registrar contaminación y overlays;
- [ ] garantizar limpieza idempotente.

### Criterio de salida

El fixture N y los casos ancho/alto/largo/plano caben sin recortes y con ocupación útil.

## R5 — VisualCaptureTestObject_N

- [ ] Crear fixture determinista y transitorio.
- [ ] Incluir silueta asimétrica, parte alta, brazo largo, satélite y detalle fino.
- [ ] Registrar `BenchmarkForward` y atributos de fixture.
- [ ] Generar plan con front, three-quarter, side, top y detail.
- [ ] Ejecutar job completo.
- [ ] Simular un fallo/retry sin alterar las otras vistas.
- [ ] Confirmar hashes distintos.
- [ ] Adjuntar masters con `image_file_attach` y revisar encuadre.
- [ ] Limpiar fixture y rig temporal.

### Criterio de salida

Cinco masters válidos, distintos, sin foco robado y con manifest `complete`; la prueba de retry produce `partial` o recuperación documentada según configuración.

## R6 — Dashboard y handoff

- [ ] Auditar las fotos V8/V8.1/V8.2 y separarlas entre probes y run canónico.
- [ ] No publicar capturas de ventana como master limpio.
- [ ] Actualizar builder para schema v2 si es necesario.
- [ ] Mostrar estado técnico separado de clasificación artística.
- [ ] Reutilizar una sola foto representativa por run histórico cuando corresponda.
- [ ] Reconstruir dashboard.
- [ ] Ejecutar verificación estática y Chrome headless/runtime.
- [ ] Confirmar conteos, archivos faltantes y hashes inconsistentes en cero.

### Criterio de salida

El dashboard refleja sólo evidencia canónica, abre masters correctos y no presenta probes accidentales como versiones aprobadas.

## R7 — Skill, guía y MSSR

- [ ] Actualizar `roblox-photo-rig-capture` con job, retry, watchdog y notificaciones.
- [ ] Actualizar la guía `roblox-object-driven-visual-review`.
- [ ] Actualizar `roblox-visual-benchmark` donde corresponda.
- [ ] Añadir fixtures de routing para “sacar fotos”, “reintentar vistas” y “no robar foco”.
- [ ] Ejecutar auditoría MSSR viva.
- [ ] Regenerar documentación de tools.

### Criterio de salida

Routing selecciona la skill correcta, la implementación coincide con la guía y todas las regresiones pasan.

## Orden de ejecución inmediato

1. R1 — notificaciones efímeras.
2. R2 — job resiliente y manifest v2.
3. R3 — watchdog y cleanup.
4. R5 — fixture N y prueba real.
5. R4 — ajustes de cabina revelados por N.
6. R6 — dashboard.
7. R7 — cierre documental/routing y verificación global.

## Riesgos abiertos

- `CaptureService` puede variar en tiempos de escritura del PNG.
- Un Client puede perder temporalmente su registro al cambiar Play/Edit.
- Los callbacks pueden no confirmar aunque el archivo sí exista.
- El dashboard actual puede asumir schema v1.
- `StudioCaptureService` requiere contexto de plugin y permiso; queda como backend futuro, no requisito del MVP.
- El fallback de ventana puede robar foco; sólo se activa con aprobación explícita.
