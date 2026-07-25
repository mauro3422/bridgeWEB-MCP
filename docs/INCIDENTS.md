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

**Estado:** Corregido en source; pendiente verificación del servicio vivo tras publicación/restart.

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

**Seguimiento:** verificar `project_context_load` desde el Bridge HTTP reiniciado.

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

**Seguimiento:** después del restart, confirmar que `workspace_snapshot` vivo devuelve el formato actual y `verified: true`.

---

## 2026-07-25 — Error de edición lineal detectado por readback

**Estado:** Corregido durante la misma iteración.

**Capa / owner:** operación de edición con `edit_lines`.

**Síntoma:** una sustitución por rangos duplicó `localIntentPatterns` y eliminó líneas vecinas de `skillScore()`.

**Causa:** el rango se calculó con números de línea previos y abarcó más contenido que el bloque previsto.

**Corrección:** lectura inmediata del fragmento, restauración explícita de los bloques afectados y compilación TypeScript antes de continuar.

**Regresión procedural:** para archivos que cambiaron desde la última lectura, preferir `apply_patch` por texto exacto o volver a leer líneas antes de otro `edit_lines`; no encadenar rangos basados en numeración stale.
