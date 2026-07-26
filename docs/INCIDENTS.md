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

---

## 2026-07-25 — Proyecto local obsoleto de Codex sin operación de eliminación

**Estado:** No resuelta; mitigada archivando los tasks asociados.

**Capa / owner:** superficie de proyectos locales de Codex / conector `codex_app`.

**Síntoma:** después de mover `MyceliumFront` desde `D:\Dev\mc-roblox\MyceliumFront` a `D:\Dev\MyceliumFront`, `list_projects` siguió devolviendo dos proyectos con la misma etiqueta. La ruta vieja ya no existe, pero no hay una operación `delete_project` o `remove_project` expuesta.

**Evidencia mínima:**

```text
proyecto actual: 26fd0f10-7a45-4ddd-8f18-2e037e8f1828
ruta actual: D:\Dev\MyceliumFront
proyecto obsoleto: 410d29b5-470c-4eba-9052-ecfae0bd755f
ruta obsoleta: D:\Dev\mc-roblox\MyceliumFront
Test-Path ruta actual: true
Test-Path ruta obsoleta: false
```

**Causa:** capability gap de la superficie conectada; listar proyectos y archivar tasks está soportado, eliminar una entrada de proyecto guardado no.

**Corrección aplicada:** se recuperó el contexto de los dos tasks asociados a la ruta vieja y se archivaron mediante `set_thread_archived`. No se tocó la base interna de Codex ni se automatizó su propia UI.

**Regresión operativa:** `list_threads` dejó de mostrar ambos tasks en la lista activa; `list_projects` continúa mostrando la entrada obsoleta, lo que mantiene visible el límite.

**Seguimiento:** exponer una operación soportada para eliminar o relinkear proyectos locales guardados, con readback por `projectId` y protección cuando la ruta todavía existe.

---

## 2026-07-25 — Interrupción de ChatGPT Web sin telemetría end-to-end

**Estado:** Parcialmente mitigada; el trabajo de archivos pudo recuperarse y verificarse, y Bridge ahora detecta trazas Web sin cierre MSSR.

**Capa / owner:** lifecycle de turno ChatGPT Web + observabilidad Bridge.

**Síntoma:** el chat `Mycelium - Estado visual y Git` dejó como último mensaje del asistente el anuncio de una prueba paralela y no publicó su resultado. El compositor volvió a estado editable y no había generación activa, aunque los outputs esperados sí existían.

**Evidencia mínima:** tres runs contenían `parallel-file-work.json` y `visual-critique-queue.json`; la repetición con el worker endurecido confirmó 39/39 evidencias aceptadas. Bridge conserva duración de sus tools, pero no observa envío del prompt, primer contenido visible, pausas del stream ni fin visible del turno.

**Causa:** No resuelta. La evidencia separa una interrupción de lifecycle/respuesta de un fallo del trabajo local, pero no permite atribuirla a red, cliente, servicio o modelo.

**Corrección aplicada:** se recuperó continuidad desde outputs y manifests, se repitió la verificación y se evitó reejecutar Studio. El coordinador MSSR ahora reinicia un watchdog con cada herramienta de `chatgpt-web`, lo cancela al observar `outcome`, emite `mssr-web-outcome-missing-after-idle` si vence y persiste `closure_reminder` sin prompts ni respuestas. El observatorio separa cobertura y recordatorios por caller.

**Regresión operativa:** auditoría Photo Rig estricta limpia, 30 casos del worker y 39/39 evidencias reales aceptadas. El contrato MSSR cubre aviso Web único, cancelación por `outcome` y exclusión de Codex; `test:regressions` pasó con 122 tools. La verificación cruzada source pasó en 90,5 s y `verify:all` vivo en 87,3 s después del restart. Ejecutarlas juntas con timeout de 180 s venció por amplificación acumulada, sin procesos huérfanos; los gates separados terminaron limpios.

**Seguimiento:** la parte MCP quedó cubierta y es configurable con `BRIDGE_MCP_WEB_CLOSURE_IDLE_MS`. Para diagnóstico end-to-end todavía hace falta soporte del host/navegador para `webTurnId`, timestamps de submit/primer contenido/final visible, intervalos stalled, cancelación/error y tamaño visible; correlacionar con `traceId` sin guardar prompts, respuestas ni secretos.

---

## 2026-07-25 — Routing verboso y ausencia de una operación segura para reiniciar la línea base MSSR

**Estado:** Corregido en source `0.6.15`; pendiente de release/restart vivo coordinado.

**Capa / owner:** adapter de routing y observabilidad MSSR de Bridge.

**Síntoma:** `skill_route_plan` devolvía siempre scores, phase plan, metadata y
source health completos aunque el agente sólo necesitara nombres, razones cortas y
orden. El dashboard podía separar callers, pero iniciar una comparación desde
cero requería alterar manualmente el archivo de estado o borrar telemetría.

**Evidencia mínima:** sobre el mismo fixture visual, el resultado debug ocupó
6.932 caracteres. El modo compacto nuevo ocupa 2.593 caracteres y conserva
`traceId`, intent, caller, skills activas/diferidas, obligatoriedad, razón,
loadOrder, presupuesto, cobertura y warnings.

**Causa:** el schema no exponía `responseMode` y el handler retornaba el objeto
MSSR completo. La época activa sólo se creaba cuando el estado faltaba o era
inválido; no existía una mutación explícita y recuperable para abrir un benchmark.

**Corrección aplicada:** `skill_route_plan` y `skill_recommend` usan
`responseMode=compact` por defecto y permiten `debug`. Se añadió
`mssr_observatory_epoch_start` con confirmación y razón; crea una época activa
nueva sin borrar eventos y conserva el historial mediante `scope=all`.

**Regresión operativa:** 123 tools registradas; `test:regressions`,
`test:skill-routing`, typecheck/build y `docs:tools:check` pasan. El contrato
prueba que la época nueva comienza con cero eventos activos y que `scope=all`
mantiene exactamente el total histórico.

**Seguimiento:** no activar la nueva época ni reiniciar mientras el agente del
dashboard visual tenga cambios concurrentes. Publicar una sola versión coherente,
reiniciar, comprobar catálogo `0.6.15` y recién entonces abrir el baseline.

---

## 2026-07-25 — Web/Codex estaban separados, pero modelo y esfuerzo quedaban mezclados

**Estado:** Corregido en source; pendiente release/restart coordinado.

**Capa / owner:** Observabilidad MSSR / `bridge-mcp`.

**Síntoma:** `surfaces` distinguía `codex-local`, `chatgpt-web` y `other`,
pero no permitía comparar Terra contra Sol ni separar niveles de razonamiento.

**Evidencia:** El contrato de `skill_route_plan`, `skill_recommend`,
`skill_bootstrap` y `mssr_trace_record` sólo aceptaba `caller`; los eventos no
guardaban un perfil observable del agente.

**Causa:** El primer contrato de superficies midió el producto cliente, pero no
incluyó dimensiones opcionales declaradas por el host para modelo y esfuerzo.
MCP no expone esos datos al Bridge de forma confiable para inferirlos.

**Corrección:** Se añadieron `model` y `reasoningEffort` como metadatos
opcionales, con `unknown` como fallback honesto. Bridge los toma
automáticamente de `x-codex-turn-metadata` en Codex y acepta declaración
explícita en hosts que no ofrecen ese envelope. El resumen ahora expone
`agentProfiles` por caller, modelo y esfuerzo. Ninguno de estos campos participa
del routing.

**Regresión:** `test-mssr-trace-contract.mjs` inyecta un envelope MCP de Codex,
registra `chatgpt-web + gpt-5.6-terra + high` y exige cobertura de outcome del
100%; TypeScript y la documentación generada también deben permanecer verdes.

**Seguimiento:** Después de integrar el dashboard concurrente, hacer un único
restart, abrir la época limpia y comprobar que los hosts declaren el perfil
cuando lo conozcan. No reconstruir perfiles históricos por latencia o calidad.

---

## 2026-07-26 — Smoke HTTP acoplado al texto del dashboard anterior

**Estado:** Corregido y verificado en runtime 0.6.15.

**Capa / owner:** Release gate del dashboard / `bridge-mcp`.

**Síntoma:** Después del restart correcto, `verify:all` falló únicamente con
`Dashboard does not expose MSSR routing/continuity/outcome sections`, aunque la
UI modular mostraba las tres secciones.

**Evidencia:** El HTML vivo contenía `mssr-structured`, `mssr-continuity` y
`mssr-skill-outcomes`. El smoke exigía además el texto histórico
`MSSR routing`, eliminado durante la reorganización visual.

**Causa:** La prueba validaba una etiqueta de presentación mutable en lugar del
contrato estructural estable del dashboard.

**Corrección:** `test-bridge-http.ps1` verifica los tres IDs funcionales
estables y continúa comprobando los endpoints MSSR activos e históricos.

**Regresión:** `npm run smoke:http` y el gate vivo completo
`npm run verify:all` pasan contra Bridge 0.6.15, túnel ready y 123 tools.

**Seguimiento:** Los smoke tests de UI deben preferir IDs, roles o contratos de
datos estables; reservar coincidencias de texto para copy que sea requisito.

## 2026-07-26 — `work_once` perdió la respuesta durante gate Tauri largo

- Estado: abierto / causa no resuelta.
- Capa/owner: Bridge MCP, transporte y lifecycle de `work_once`.
- Síntoma: el comando combinado de verificación de `D:\Dev\LLM-Rig` devolvió `request terminated without response` mientras `npm run tauri build -- --no-bundle`, `cargo` y `rustc` siguieron ejecutándose fuera de una sesión consultable por `work_show`.
- Evidencia: los procesos `node.exe -> tauri build -> cargo.exe -> rustc.exe` continuaron; después terminaron y generaron `app\src-tauri\target\release\llm-rig-desktop.exe`.
- Workaround aplicado: consultar procesos por command line, esperar su finalización y repetir los gates por separado con `work_once` corto.
- Regresión/resultado: motor 14/14, Tauri 8/8 y build release pasaron con respuestas observables.
- Seguimiento: preservar un identificador consultable o convertir automáticamente llamadas largas en sesión persistente cuando se corte el transporte.

---

## 2026-07-26 — Dashboard mezclaba métricas generales históricas con el baseline MSSR

**Estado:** Corregido y verificado en runtime 0.6.16.

**Capa / owner:** Métricas, dashboard y adaptación MCP / `bridge-mcp`.

**Síntoma:** El observatorio MSSR mostraba una época activa limpia y perfiles
por caller/modelo/esfuerzo, pero las cards generales seguían agregando más de
22.000 llamadas y cientos de errores históricos sin atribución. No era posible
comparar Codex y ChatGPT Web desde un punto estable.

**Evidencia:** `mssr_observatory_query(scope=active)` devolvía dos trazas nuevas,
mientras `bridge_metrics_summary` aún consultaba `tool_call_summary` sin scope y
devolvía el acumulado completo.

**Causa:** La época persistida se aplicaba sólo a `mssr_events`; `tool_calls` no
guardaba epoch, trace, caller, model ni reasoning effort, y `/api/metrics/*`
carecía de `active/all`.

**Corrección:** La época compartida ahora etiqueta `tool_calls`, las consultas
generales usan `active` por defecto y aceptan `all`, se preserva el histórico y
el dashboard agrega una tabla por `caller + model + reasoningEffort`. Los
valores que el host no expone permanecen `unknown`.

**Regresión:** `test-mssr-trace-contract.mjs` exige cero lógico para métricas
generales tras abrir una época, preservación de `all`, perfil Web y correlación
de la llamada de routing con su trace. El smoke HTTP exige scopes compartidos y
la sección `agent-profiles`. `verify:all` pasó vivo en 0.6.16 con 123 tools.

**Seguimiento:** Abrir una época definitiva después de los gates y ejecutar
benchmarks por superficie/modelo/esfuerzo sin reconstruir metadata no observable.

---

## 2026-07-26 — Herramientas genéricas aparecían como `other / unknown`

**Estado:** Corregido y verificado en runtime 0.6.17.

**Capa / owner:** Adaptación MCP, continuidad de trazas y dashboard /
`bridge-mcp`.

**Síntoma:** Llamadas a herramientas genéricas como `search_files`,
`read_file_lines` y `system_info` podían quedar como `other / unknown`, aunque
procedieran de Codex o ChatGPT Web. En sesiones HTTP stateless tampoco heredaban
la traza MSSR abierta.

**Evidencia:** Antes de la corrección, `tool_calls` carecía de identidad de
cliente cuando la herramienta no recibía argumentos MSSR. Después del restart,
la telemetría viva registró `codex-mcp-client` como
`codex-local / gpt-5.6-sol / medium` y `openai-mcp` como `chatgpt-web`; una
llamada genérica de Codex heredó la traza activa exacta.

**Causa:** El recorder dependía sólo de argumentos y metadata de turno; no
consultaba `clientInfo` del handshake MCP. Además, la continuidad stateless se
aplicaba a herramientas MSSR explícitas pero no al contexto métrico general.

**Corrección:** Todas las llamadas guardan época, `client_name`, caller, modelo,
esfuerzo y traza cuando son observables. El handshake reconoce las superficies
conocidas y una llamada stateless adopta únicamente la traza abierta compatible
cuando existe exactamente una. Los campos no demostrables permanecen
`unknown`, y la ausencia de traza sigue siendo visible en lugar de atribuirse
falsamente.

**Regresión:** `test-mssr-trace-contract.mjs` abre un cliente `ChatGPT Web`,
ejecuta una herramienta genérica desde otra sesión y exige identidad Web más
herencia de la traza. `verify:all` pasó vivo en 0.6.17; el smoke HTTP exige las
secciones `mssr-agent-activation` y `mssr-agent-results`.

**Seguimiento:** Medir por separado la cobertura de traza de cada superficie.
ChatGPT Web debe declarar modelo/esfuerzo al abrir su ruta mientras el host no
los exponga; nunca inferirlos por latencia, longitud o calidad aparente.
