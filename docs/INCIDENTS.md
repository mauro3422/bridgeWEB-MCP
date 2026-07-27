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

---

## 2026-07-26 — Actividad Web sin ruta no distinguía conversación ni proyecto

**Estado:** Corregido en source 0.6.18.

**Capa / owner:** Adaptación MCP y métricas generales / `bridge-mcp`.

**Síntoma:** La época limpia mostró llamadas atribuidas a `chatgpt-web`, pero
ningún evento MSSR. No era posible probar si pertenecían al dashboard, a
`LLM-Rig` o a otra conversación, ni calcular qué porcentaje de tools elegibles
tenía traza.

**Evidencia:** La documentación oficial de OpenAI enumera
`_meta["openai/session"]` como identificador anónimo de conversación para
correlacionar tool calls. No enumera modelo ni nivel de razonamiento; además
define `openai/userAgent` como una pista opcional y best-effort.

**Causa:** Bridge sólo guardaba `clientInfo`, caller, modelo/esfuerzo y trace.
No consumía la sesión oficial, no atribuía un proyecto acotado y mezclaba en un
mismo denominador bootstrap, diagnóstico y trabajo sustancial.

**Corrección:** Bridge vuelve a hashear localmente `openai/session`, deriva sólo
un nombre acotado de proyecto, clasifica llamadas como `bootstrap`, `exempt`,
`traced` o `unrouted`, y calcula cobertura sobre tools elegibles. Una llamada
sin traza emite `mssr-unrouted-tool-call` con rate limit y no se bloquea.

**Regresión:** El contrato MCP crea una sesión Web anónima, carga contexto de un
proyecto fixture, ejecuta una búsqueda sin ruta y exige proyecto, session key,
cobertura 0%, una llamada elegible sin traza y aviso no bloqueante.

**Seguimiento:** Modelo y esfuerzo de ChatGPT Web deben permanecer `unknown`
salvo que el host los exponga o el agente los declare explícitamente al abrir
MSSR. Nunca inferirlos desde user-agent, latencia o conducta.

---

## 2026-07-26 — Reiniciar Bridge olvidaba skills ya cargadas

**Estado:** Corregido en source 0.6.18.

**Capa / owner:** Continuidad MSSR y persistencia / `bridge-mcp`.

**Síntoma:** Después de un restart controlado, retomar una traza explícita en
verificación podía emitir `mssr-required-skill-not-loaded` aunque las cargas
exitosas existieran en SQLite.

**Causa:** Eventos y traceId eran persistentes, pero `requiredSkills`,
`selectedSkills` y `loadedSkills` vivían sólo en el registro de proceso.

**Corrección:** Al recibir un `traceId` explícito ausente en memoria, el
coordinador reconstruye la última ruta, cargas exitosas, perfil, fase y cierre
desde el observatorio antes de aplicar gates o replans. Sesión/proyecto se
recuperan desde la llamada métrica correlacionada cuando existen.

**Regresión:** El test carga todas las skills requeridas, vacía el registro en
memoria simulando restart, retoma la misma traza en `verify` y exige cero
faltantes y cero aviso falso.

**Seguimiento:** Mantener la restauración acotada a un trace explícito; no
adivinar automáticamente entre varias trazas históricas después de reiniciar.

---

## 2026-07-26 — El dashboard confundía tareas abiertas y conexiones MCP con fallos y chats

**Estado:** Corregido en source 0.6.19.

**Capa / owner:** Dashboard operativo / `bridge-mcp`.

**Síntoma:** Una traza recién abierta mostraba activación MSSR con una tarea,
pero rendimiento indicaba cierre 0%, éxito vacío y verificación 0%. El estado
HTTP mostraba hasta 55 “sesiones totales”, interpretables como chats. Los
perfiles Web volvían a enseñar `unknown` y `work_once` no explicaba su función.

**Evidencia:** El readback vivo tenía una ruta, tres cargas y cero outcomes
porque la tarea seguía ejecutándose. `/status` informó conexiones retenidas,
activas e idle; no contiene un contador de conversaciones de usuario.

**Causa:** La UI representaba la ausencia temporal de outcome como porcentaje
cero y reutilizaba la palabra “sesión” para el transporte MCP. También mostraba
los valores internos de ausencia sin traducirlos.

**Corrección:** Las fases finales y el cierre se muestran como `pendiente`
mientras existan más trazas enrutadas que outcomes. El panel nombra conexiones
MCP retenidas y solicitudes activas; `unknown` se presenta como dato no expuesto
y `work_once` incluye su descripción de alias para un comando local corto.

**Regresión:** El smoke HTTP exige las etiquetas `Conexiones MCP`,
`modelo no expuesto` y `pendiente`. Typecheck y build validan el renderer.

**Seguimiento:** Mantener separadas métricas de transporte, conversación,
activación, fase y resultado; ninguna ausencia temporal debe presentarse como
calidad cero.

---

## 2026-07-26 — Tools, skills y proyecto de traza aparecían mezclados

**Estado:** Corregido en source 0.6.20.

**Capa / owner:** Adaptación MCP, trazas y dashboard / `bridge-mcp`.

**Síntoma:** “Tools más usadas” podía interpretarse como conteo de skills; el
panel sólo hacía visible el outcome de la skill primaria. En Codex sin
`openai/session`, una carga de contexto seguida por route y `skill_load`
registraba esas llamadas como proyecto `unknown`. Además, una traza cerrada podía
seguir apareciendo en métricas bootstrap posteriores.

**Evidencia:** La época activa contenía `skill_load=9`, mientras el observatorio
registraba por separado siete skills seleccionadas, seis cargadas y un único
outcome primario. Las llamadas `project_context_load` tenían proyecto, pero la
ruta y sus loads compartían traceId con `project=unknown`; cargas posteriores al
outcome heredaban el traceId cerrado.

**Causa:** La UI no mostraba los agregados `selectedSkills`/`loadedSkills`. La
atribución de proyecto dependía de argumentos o del hash de sesión Web; no
conservaba el contexto previo dentro de una conexión Codex. El resolver métrico
devolvía el snapshot local cerrado cuando no encontraba otra traza abierta.

**Corrección:** El dashboard nombra “Herramientas MCP” y añade listas separadas
de skills seleccionadas y cargadas; explica que sólo una `primarySkill` recibe el
outcome. Una conexión conserva los proyectos cargados antes de la siguiente ruta
(`multi-project` si son varios), y las tools posteriores heredan el proyecto de
la traza. El resolver limpia la referencia local cuando la traza está cerrada.

**Regresión:** El contrato crea una sesión Codex sin metadata de conversación,
carga un proyecto, abre route, carga skills y exige atribución consistente.
Después cierra el outcome, carga otro contexto y exige `trace_id = null`.

**Seguimiento:** Cuando no exista evidencia de proyecto, conservar el estado como
global/no expuesto; nunca inferir un proyecto desde latencia, texto libre o el
`cwd` fijo del proceso Bridge.

---

## 2026-07-26 — ChatGPT Web cerró antes de cargar una skill requerida

**Estado:** Corregido en source 0.6.21.

**Capa / owner:** Ciclo de vida MSSR y proyección operativa / `bridge-mcp`.

**Síntoma:** Una auditoría real desde ChatGPT Web registró un outcome exitoso,
cargó después la segunda skill requerida y registró otro outcome. Durante la
misma ejecución hubo una pausa extensa y un desvío de descubrimiento antes de
usar las tools correctas.

**Evidencia:** La traza observable contenía `route_planned`, un primer
`skill_loaded`, `outcome`, el segundo `skill_loaded` y otro `outcome`, en ese
orden. Bridge sólo advertía el faltante; no impedía el cierre exitoso.

**Causa:** El coordinador trataba `mssr-required-skill-not-loaded` como aviso en
todos los límites. El handler de outcome podía persistir éxito y cerrar la traza
aunque `missingRequiredSkills` no estuviera vacío.

**Corrección:** Un outcome con `status=success` queda bloqueado mientras falte
una skill requerida. La traza permanece abierta y devuelve la lista exacta para
cargarla antes de un único reintento. Las métricas recientes guardan además un
`operation_subject` acotado para distinguir qué skill cargó cada `skill_load`.

**Regresión:** El contrato reproduce el outcome prematuro, exige bloqueo y traza
abierta, carga la skill faltante mediante el wrapper genérico y confirma que el
outcome recuperado ya no se bloquea. La regresión de métricas exige el nombre
seguro de la skill en la llamada reciente.

**Seguimiento:** Medir silencios Web sólo con tiempos y eventos observables. No
atribuirlos a razonamiento interno ni almacenar prompts, transcripciones o
cookies.

---

## 2026-07-26 — `skill_load` y continuidad tras compactación eran ambiguos

**Estado:** Corregido en source 0.6.22.

**Capa / owner:** Documentación operativa y proyección del dashboard /
`bridge-mcp`.

**Síntoma:** Las filas recientes mostraban varias llamadas `skill_load` sin el
nombre de la skill, por lo que podían confundirse con uso efectivo o duplicado.
También faltaba un contrato explícito para reanudar una traza cuando Codex
compacta el contexto.

**Evidencia:** Las métricas ya guardaban `operation_subject`, pero el resumen
compacto de “Últimas operaciones” no lo renderizaba. El contenido cargado por
`skill_load` depende del contexto del host; Bridge sólo conserva el evento y la
traza, no el texto privado descartado por una compactación.

**Causa:** El detalle del objetivo sólo aparecía en la tabla extensa. La
documentación explicaba que la skill estaba sujeta a compactación, pero no
separaba selección, carga, aplicación y outcome ni definía el resume.

**Corrección:** El resumen muestra `skill: <nombre>`, `proyecto: <nombre>`,
`fase: <fase>` o `evento: <tipo>` bajo la tool. La UI y README aclaran que
`skill_load` prueba entrega, no cumplimiento. El resume conserva contexto
acotado y `traceId`, usa `stage=resume` y recarga sólo las skills activas que el
host ya no tenga disponibles.

**Regresión:** Typecheck/build y smoke HTTP exigen la semántica visible del
dashboard; la revisión de source comprueba el mapeo de objetivos permitidos.

**Seguimiento:** Si Codex expone en el futuro un hook observable de compactación,
registrar un checkpoint `resume` sin almacenar el resumen bruto. Mientras no
exista, no inferir compactación a partir de pausas o cantidad de tokens.

## 2026-07-26 — Un cwd auxiliar reemplazaba el proyecto primario de ChatGPT Web

**Estado:** Corregido, verificado y publicado en Bridge v0.6.23.

**Capa / owner:** Atribución de métricas por sesión / `bridge-mcp`.

**Síntoma y evidencia:** Dos tareas Web simultáneas de MyceliumFront aparecieron
repartidas entre `unknown`, `myceliumfront` y `bridge-mcp`. La misma sesión
anónima cambió a `bridge-mcp` al inspeccionar allí el esquema de
`skill_route_plan`, aunque la tarea primaria seguía siendo MyceliumFront.

**Causa:** `resolveProject` persistía cualquier proyecto inferido desde
`projectRoot`, `cwd` o `path`. Un comando auxiliar en otro repositorio
sobrescribía el contexto primario fijado por `project_context_load`.

**Corrección:** Sólo `project_context_load` actualiza el proyecto primario de la
sesión. Las rutas observadas por `cwd` o `path` quedan como fallback cuando no
hay contexto primario y no lo reemplazan.

**Regresión:** `test-mssr-trace-contract.mjs` carga un proyecto primario, ejecuta
`work_once` en un repositorio auxiliar y exige que la métrica permanezca
atribuida al proyecto primario.

**Seguimiento:** Completado en Bridge v0.6.24. Las métricas guardan un `task_key`
privacy-safe separado de sesión y traza, mantienen el proyecto primario fijado por
contexto y agregan los repositorios auxiliares como `related_project`. La regresión
con dos sesiones Web concurrentes exige tareas, proyectos primarios y repositorios
relacionados independientes sin duplicar filas por cada llamada.
---

## 2026-07-26 — Una ruta delegada perdía continuidad al cambiar de sesión MCP

**Estado:** Corregido y cubierto por regresión en source 0.6.25.

**Capa / owner:** Adaptador de dispatch, métricas y coordinador de trazas / `bridge-mcp`.

**Síntoma:** Después de `bridge_tool_query → skill_route_plan(stage=close)`, un `skill_load` dedicado podía recibir `mssr-orphan-skill-load`, crear otra traza y dejar la ruta original abierta. Repetir la carga con el `traceId` explícito funcionaba.

**Reproducción mínima:** Ruta Web delegada con metadata `openai/session`, pérdida deliberada del registro en memoria y posterior `skill_load` dedicado sin copiar manualmente el ID.

**Causa:** El wrapper conservaba el resultado MSSR pero la métrica exterior no extraía el `traceId` anidado en `result.result`. SQLite podía reconstruir la ruta, aunque no asociarla a la sesión anónima. Además, la recuperación automática sólo consultaba el registro compartido del proceso y no las trazas abiertas persistidas.

**Corrección:** El adaptador propaga `traceId` y perfil de agente desde resultados delegados. Si no existe una candidata en memoria, el coordinador consulta un conjunto acotado de trazas recientes, abiertas y persistidas; exige coincidencia exacta de sesión anónima o proyecto/caller, filtra por skill seleccionada y sólo adopta una candidata inequívoca. La ambigüedad continúa bloqueando la propagación automática.

**Regresión:** `test-mssr-trace-contract.mjs` ejecuta `dispatch route(close) → reset de memoria → skill_load dedicado → reset → checkpoint` y exige el mismo `traceId`, cero orphan load y continuidad del checkpoint.

**Seguimiento:** Verificar el servicio vivo 0.6.25 después del restart y observar que no reaparezca el patrón en la época activa.

---

## 2026-07-26 — El watchdog confundía preparación MSSR con trabajo inconcluso

**Estado:** Corregido y cubierto por regresión en source 0.6.25.

**Capa / owner:** Lifecycle Web y `closure_reminder` / `bridge-mcp`.

**Síntoma:** Una ruta, recomendación o carga de skill sin ninguna acción de dominio generaba `mssr-web-outcome-missing-after-idle` a los 60 segundos. Esto producía ruido y hacía parecer que una tarea había quedado colgada cuando sólo se había consultado el router.

**Causa:** El temporizador se armaba después de casi toda llamada observada, sin distinguir preparación, consulta y ejecución sustantiva.

**Corrección:** Routing, carga de contexto, catálogo/audit/vocabulario, consultas del observatorio y `skill_load` quedan exentos. El timer se inicia o reinicia después de herramientas sustantivas trazadas y checkpoints no finales; `outcome` lo cancela.

**Regresión:** La prueba espera cero recordatorios después de route y load, exactamente uno después de una herramienta de dominio sin outcome, cero para Codex y cancelación al cerrar.

**Seguimiento:** Revisar la tasa de reminders en la época activa; no aumentar el timeout salvo nueva evidencia.
---

## 2026-07-26 — La rotación de sesión del conector dejaba llamadas multi-repo como `unrouted`

**Estado:** Corregido para tools trace-aware en 0.6.26; cerrado completamente para tools genéricas y métricas en source 0.6.27.

**Capa / owner:** Resolución de contexto y candidatos MSSR / `bridge-mcp`.

**Síntoma:** Una tarea Web podía mantener la misma intención y `traceId`, pero al pasar entre `bridge-mcp`, `mssr` y `mauroprime-skills` algunas llamadas llegaban con otro hash anónimo de sesión o con el repositorio auxiliar como proyecto observado. Bridge emitía `mssr-unrouted-tool-call` aunque existía una sola traza Web abierta.

**Reproducción mínima:** Abrir una ruta `caller=chatgpt-web`, cambiar simultáneamente `sessionKey` y proyecto en la siguiente llamada elegible, y consultar el contexto métrico sin copiar manualmente el `traceId`.

**Causa:** `scopedCandidates` devolvía inmediatamente cero candidatos cuando el nuevo `sessionKey` no coincidía. La primera corrección extendió el fallback a tools trace-aware, pero `resolveMetricContext` —usado por tools genéricas como `git_status`— seguía consultando sólo memoria compartida del proceso después del restart. Además, el nombre de la skill no podía convertirse en criterio para elegir entre tareas concurrentes.

**Corrección:** La resolución conserva esta prioridad: sesión exacta, proyecto exacto, y sólo después fallback al caller. El fallback relajado se acepta únicamente cuando existe una sola traza abierta del caller antes de filtrar por skill. Dos o más trazas producen ambigüedad y requieren `traceId` explícito. La misma función de resolución se usa ahora para tools trace-aware y para `resolveMetricContext`, tanto sobre memoria como SQLite.

**Regresión:** `test-mssr-trace-contract.mjs` cubre `route → reset → herramienta genérica search_files` con sesión/proyecto rotados y exige el trace original en métricas sin aviso `unrouted`; también cubre `dispatch route(close) → reset → skill_load/checkpoint` y un caso con dos trazas abiertas que debe permanecer sin autoenlace.

**Seguimiento:** Verificar Bridge 0.6.27 vivo con una llamada genérica real desde un repositorio relacionado y confirmar ausencia de `mssr-unrouted-tool-call`; mantener la ambigüedad bloqueada con tareas concurrentes.
---

## 2026-07-26 — Una ruta MSSR delegada nacía sin proyecto o quedaba tapada por trazas históricas

**Estado:** Corregido y cubierto por regresión en Bridge 0.6.29.

**Capa / owner:** Adaptador MCP de `src/bridge-server.ts` y resolución de continuidad en `src/mssr-trace-context.ts`.

**Síntoma:** Después de `project_context_load`, invocar `skill_route_plan` mediante `bridge_tool_query` devolvía un `traceId`, pero la herramienta siguiente del mismo proyecto podía emitir `mssr-unrouted-tool-call`; `skill_load` también podía aparecer como huérfana. La primera corrección propagó proyecto y trace, pero la prueba viva reveló otra variante: varias trazas históricas abiertas con la misma sesión/proyecto hacían ambigua la recuperación persistida aunque acabara de iniciarse una ruta nueva.

**Reproducción mínima:** `project_context_load(proyecto A) → bridge_tool_query(toolName=skill_route_plan, stage=start) → search_files(proyecto A)`. En la variante real había tres rutas viejas abiertas para la misma sesión/proyecto y una ruta fresca creada segundos antes.

**Causa:** El adaptador exterior calculaba `startsNewRoute`, perfil de agente, task key y consumo del proyecto pendiente usando únicamente el wrapper `bridge_tool_query`; además sólo detectaba `traceId` en el resultado exterior. Tras corregir eso, la recuperación persistida seguía viendo todas las rutas exactas de sesión/proyecto como equivalentes, porque los outcomes faltantes de sesiones interrumpidas permanecían abiertos.

**Corrección:** El adaptador resuelve primero el tool efectivo, perfila el payload delegado, reconoce rutas delegadas como nuevas rutas, consume el proyecto cargado, usa el task efectivo y extrae `traceId` directo o anidado. La continuidad conserva la ambigüedad segura entre tareas realmente simultáneas, pero cuando existe exactamente una ruta planificada recientemente para la misma combinación exacta de sesión, proyecto y caller, esa ruta fresca domina sobre trazas históricas abiertas; dos rutas frescas continúan siendo ambiguas.

**Regresión:** `scripts/test-delegated-mssr-route-project.mjs` crea tres rutas históricas abiertas, envejece sus eventos, reinicia el registro en memoria, crea una ruta fresca delegada y vuelve a reiniciar para forzar recuperación SQLite. Exige proyecto correcto, sesión anonimizada estable, mismo `traceId`, `routing_status=traced`, ausencia de `mssr-unrouted-tool-call` y cierre MSSR exitoso. La prueba está integrada en `test:regressions` y expuesta como `test:mssr-delegated-routing`.

**Seguimiento:** Verificar 0.6.29 vivo desde ChatGPT Web y cerrar las trazas históricas de mantenimiento ya reemplazadas. No autoenlazar si existen dos o más rutas frescas compatibles.

## Delegated MSSR route lost when ChatGPT Web session is unknown

**Date:** 2026-07-26
**Status:** Fixed in Bridge 0.6.30.

**Symptom:** After `project_context_load` and a delegated `skill_route_plan`, a stateless follow-up tool could be reported as `mssr-unrouted-tool-call` when `_meta.openai/session` was absent, even though one fresh compatible route existed.

**Reproduction:** Run `scripts/test-delegated-mssr-route-project.mjs` with `BRIDGE_TEST_SESSION_MODE=unknown`, age three historical routes, reset the in-memory registry, and invoke `search_files` without copying `traceId`.

**Cause:** Persisted candidate recovery narrowed by project or caller but did not let one fresh route dominate stale compatible routes unless both exact session and project scope were known.

**Correction:** Apply freshness dominance after project/caller scoping. Exactly one fresh route is recovered; two or more fresh routes remain ambiguous.

**Regression:** `npm run test:mssr-delegated-routing` now executes both named-session and unknown-session variants.

---

## 2026-07-27 - Errores de target y cargas MSSR ambiguas parecían herramientas rotas

**Estado:** Corregido en Bridge 0.6.34; continuidad automática del bootstrap delegado corregida adicionalmente en 0.6.35.

**Capa / owner:** Contrato runtime de tools, prompting MSSR y observabilidad accionable / `bridge-mcp` + skills `mssr-agent-routing` y `mauroprime-bridge-collaboration`.

**Síntoma:** Llamadas como `terminal_read` con un `sessionId` inventado, fallos de schema en fallbacks y `skill_load` sin una traza inequívoca acumulaban errores. El audit podía interpretar una muestra de fallos del caller como necesidad de reparar la implementación, mientras los avisos sólo describían el problema y se perdían del dashboard al ser entregados.

**Causa:** Los schemas exponían argumentos y riesgo, pero no precondiciones, preflights ni recuperación por categoría. `skill_route_plan` seleccionaba skills, aunque el agente todavía debía reconstruir manualmente la llamada a `skill_bootstrap` o cargar skills una por una. La cola de notices era one-shot y no preservaba un recordatorio visible después del drain.

**Corrección:** La metadata canónica añade `usage.prerequisites`, `usage.preflightTools` y reglas de `usage.recovery`; `bridge_tool_schema` las expone. `skill_route_plan` devuelve una `nextAction` completa hacia `skill_bootstrap`, que carga todas las skills activas de la fase sobre la misma traza. Los notices incluyen acciones bounded, conservan historial efímero durante 24 horas y aparecen en Tool Portfolio sin ejecutar cambios. `target-not-found`, schema, permisos/riesgo y safety guards se tratan primero como fricción de contrato/UX.

**Regresión:** `test-v060-tools.mjs` exige preflight de `terminal_read`, recuperación MSSR de `skill_load`, clasificación de targets inexistentes, continuación `skill_route_plan -> skill_bootstrap` e historial de notices después del drain. `test-bridge-http.ps1` verifica `/api/notices`, privacidad y la tarjeta de recordatorios. Las suites completas de Bridge, MSSR y routing permanecen verdes.

**Seguimiento 0.6.35:** El smoke test vivo posterior a 0.6.34 detectó que `skill_bootstrap` registraba cargas Codex exitosas en observabilidad, pero omitía `loaded: true` en su respuesta; el coordinador no podía incorporarlas a `loadedSkills` y bloqueaba correctamente el outcome. Se unificó el contrato Codex/Roblox y la regresión delegada ahora exige `bridge_tool_query -> skill_bootstrap -> outcome` sin `skill_load` manual, tanto con sesión identificada como anónima.

**Seguimiento:** Observar el audit vivo durante varias sesiones. No convertir una recomendación o un aviso en reparación, deprecación o mutación automática; exigir reproducción y evidencia suficiente.
