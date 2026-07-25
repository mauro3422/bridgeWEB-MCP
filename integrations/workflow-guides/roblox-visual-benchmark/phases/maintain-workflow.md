# maintain-workflow

## Goal

Convertir fricción repetida en mejoras transversales sin sobreajustar a un proyecto.

## Instructions

Registrar errores del pipeline por categoría. Mejorar el workflow cuando el mismo tipo de fallo sea reproducible o afecte la confiabilidad: BOM, selección de Studio, warm-up, timeouts, reanudación, `isError`, cleanup, hashes, MIME/extensión, FOV, aspect ratio, stage contamination y restauración del pivote.

Cuando una sesión demuestre un camino más robusto, trasladar la mejora al nivel correcto:

- perfil de cámara para defaults de poses y márgenes;
- solver para matemática de bounds y firmas comparables;
- servicio Roblox para mutaciones reversibles de cámara/objeto;
- bundle de captura para orquestación, archivos y manifiestos;
- cleaner para derivados seguros sin alterar masters;
- skill para criterio operativo reusable;
- guía MSSR para activación y coordinación transversal.

El turnaround estático probado debe conservar estas invariantes: cámara hero fija, yaw del objeto registrado, top separado opcional, masters inmutables, review sin UI, hashes distintos, pivote restaurado y dashboard verificado. No promover una solución manual o una captura aislada como automatización completa.

Mantener rutas específicas en guías de proyecto o configuración, no en esta guía global. Validar activación con pedidos visuales —incluidos “cámara fija”, “girar el objeto”, “cabina de fotos” y “varias poses”— y rechazo con tareas no visuales.


## Escalamiento por señales, no por rutina

No cargar mantenimiento de workflow para cada pedido de poses o comparación visual. El flujo normal debe seguir siendo corto. Escalar a esta fase y combinar con `systematic-debugging` cuando se observe al menos una señal dura o la misma señal blanda se repita dos veces:

### Señales duras

- ownership conflict: `RUN_LOCKED`, mismo `runId` con escritores distintos o crítica completa degradada;
- shared-client conflict: dos runs controlando una única instancia de Studio, cámara, Play state o CaptureService;
- lifecycle contradiction: Studio queda en Play o temporales permanecen después de un cleanup reportado como exitoso;
- image-truth contradiction: metadata dice UI/world limpio pero el archivo lo contradice, o dashboard muestra raw cuando debe mostrar review;
- evidence identity failure: poses incompatibles comparten hash, firma stale o target/cámara sin cambio;
- promotion regression: gate pasa de `ready-to-persist` a pendiente/bloqueado sin una mutación o reset explícito;
- ingestion contradiction: captura canónica completa pero run ausente, hash/ruta incorrecta o verificadores estático/runtime en desacuerdo.

### Secuencia de mantenimiento

```text
pausar iteración artística
→ preservar raw + última crítica completa
→ reproducir el mínimo fallo
→ trazar ownership / lifecycle / state / transport / persistence
→ corregir la capa más baja responsable
→ añadir test de regresión
→ ejecutar entrada canónica
→ comprobar Studio Edit + locks liberados
→ volver al benchmark artístico
```

El arreglo se promueve a skill/guía global sólo cuando el patrón es transversal o reproducible fuera del run concreto. Rutas, nombres de archivos y defaults exclusivos del proyecto permanecen en su guía local.

## Contrato transversal de exclusión y promoción

Cuando una única aplicación cliente comparte cámara y estado mutable, usar dos locks distintos:

- lock de run para archivos y crítica de un `runId`;
- lock global de sesión para cámara, Play state y backend de captura.

La crítica completa debe vivir en un sidecar autoritativo y no competir con metadata regenerable. Una promoción visual requiere un cierre fresco y coherente: backend canónico, masters inmutables, derivados limpios, vistas distintas, crítica completa, run registrado, gate listo, verificadores aprobados, cliente restaurado y locks liberados. Un gate histórico queda invalidado ante una contradicción posterior.

## Evidence catalog maintenance

Promote a catalog rule globally when it is independent of one project: technical package is not logical asset identity; revision labels are scoped to their track; state/time precedes camera in temporal collections; timestamps and numeric order are written by the producer; legacy inference is labeled; cover selection uses an explicit representative policy. Treat track collapse, stage mixing, chronology loss, invalid cover and manifest/runtime disagreement as ingestion/catalog incidents. Correct metadata or dashboard ingestion without recapturing valid masters.
