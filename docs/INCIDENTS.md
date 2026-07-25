# Bridge MCP incidents

Registro durable de fallos observables del Bridge, sus herramientas y su lifecycle. No contiene cadena de pensamiento ni transcripciones completas.

## Formato

Cada incidente debe incluir:

- fecha y estado;
- capa y owner;
- síntoma observable;
- reproducción mínima o evidencia exacta;
- causa demostrada, o `No resuelta`;
- corrección aplicada;
- prueba de regresión;
- seguimiento pendiente.

Registrar aquí los defectos propios de `bridge-mcp`. Los incidentes de routing/skills pertenecen a `C:\Dev\mssr\docs\skill-routing\INCIDENTS.md`; los defectos exclusivos de un proyecto pertenecen a su `.bridge/PROJECT_STATE.md`, `docs/INCIDENTS.md` o `BUGS.md`.

---

## 2026-07-25 — Guía propuesta aunque existía una skill propietaria

**Estado:** Corregido y verificado en el servicio vivo `0.6.14`.

**Capa / owner:** `src/tools/workflow-guide-tools.ts` y catálogo de skills del Bridge.

**Síntoma:** `project_context_load` y `workflow_guide_recommend` devolvían `propose_new` para una auditoría post-iteración, aunque `skill-maintenance-loop` ya cubría ese objetivo.

**Reproducción mínima:**

```text
Cuando terminemos una iteración larga registra los incidentes, bugs y fricción y arregla la skill propietaria.
```

**Causa:** `recommendGuide()` sólo comparaba workflow guides. La ausencia de una guía de dominio se interpretaba como ausencia de una capacidad reusable, sin consultar el catálogo de skills.

**Corrección:**

- el recomendador consulta skills Codex existentes;
- una coincidencia fuerte devuelve `use_existing_skill` y el nombre de la skill;
- `propose_new` queda reservado para tareas sin guía ni skill propietaria;
- las instrucciones del servidor ordenan usar `skill_load` para esa acción.

**Regresión:** `scripts/test-v060-tools.mjs` crea un catálogo aislado con `skill-maintenance-loop` y exige `use_existing_skill`.

**Seguimiento:** cerrado; `project_context_load` vivo devolvió `use_existing_skill` para `skill-maintenance-loop`.

---

## 2026-07-25 — Snapshot legacy sin manifiesto resoluble

**Estado:** Mitigado y diagnosticado; origen histórico atribuido a drift de versión.

**Capa / owner:** `src/tools/workspace-tools.ts`.

**Síntoma:** `workspace_diff` falló con `ENOENT` al buscar:

```text
C:\dev\bridge-mcp\data\workspace-snapshots\snapshot_1785002749168_19\manifest.json
```

**Evidencia:** el ID usa el formato histórico `snapshot_<timestamp>_<counter>`. La fuente y el servicio actuales generan IDs `YYYYMMDDhhmmss_<uuid>`; un snapshot actual (`20260725184413_e7bbb112-909`) fue creado, listado y comparado correctamente.

**Causa:** drift entre una implementación viva anterior y el contrato actual. No hay evidencia de que el escritor actual elimine manifiestos después de devolver éxito.

**Corrección:**

- `manifest.json` se escribe mediante archivo temporal y `rename` atómico;
- el manifiesto se lee y valida antes de devolver `created: true`;
- la respuesta incluye `verified: true` y `manifestPath`;
- IDs legacy o manifiestos ausentes devuelven una explicación accionable para crear un snapshot nuevo con el Bridge vivo actual.

**Regresión:** la suite exige readback inmediato, diff estable de un snapshot recién creado y error descriptivo para el ID legacy.

**Seguimiento:** cerrado; el servicio vivo creó `20260725191925_4e39507b-e51`, devolvió `verified: true` y produjo un diff estable.

---

## 2026-07-25 — Error de edición lineal detectado por readback

**Estado:** Corregido durante la misma iteración.

**Capa / owner:** operación de edición con `edit_lines`.

**Síntoma:** una sustitución por rangos duplicó `localIntentPatterns` y eliminó líneas vecinas de `skillScore()`.

**Causa:** el rango se calculó con números de línea previos y abarcó más contenido que el bloque previsto.

**Corrección:** lectura inmediata del fragmento, restauración explícita de los bloques afectados y compilación TypeScript antes de continuar.

**Regresión procedural:** para archivos que cambiaron desde la última lectura, preferir `apply_patch` por texto exacto o volver a leer líneas antes de otro `edit_lines`; no encadenar rangos basados en numeración stale.

---

## 2026-07-25 — `work_begin` devolvió éxito sin ejecutar una cadena larga

**Estado:** No resuelta; mitigada mediante ejecuciones individuales verificadas.

**Capa / owner:** terminal persistente `work_begin` / wrapper de comandos Windows.

**Síntoma:** una cadena de tres benchmarks enlazados con `&&` terminó con `exitCode: 0` en aproximadamente 27 ms, sin stdout/stderr y sin crear ninguno de los tres JSON esperados.

**Evidencia mínima:**

```text
session: term_1785011567453_3
running: false
exitCode: 0
duración observada: ~27 ms
archivos validate-*.json: 0
```

**Causa:** No resuelta. No está demostrado si la cadena fue absorbida por quoting/longitud de `cmd.exe`, por el wrapper de terminal o por otra condición de transporte.

**Corrección aplicada:** no se trató el `exitCode: 0` como evidencia. Se comprobó la ausencia de outputs y se ejecutó cada benchmark con `work_once` y timeout explícito.

**Prueba de regresión operativa:** las tres ejecuciones individuales crearon sus JSON y devolvieron código 0 después de 21.9 s, 42.6 s y 78.7 s.

**Seguimiento:** agregar una regresión que ejecute una cadena corta con `&&`, compruebe efectos por paso y haga fallar la tool cuando el comando nominalmente exitoso no alcance un output declarado.

---

## 2026-07-25 — Sesión persistente desapareció después de un 502

**Estado:** No resuelta; lifecycle seguro respecto de procesos huérfanos.

**Capa / owner:** transporte HTTP y almacenamiento de sesiones de terminal.

**Síntoma:** durante un benchmark de tres repeticiones, `work_peek` devolvió primero HTTP 502 y luego `Unknown terminal session`. El output esperado no existía y el proceso `llama-bench.exe` ya no estaba activo.

**Evidencia mínima:**

```text
session: term_1785011693811_4
primer readback: 502 upstream/external service error
segundo readback: Unknown terminal session
output validate-e2b-q40-compact-r3.json: ausente
llama-bench activo después del incidente: ninguno
```

**Causa:** No resuelta. No está demostrado si hubo restart del Bridge, pérdida del registro en memoria o terminación del proceso padre por fallo de transporte.

**Corrección aplicada:** se conservó el log de inicio, se verificó que no hubiera proceso huérfano y se repitió la corrida con `work_once`.

**Prueba de regresión operativa:** la repetición directa terminó en 21.9 s, escribió el JSON y confirmó integridad `unchanged` y cero procesos competidores.

**Seguimiento:** persistir suficiente metadata de sesiones fuera de memoria para diferenciar `proceso finalizado`, `sesión expirada`, `Bridge reiniciado` y `transporte interrumpido`; incluir PID/estado final recuperable tras restart.
