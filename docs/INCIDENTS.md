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

Registrar aquí los defectos propios de `bridge-mcp`. Los incidentes de routing/skills pertenecen a `D:\Dev\mssr\docs\skill-routing\INCIDENTS.md`; los defectos exclusivos de un proyecto pertenecen a su `.bridge/PROJECT_STATE.md`, `docs/INCIDENTS.md` o `BUGS.md`.

---

## 2026-08-12 — El host de ChatGPT omitió tools con `openai/fileParams` aunque el runtime las exponía

**Estado:** Mitigado y verificado en runtime vivo; metadata operativa corregida para `0.6.80`.

**Capa/owner:** frontera entre catálogo directo del host ChatGPT y runtime MCP de `bridge-mcp`; la mitigación local pertenece a `media_review_ingest`.

**Síntoma observable:** después de publicar y reiniciar `0.6.78`, `bridge_health` mostró 143 tools y `media_review_ingest` estaba presente con `_meta["openai/fileParams"]=["files"]`, pero el catálogo directo observable de la conversación conservó sólo 127/143. Entre las 16 ausentes estaban tanto `media_review_ingest` como la preexistente `image_asset_import_files`, por lo que el adjunto de video no podía cruzar por el mecanismo especial de file parameters aunque los wrappers siguieran viendo la tool runtime.

**Reproducción mínima/evidencia:** `bridge_connector_catalog_compare` con las 127 tools observables reportó cobertura directa 88.81% y listó ambas tools de file parameters como `absentDirectly`. `bridge_tool_schema(media_review_ingest)` confirmó el schema runtime correcto. El wrapper `bridge_tool_action` no puede fabricar un `download_url/file_id` autorizado por ChatGPT, por lo que wrapper reachability no equivale a file-parameter transport.

**Causa demostrada:** la selección/actualización del catálogo directo pertenece al host de ChatGPT y puede quedar detrás del runtime MCP después de un restart. Bridge no puede inspeccionar ni forzar esa selección. No hubo evidencia de un schema `openai/fileParams` incorrecto ni de una falla del procesador multimedia.

**Mitigación aplicada:** `media_review_ingest` acepta exactamente una fuente `files` o `localPath`. `files` conserva el transporte autorizado cuando el host lo expone; `localPath` permite a ChatGPT vía Bridge, Codex y otros clientes procesar el mismo medio si ya existe en MauroPrime, sin Base64 ni fileParams. En ambos casos se crea una working copy verificada antes del análisis. `bridge_connector_catalog_compare` sigue siendo el diagnóstico de drift; reabrir el connector o iniciar un chat nuevo sigue siendo la recuperación para adjuntos que sólo existen en ChatGPT.

**Regresión:** `test-media-review-ingest.mjs` cubre el camino fileParam, el nuevo camino `localPath`, rechazo de doble/ninguna fuente, preservación del archivo original y cleanup de la working copy. El caso real `D:\Grabaciones de pantall\Grabación de pantalla 2026-08-11 205859.mp4` produjo 102.133 s de timeline, 30 ventanas estabilizadas de voz, 31 silencios, 18 cambios visuales, 14 grupos ASR y 1219 caracteres reconocidos sin warnings.

**Verificación runtime:** `0.6.79` procesó el MP4 real por `localPath` a través de `bridge_tool_action` en 15.514 s: source SHA-256 `305cec809f1b2e270784a1b02a316bcfd5d14140a912081d8aac164643184c5b`, 102.133333 s, actividad acústica a 30 ms, 223/224 ventanas crudas sonido/quietud, 30/31 ventanas estabilizadas voz/silencio, 14 grupos ASR, 27 frames periódicos, 18 keyframes visuales, previews adjuntos y cero warnings. `bridge_tool_schema` expuso correctamente `files | localPath`; esa lectura también reveló que `metadata.usage.prerequisites` había quedado stale de v1, por lo que se corrigió en el patch siguiente.

**Seguimiento:** conservar como límite de producto que Bridge no puede garantizar que una tool con file parameters sea seleccionada directamente por cada conversación. No crear un transporte Base64 paralelo cuando `localPath`, `files` o las tools binarias genéricas existentes ya resuelvan el movimiento de bytes.

---


## 2026-08-10 — Un único fallo transitorio de readiness provocaba autorestart y 502 aguas arriba

**Estado:** Corregido y verificado en runtime vivo.

**Capa/owner:** watchdog HTTP/autorecovery de `bridge-mcp`, con endurecimiento adicional del transporte de trabajo y observabilidad.

**Síntoma observable:** ChatGPT Web recibía `502 Bad Gateway` de forma intermitente aunque el Bridge local volvía a responder inmediatamente. El parseo estructurado de `bridge-events.jsonl` para el 8–10 de agosto no encontró respuestas internas `502` ni `Bad Gateway`; sí mostró una etapa con muchos reinicios y llamadas síncronas largas.

**Reproducción mínima y evidencia causal:** durante un `bridge_verify_all` en background se hizo una consulta pequeña de schema. Esa consulta recibió un `502`; inmediatamente después `bridge_health` mostró un ack `auto-restart-http-not-ready` a `2026-08-10T19:52:17.6881537Z`. El túnel permaneció `live/ready`, demostrando que el corte coincidió con la destrucción/recreación del HTTP Bridge y no con el tamaño de esa respuesta.

**Causa demostrada:** `start-bridge-http-watchdog.ps1` reiniciaba destructivamente el HTTP Bridge ante el primer `Test-HttpText /readyz` fallido. Bajo carga, una demora transitoria del probe de tres segundos era suficiente para matar un proceso todavía vivo y abrir una ventana de 502 en el control plane.

**Contribuyentes corregidos:** `work_once` permitía requests síncronas de 77–120 s; `bridge_verify_all` retenía una sola request durante suites de ~100–160 s; `bridge_metrics_summary` no acotaba la cardinalidad de `agentProfiles`; `mssr_trace_evidence` podía devolver hasta 2000 eventos; después de la migración a `D:` el túnel dependía de un profile-dir legacy implícito y los launchers todavía conservaban rutas `C:\dev`.

**Corrección:** el watchdog exige tres fallos consecutivos de readiness mientras el proceso siga vivo y sólo recupera inmediatamente cuando el proceso realmente murió; el ack distingue `process-exited` de `readiness-threshold`. `bridge_verify_all` ejecuta el gate como job background consultable con `bridge_verify_status`; `work_once` queda limitado a 45 s; métricas/evidencia se acotan; Startup y launchers usan `D:\Dev\bridge-mcp`; el túnel recibe `--profile-dir` explícito y la API key User se reinyecta al proceso hijo.

**Regresión:** el mismo full gate que produjo el 502 se repitió durante `160803 ms`, incluyendo `98962 ms` de regresiones pesadas, mientras consultas MCP pequeñas siguieron respondiendo. Terminó `ok=true`, Bridge conservó PID `5640` y boot `caeae28b-837f-495c-a2ea-b5ea2bff1f87`, y no apareció un nuevo ack automático. Un restart controlado sólo del túnel cambió PID `23272 -> 13892`, arrancó desde `D:` con el profile-dir explícito y preservó el Bridge.

**Seguimiento:** conservar el debounce como contrato del watchdog y tratar respuestas enormes o jobs largos como riesgos separados de transporte, no como explicación automática de futuros 502. El catálogo directo del host puede seguir detrás del runtime; los wrappers cubren esa diferencia hasta que el host refresque su catálogo.


## 2026-08-09 — La proyección del Bridge descartaba dimensiones del intent MSSR

**Estado:** Corregido y verificado en source; pendiente de publicación/restart del runtime vivo.

**Capa/owner:** adaptador de observabilidad `bridge-mcp` y contrato portable de telemetría en `@mauroprime/mssr`.

**Síntoma observable:** Codex/OpenCode podían clasificar `domains`, `actions`, `artifacts`, `needs`, `signals`, `risk` y `ambiguity`, pero el Bridge persistía solamente `signals` y `ambiguity`. Las rutas Web directas tenían la misma pérdida, impidiendo agregados confiables por dimensión.

**Reproducción mínima:** emitir una ruta `mssr-telemetry-v1` con `route.intent` completo, ingerirla por `/api/mssr/events` y leer el JSONL aislado; antes de la corrección no existía `details.intent`.

**Causa demostrada:** las funciones de proyección construían manualmente `details` con dos campos del intent aunque el router ya producía el objeto canónico completo.

**Corrección:** MSSR incorpora un intent de telemetría aditivo y acotado más `analyzeMssrTelemetry`; Bridge conserva exclusivamente las siete dimensiones canónicas, omite `summary` y expone `intentAnalysis` con candidatos de revisión por señal recurrente o carga requerida faltante.

**Regresión:** `scripts/test-telemetry-analysis.mjs`, `scripts/test-mssr-http-telemetry.mjs` y `scripts/test-v060-tools.mjs` validan privacidad, compatibilidad legacy, deduplicación, umbrales, persistencia externa y rutas Web directas.

**Seguimiento:** publicar ambos repositorios y verificar el runtime vivo antes de considerar disponibles los nuevos campos en el dashboard/API de producción.

## 2026-08-08 — OpenCode no aparecía en MSSR y Errores perdía cada letra `s`

**Estado:** Corregido, publicado y verificado en runtime vivo `0.6.74`.

**Capa/owner:** transporte HTTP y proyección dashboard de `bridge-mcp`; contrato de host compartido en `@mauroprime/mssr`.

**Síntoma observable:** OpenCode estaba conectado al facade MSSR portable, pero el dashboard tenía cero rutas atribuibles a OpenCode. En la pestaña Errores, la API y SQLite conservaban los mensajes, mientras el DOM quitaba todas las letras `s`.

**Reproducción mínima:** el provider dinámico ejecutaba sólo `tools/list`, por lo que ninguna ruta/checkpoint salía del proceso OpenCode. El HTML servido contenía `replace(/s+/g, ' ')` aunque la fuente TypeScript mostraba `replace(/\s+/g, ' ')` dentro de un template literal.

**Causa demostrada:** no existía un sink persistente entre el adaptador standalone y el observatorio; OpenCode además usaba el caller genérico `other`. En el dashboard, la barra invertida del regex no estaba doblemente escapada para sobrevivir el template literal exterior.

**Corrección:** Bridge recibe `mssr-telemetry-v1` mediante `POST /api/mssr/events`, token local, límite de 64 KiB, schema estricto, validación lifecycle y deduplicación. Proyecta `opencode-local` y conserva sólo metadata acotada. El regex ahora se emite como `/\s+/g`. Ningún idle o exit crea outcomes.

**Regresión:** `scripts/test-mssr-http-telemetry.mjs` prueba proceso fresco, 401 sin token, aceptación/deduplicación autenticada, 0 outcomes antes del checkpoint explícito, superficie OpenCode, outcome explícito y HTML servido. `scripts/test-bridge-http.ps1` repite token y escaping contra runtime vivo.

**Seguimiento:** MSSR y Bridge quedaron publicados; el runtime `affe8242-72df-4d61-8ef8-5d0864107436` pasó el smoke HTTP vivo. La ruta del adaptador OpenCode `mssr-opencode-e0fb7eef-bf3f-4250-aab4-ce23e10c3bb0` llegó al dashboard con caller `opencode-local`, verificación, persistencia y outcome `closed-success`. El proceso de modelo Terra no llegó a ejecutar el agente por credenciales externas (balance OpenCode y API key OpenAI), por lo que modelo y esfuerzo se conservan honestamente como no expuestos.

---

## 2026-08-08 — Studio cerrado degradaba rutas MSSR ajenas a Roblox

**Estado:** Corregido, publicado y verificado en runtime vivo `0.6.73`.

**Capa / owner:** discovery de providers y adaptación MSSR en `src/integrations/roblox-mcp-client.ts` y `src/tools/skill-catalog-tools.ts`.

**Síntoma:** con Roblox Studio cerrado, `skill_route_plan` y `skill_bootstrap` incluían `sourceHealth.roblox.status=degraded` y un warning en tareas Git/código que no requerían Roblox.

**Reproducción mínima:** conservar el catálogo last-known, cerrar Studio y planificar una ruta estructurada con `domains=[git,coding]`. Antes del fix la respuesta incluía salud/warnings Roblox; una ruta explícitamente Roblox y la ruta ajena producían la misma atención de provider.

**Causa:** el discovery no bloqueante reutilizaba metadata cacheada intencionalmente, pero la clasificaba como fallo vivo `degraded`; además todas las rutas consultaban Roblox por defecto aunque un intent estructurado excluyera ese dominio.

**Corrección aplicada:** la metadata last-known usada sólo para discovery se clasifica como `cached` sin warning global. Las rutas estructuradas no Roblox omiten esa fuente opcional; las rutas Roblox conservan el gate vivo y proyectan `catalog-degraded` hasta que Studio responda.

**Regresión:** `test-v060-tools.mjs` exige `cached` sin warning, ausencia total de `sourceHealth.roblox` en una ruta Git/código y ausencia de warnings Roblox. `test-mssr-system-awareness.mjs` exige que `cached` siga siendo degradado dentro de una ruta Roblox. La suite completa pasó.

**Persistencia:** Bridge `c5e15eb4477db496ee5b03f64858a7562ef8ee57`, publicado con HEAD, tracking y ref remota directa coincidentes. Reinicio HTTP `6a07b468-d44e-4359-b37b-5806f0cd5d25` confirmado; runtime `0.6.73` live/ready.

**Seguimiento:** cerrado. Studio cerrado es normal fuera del dominio Roblox; dentro de Roblox debe seguir requiriéndose evidencia viva antes de ejecutar.

---

## 2026-08-07 — Outcome MSSR exitoso aceptado con close/maintenance obsoleto

**Estado:** Corregido, publicado y verificado en runtime vivo `0.6.67`.

**Capa / owner:** lifecycle de trazas MSSR en `src/mssr-trace-context.ts` y reconstrucción observable en `src/mssr-observatory.ts`.

**Síntoma:** una traza podía completar `close -> maintenance`, reanudarse después, persistir trabajo adicional y aun así registrar `status=success` sin repetir `close -> maintenance`. La skill de mantenimiento sí había sido seleccionada; el cierre previo simplemente había quedado obsoleto.

**Reproducción mínima:** `close + maintenance -> resume -> persistence -> outcome(success)`. Antes del fix el outcome era aceptado. Después del fix el mismo intento devuelve `mssr-success-outcome-blocked-stale-close` hasta ejecutar un close/maintenance nuevo.

**Causa:** el coordinador conservaba skills requeridas/cargadas y estado `closed`, pero no una generación de lifecycle que relacionara el último trabajo/persistencia con el último close y maintenance. La reconstrucción desde SQLite/JSONL tampoco preservaba esa frescura.

**Corrección aplicada:** se añadieron `maintenanceRequired`, `lifecycleRevision`, `closeRevision` y `maintenanceRevision`; replans no-close y persistence invalidan cierres previos, mientras un `phase_completed` de maintenance sólo sella la generación del close actual. `partial`, `failed` y `skipped` siguen siendo registrables. El estado se reconstruye desde eventos existentes, sin migración de DB ni hard-codear el nombre de una skill.

**Regresión:** `test-mssr-trace-contract.mjs` cubre el caso rojo, recuperación con close fresco y reconstrucción tras pérdida de memoria del coordinador; `test-delegated-mssr-route-project.mjs` migra el flujo nominal. `npm run test:regressions` pasó completo. En el Bridge vivo, la traza `mssr-20260807175750-4dfea939-84f` fue bloqueada deliberadamente tras la última persistence con `lifecycleRevision=4`, `closeRevision=0`, `maintenanceRevision=0`.

**Persistencia:** MSSR `6669d92f4842ce50a0e4991bd2eb69cffe223519`; Bridge `6eebd2016e68233bd94f61032b2b3045c1bd2a27`; ambos publicados y verificados por HEAD, tracking ref y ref remota directa.

**Seguimiento:** cerrado para `trace-contract-v1`. Mantener la invariancia: cualquier trabajo o persistence posterior al último close/maintenance exige un nuevo close antes de `outcome(success)`.

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
---

## 2026-07-27 - Tool Portfolio ignoraba el uso real detrás de fallbacks delegados

**Estado:** Corregido en Bridge 0.6.36.

**Síntoma:** Una ejecución correcta de `bridge_tool_query -> bridge_tool_audit` aumentaba el contador del fallback, pero `bridge_tool_audit` seguía apareciendo con cero llamadas y sin evidencia. El mismo sesgo afectaba a cualquier tool accesible sólo mediante el catálogo runtime, inflando `fallback-overuse` y la cantidad de tools aparentemente no usadas.

**Causa:** SQLite ya guardaba el target delegado como `operation_subject`, pero `getToolAuditMetrics()` agrupaba exclusivamente por la columna `tool` exterior.

**Corrección:** La proyección del audit conserva la fila física del fallback y agrega una segunda atribución virtual al `operation_subject` cuando la tool exterior es `bridge_tool_query` o `bridge_tool_action`. No se duplica almacenamiento ni se guardan argumentos crudos.

**Regresión:** `test-v060-tools.mjs` registra una llamada delegada y exige evidencia simultánea para `bridge_tool_query` y `bridge_tool_audit`, incluyendo éxito del target.

---

## 2026-07-27 - Bootstrap de verificación avisaba que faltaba la skill que acababa de cargar

**Estado:** Corregido en Bridge 0.6.37.

**Síntoma:** `skill_bootstrap` avanzaba una traza a `verify`, devolvía `git-change-publication` con `loaded: true`, pero la misma llamada emitía `mssr-required-skill-not-loaded` para esa skill.

**Causa:** El coordinador evaluaba el gate de frontera en `prepare()` antes de ejecutar el bootstrap. La atribución de `record.loaded` ocurría después, en `observe()`, por lo que el aviso usaba el estado anterior a las cargas producidas por la propia llamada.

**Corrección:** Los route plans continúan verificando la frontera antes de ejecutar, pero `skill_bootstrap` difiere el gate hasta `observe()`, inmediatamente después de incorporar sus cargas al `loadedSkills` de la traza.

**Regresión:** `test-delegated-mssr-route-project.mjs` ahora avanza la misma ruta delegada desde `start` hasta `verify`, introduce una skill requerida nueva y exige que no se emita `mssr-required-skill-not-loaded`, tanto con sesión identificada como con `sessionKey=unknown`.


---

## 2026-07-27 - Caller stateless con varias trazas no podía atribuir tools genéricas

**Estado:** Corregido en Bridge 0.6.38.

**Síntoma:** Una automatización Web abría correctamente una ruta mediante `bridge_tool_query -> skill_bootstrap`, pero las llamadas directas posteriores llegaban con `sessionKey=unknown` y sin task key. Cuando coexistían varias trazas Web frescas, herramientas como `git_status` o `read_file_lines` quedaban `unrouted`; elegir una automáticamente habría mezclado tareas concurrentes.

**Causa:** La recuperación segura sólo podía usar sesión, proyecto, caller y frescura. Los wrappers forward-compatible no ofrecían un campo de control para conservar un `traceId` explícito al delegar una tool cuyo schema no declara `traceId`.

**Corrección:** `bridge_tool_query` y `bridge_tool_action` aceptan un `traceId` opcional a nivel del wrapper. El coordinador adopta esa traza para observabilidad; sólo reenvía el campo al target cuando éste declara `traceId`, preservando schemas genéricos y la protección contra ambigüedad.

**Regresión:** `test-delegated-mssr-route-project.mjs` mantiene dos trazas frescas abiertas, reinicia la memoria del coordinador y delega `search_files` con el `traceId` elegido. Exige ausencia de avisos ambiguos/unrouted y atribución exacta de la métrica del wrapper.

---

## 2026-07-27 - Una sesión Web no distinguía workflows, tareas, trazas y generaciones runtime

**Estado:** Corregido en Bridge 0.6.39; aislamiento trace-scoped completado en 0.6.40; consumo explícito de identidad pendiente completado en 0.6.41.

**Capa / owner:** Identidad y correlación de observabilidad / `bridge-mcp` + skill `mssr-observability-maintenance`.

**Síntoma:** Un mismo chat o scope MCP podía contener varias tareas y trazas relacionadas. `sessionKey`, `taskKey`, `traceId` y PID existían, pero no había una identidad estable para agrupar ciclos recurrentes ni una generación UUID por arranque. Reconstruir qué tools, skills, runtime, verificación, persistencia y evidencia pertenecían a una traza exigía consultar varias superficies manualmente. Un aviso de inactividad tampoco demostraba que ChatGPT hubiera entregado el cierre al usuario.

**Causa:** `sessionKey` identifica únicamente el scope opaco que expone el host; `taskKey` deriva del texto de tarea; `traceId` pertenece a una ejecución lógica; y PID identifica el proceso actual, pero puede atender muchas tareas y ser reutilizado por el sistema operativo. Faltaban un `workflowKey` local estable, un `runtimeBootId` por arranque y una proyección unificada por traza.

**Corrección:** Se añadió `workflowKey` opcional a `project_context_load`, routing y bootstrap; `runtimeBootId` UUID a status, métricas y eventos MSSR; y la tool protegida read-only `mssr_trace_evidence`, que correlaciona eventos, llamadas, skills, task/session/workflow keys, generaciones runtime y `evidenceRef` explícitos. Una traza existente conserva sus propias identidades; una ruta nueva exige workflow y tarea explícitos y consume el contexto pendiente una sola vez. Los períodos idle continúan generando recordatorios y nunca sintetizan outcomes exitosos.

**Regresión:** `scripts/test-v060-tools.mjs` exige 126 tools, propagación del workflow al `nextAction`, UUID de runtime, evidencia open/closed, cardinalidad de tools y privacidad sin prompts, transcripts ni argumentos crudos. Después del primer readback vivo se añadió un caso con dos trazas bajo el mismo `sessionKey`: la traza `unscoped` debe seguir `unscoped`, una traza scoped no puede ser reasignada por metadata posterior y una ruta nueva sí debe aceptar su workflow explícito.

**Seguimiento:** Los ciclos programados de mantenimiento deben usar `workflowKey=mauroprime-system-loop`, abrir una traza nueva por ejecución, conservarla entre fases y cerrarla con un único outcome verificable. No inferir `conversation_id`, `message_id` ni `automation_run_id` si el host no los expone.

---

## 2026-07-27 - `skill_bootstrap` era un cargador agregado de `SKILL.md` completos

**Estado:** Corregido en Bridge 0.6.42.

**Capa / owner:** Ensamblado de contexto procedural / `bridge-mcp` adapter + contrato portable MSSR.

**Síntoma:** MSSR seleccionaba correctamente las skills activas de una fase, pero el Bridge recorría el `loadOrder` y devolvía cada archivo `SKILL.md` completo. Las references modulares sólo reducían el archivo principal o servían como navegación manual; no existían selección automática, presupuesto global ni métricas de presión de contexto.

**Causa:** `loadCodexSkill` era una lectura UTF-8 completa y `skill_bootstrap` lo reutilizaba para todas las skills activas. El adapter no distinguía núcleo obligatorio, módulos condicionados por intent/fase, compatibilidad heredada ni límite de caracteres.

**Corrección:** Se añadió `src/skill-context-assembler.ts` y `skill_bootstrap` usa `contentMode=selective` por defecto. El assembler lee `context-modules.json`, materializa headings exactos o references internas, bloquea escapes de carpeta, selecciona módulos mediante `@mauroprime/mssr`, aplica `maxContextChars`, conserva `full`/`skill_load` y devuelve `contextAssembly` con ahorro, fallback, grupos ambiguos, skip y overflow. El presupuesto omite completa una skill opcional que no cabe; sólo una requerida puede desbordar. Los módulos en un mismo `exclusiveGroup` cargan un ganador único o, ante empate, devuelven candidatos sin inyectar reglas contradictorias. El observatorio registra sólo metadata acotada, nunca el texto procedural.

**Regresión:** `test-selective-skill-context.mjs` cubre selección real, core-only, full exacto, manifest missing, ambigüedad exclusiva y traversal. `test-delegated-mssr-route-project.mjs` exige modo selectivo, continuidad de trace y descarte controlado de contexto opcional por presupuesto. La primera muestra cargó 6.525 de 9.955 caracteres para `mssr-agent-routing`, ahorrando 3.430.

**Fricción durante la corrección:** Un patch textual amplio encontró tres bloques equivalentes y se negó a aplicar; el cambio se reejecutó por rango exacto. Una escritura de incidente fue invocada inicialmente sin `append=true`, se detectó por caída de tamaño/hash, se restauró desde Git y se repitió como append verificado. Ambas protecciones evitaron conservar una mutación ambigua o destructiva.

---

## 2026-07-28 - El presupuesto secuencial podía privar módulos relevantes a skills requeridas posteriores

**Estado:** Corregido en Bridge 0.6.43.

**Capa / owner:** Planner global de contexto procedural / `bridge-mcp`.

**Síntoma:** `skill_bootstrap` ya ensamblaba cada skill selectivamente, pero consumía `maxContextChars` siguiendo `route.loadOrder`. Una skill requerida temprana podía cargar módulos opcionales grandes y dejar a una skill requerida posterior sólo con su core, aunque el módulo posterior tuviera mayor score y correspondiera mejor al intent.

**Evidencia:** Una ejecución real con 18.000 caracteres cargó módulos opcionales de `mssr-agent-routing` y `shared-skill-governance`, mientras `skill-routing-maintainer` perdió `routing-maintenance-loop` por presupuesto pese a ser requerida en implementación. La misma traza se convirtió en fixture controlada con dos skills requeridas: la posterior posee el módulo globalmente más relevante.

**Corrección:** El planner `global-required-core-first` materializa todos los candidatos antes de asignar presupuesto. Reserva todos los cores requeridos, luego módulos requeridos, ordena globalmente módulos opcionales de skills requeridas, admite skills opcionales como paquetes mínimos indivisibles y finalmente ordena sus módulos opcionales. También detecta secciones ya contenidas en contexto cargado y evita reinjectarlas, reportando `duplicateCharsAvoided`.

**Observabilidad:** El resumen MSSR agrega cargado/full/ahorrado, fallbacks, skips, overflow, duplicación evitada, trazas recientes, modos de planner y presión por skill. El dashboard expone estas métricas y recomendaciones de migración basadas en ejecuciones observadas.

**Migración:** `conversation-history-review` recibió manifest al aparecer como fallback completo repetido. Los cores grandes existentes no se redujeron sin más evidencia: contienen invariantes transversales y ahora quedan señalados por el dashboard para revisión posterior. No se añadió un `exclusiveGroup` real porque no apareció una pareja de procedimientos mutuamente excluyentes; mantener la fixture negativa evita inventar exclusividad.

**Regresión:** `test-selective-skill-context.mjs` prueba starvation global y deduplicación; `test-delegated-mssr-route-project.mjs` exige reserva de todos los cores requeridos y resumen observable; `bridge_verify_all` valida dashboard, schema, routing y runtime vivo.

---

## 2026-07-28 — Una guía inválida bloqueó toda la carga de contexto

**Estado:** Corregido, publicado y verificado en el servicio vivo `0.6.44`.

**Capa / owner:** `src/tools/workflow-guide-tools.ts`, `project_context_load`, `workflow_guide_recommend` y `workflow_guide_load`.

**Síntoma:** una guía concurrente que superaba el límite de `activation.phrases` hacía fallar el descubrimiento completo. `project_context_load` no devolvía contexto durable ni recomendaciones, aunque el resto de las guías era válido.

**Reproducción mínima:** colocar bajo `.bridge/workflow-guides` una `guide.json` con 41 frases, o 25 fases, y ejecutar `project_context_load` con `includeGuides=true`.

**Causa:** `discoverInRoot()` validaba cada manifest, pero no aislaba excepciones por directorio. El error de una sola guía salía del loop y abortaba todo el catálogo.

**Corrección:** la validación permanece estricta; no se elevan límites ni se truncan arrays. Cada directorio inválido produce `guideWarnings`, se excluye del catálogo y permite continuar con las demás guías. Un proyecto inválido no cae silenciosamente a una guía global homónima. La carga explícita del nombre inválido falla con su razón exacta.

**Regresión:** `scripts/test-v060-tools.mjs` crea fixtures con 41 frases y 25 fases; exige que contexto y recomendación sobrevivan con dos warnings, y que `workflow_guide_load` rechace claramente la guía inválida.

**Verificación final:** el watchdog reinició HTTP desde `0.6.43` a `0.6.44`; `bridge_verify_all` pasó todos los gates obligatorios, incluido doctor, typecheck, build, smoke HTTP, regresiones, 162 casos efectivos de routing y documentación de 126 herramientas. Un `project_context_load` vivo posterior devolvió contexto, catálogo y recomendación sin abortar.
---

## 2026-07-28 — `roblox_place_save` no pudo confirmar foreground de una ventana exacta

**Estado:** Mitigado en la operación; causa de plataforma no resuelta y sin cambio de código.

**Capa / owner:** `roblox_place_save` y `scripts/roblox-studio-save.ps1` / `bridge-mcp`.

**Síntoma:** La herramienta identificó una única ventana `D:\Dev\MyceliumFront\1.rbxl - Roblox Studio` (PID `19488`), pero `SetForegroundWindow` y `AppActivate` no lograron que `GetForegroundWindow()` devolviera su handle. El script abortó correctamente antes de enviar `Ctrl+S`.

**Reproducción mínima / evidencia:** El fallo ocurrió con `roblox_place_save` y se repitió al invocar el mismo script inmediatamente después de restaurar y enfocar Studio desde el capturador local. En ambos intentos el mensaje fue `Roblox Studio window could not be confirmed as foreground; Ctrl+S was not sent`.

**Causa:** `No resuelta`. La evidencia apunta a la política de foreground de Windows para procesos no interactivos; la selección de proceso, título y handle fue correcta.

**Mitigación aplicada:** Un helper temporal exigió una coincidencia exacta única, realizó un solo clic acotado sobre la barra de título, verificó el handle foreground y delegó al mismo `roblox-studio-save.ps1`. El script oficial devolvió `foregroundConfirmed=true`, envió sólo `Ctrl+S` y el helper fue eliminado.

**Prueba observable:** El SHA-256 de `1.rbxl` cambió de `0834d7875f90e7d463762e3d34a701b865988faff775844f9b20ce8b723410dc` a `52bf6084ceaff69744b0db1a2f3b94049ef00c2f7b49fdbc7e57d789aa9a43ed`; Studio permaneció en Edit y la escena guardada conservó la reparación esperada.

**Seguimiento:** Evaluar un fallback interno igualmente acotado para activación por clic de barra de título, con coincidencia exacta, restauración del cursor, aborto seguro y regresión aislada. No generalizar ni modificar la tool hasta reproducirlo otra vez o disponer de una prueba automatizable de alto impacto.
**Actualización 2026-07-28 — segunda aparición confirmada:** En otra sesión sobre el mismo place, `roblox_place_save` volvió a identificar correctamente PID `19488` y el título exacto `D:\Dev\MyceliumFront\1.rbxl - PlantViewport - Roblox Studio`, pero abortó antes de `Ctrl+S` porque no pudo confirmar foreground. `roblox_studio_window_capture_save`, acotado al mismo `placePath`, sí obtuvo `foregroundConfirmed=true`; el segundo `roblox_place_save` oficial guardó y verificó el cambio de SHA-256 `72393c3f5f5340687d69cb59bafe0493e183ec41a6a8cf3d1b6d43f0b5406201` → `5c1adf6f24a05604ffa8862d9c9e22a88c5941c43c8cff09f2079d46293e1f9d`. La recurrencia justifica investigar un fallback interno acotado reutilizando la activación segura ya demostrada por la captura; todavía no demuestra la causa de plataforma ni autoriza relajar la comprobación de foreground.

---

## 2026-07-28 — `execute_luau` en Client devolvió 502 y perdió temporalmente el target activo

**Estado:** No resuelta; mitigada con payload acotado, selección explícita de Studio y prueba de replicación desde un `Script` de arranque normal.

**Capa / owner:** proxy Roblox Studio, transporte HTTP y lifecycle de selección de Studio / `bridge-mcp`.

**Síntoma:** Durante la verificación de 13 plantas en Play, una llamada `execute_luau` sobre el DataModel `Client` con recorrido y JSON detallado devolvió `502: Upstream or external service errors`. El readback inmediato de `roblox_mcp_status` terminó sin respuesta; al recuperarse, la conexión veía `1.rbxl` pero había perdido el target activo. Un segundo intento grande, ya fijado al `studioId` exacto, repitió el 502.

**Reproducción mínima / evidencia:** Studio permaneció abierto y respondía en PID `19488`; `get_studio_state` confirmó que Play seguía activo con Client y Server. Entre los readbacks se observó Bridge `0.6.48` donde antes operaba `0.6.47`, pero no está demostrado que el payload causara el cambio de runtime. `roblox_mcp_studio_list(refresh=true)` recuperó el Studio `d25941ab-7d41-4e81-8631-427ec6e9c9fe` y permitió volver a fijarlo atómicamente.

**Causa:** `No resuelta`. La evidencia no separa con certeza límite o duración del payload Client, fallo upstream del proveedor, transición concurrente del Bridge ni pérdida de selección durante la reconexión.

**Mitigación aplicada:** Se dejó de reintentar el payload grande. La prueba real se movió a un `Script` temporal preexistente en Edit, ejecutado por el servidor durante el arranque normal de Play; el Client sólo realizó un sondeo Luau corto y acotado. Las llamadas posteriores fijaron el `studioId` exacto.

**Prueba de regresión operativa:** El Client devolvió `CLIENT_STARTUP_OK models=13 ports=52 parts=505 uniqueSilhouettes=13 revision=9 contract=CanonicalPlantVisualV2 serverVerified=true`. Play se detuvo y el arnés temporal fue eliminado con `leftovers=0`.

**Seguimiento:** Crear una reproducción aislada que compare payload Client corto y grande, mida tamaño/duración, preserve `studioId` y `runtimeBootId`, y diferencie explícitamente timeout upstream, restart del Bridge y pérdida de target. No atribuir el 502 al juego ni aumentar reintentos ciegos hasta demostrar la capa causal.

---

## 2026-07-30 — El schema estricto de intent MSSR bloqueaba la recuperación de vocabulario de ChatGPT Web

**Estado:** Corregido, publicado y verificado en Bridge 0.6.50.

**Capa / owner:** herramientas `skill_recommend`, `skill_route_plan` y `skill_bootstrap`, más observabilidad MSSR / `bridge-mcp`.

**Síntoma:** un caller que enviaba una categoría cercana pero no canónica podía ser rechazado por el schema MCP antes de llegar al router. El error no ofrecía una continuación reutilizable y hacía más probable que ChatGPT Web abandonara MSSR o improvisara otra llamada.

**Reproducción mínima:** llamar routing con aliases inequívocos como `local_app_development`, `inspect` y `bounded-write`, o con valores desconocidos como `bridge-mcp`, `animate` y `verification-needed`.

**Causa:** el borde de transporte y el parser canónico compartían el mismo vocabulario cerrado. Esa combinación era correcta para el motor determinista, pero no dejaba una capa de recuperación entre un error de vocabulario del modelo y la ejecución del router.

**Corrección:** el transporte acepta strings acotados; una capa nueva normaliza sólo aliases explícitos o valores canónicos ubicados de forma inequívoca en otro campo. Los valores desconocidos nunca se adivinan: devuelven candidatos, `routed=false` y un `recoveryAction` que reutiliza la misma traza. La telemetría guarda IDs allow-listed, campos y códigos, no los valores arbitrarios recibidos.

**Regresión:** `test-mssr-intent-normalization.mjs` cubre intent canónico, aliases, reubicación, ambigüedad, campos requeridos vacíos tras normalizar, recuperación same-trace y redacción. La suite completa pasó; el runtime vivo 0.6.50 normalizó los tres aliases y bloqueó el caso desconocido sin ejecutar routing.

**Fricción adicional:** durante la actualización se confundió inicialmente documentación indexada antigua con el estado actual del SDK. La verificación contra npm y documentación oficial confirmó que los paquetes v2 son estables, pero que el protocolo `2026-07-28` requiere opt-in y cambia el lifecycle sessionful. Se actualizó únicamente la rama v1 mantenida a 1.30 y se documentó una migración dual-era en `docs/MCP_V2_MIGRATION.md`.

**Seguimiento:** implementar la ruta moderna v2 en una iteración separada, manteniendo el handler sessionful legado delante de un handler moderno estricto y exigiendo pruebas vivas del túnel antes de retirar cualquier rollback.

---

## 2026-07-30 — El smoke HTTP rechazó el identificador correcto del transporte dual-era

**Estado:** Corregido y verificado contra el runtime vivo 0.6.51.

**Capa / owner:** verificación HTTP y release / `bridge-mcp`.

**Síntoma:** después de publicar y activar Bridge 0.6.51, `verify:all` aprobó doctor, build, dual-era, regresiones, routing y documentación, pero `smoke:http` falló con `Unexpected transport: streamable-http-dual-era`.

**Reproducción mínima / evidencia:** el runtime vivo respondió versión `0.6.51`, `transport=streamable-http-dual-era`, ruta legacy sessionful y ruta moderna `2026-07-28` sin sesiones. El script `test-bridge-http.ps1` todavía exigía igualdad literal con el valor anterior `streamable-http`.

**Causa:** el release cambió deliberadamente el identificador observable del transporte, pero el gate legado no se actualizó en el mismo lote.

**Corrección:** actualizar el smoke para aceptar exclusivamente el nuevo identificador y validar además los invariantes de ambas eras: legado sessionful, moderno `2026-07-28` y moderno sin sesión MCP.

**Regresión:** `smoke:http`, `test:mcp-dual-era` y `verify:all` deben pasar juntos contra el runtime vivo.

**Seguimiento:** cuando un campo de `/status` cambie como parte de un release, actualizar su consumer de verificación en el mismo commit y ejecutar el smoke contra un runtime efímero antes de publicar.

---

## 2026-07-30 — ChatGPT Web sólo expuso directamente 3 de 11 schemas MSSR

**Estado:** Mitigado en Bridge 0.6.52; la selección privada del catálogo del host permanece fuera del control de Bridge.

**Capa / owner:** catálogo del conector Web, fallback dispatch y observabilidad / `bridge-mcp` más host OpenAI.

**Síntoma:** un chat Web nuevo observó directamente sólo `skill_catalog`, `skill_recommend` y `skill_load`. Las otras ocho tools del núcleo MSSR estaban presentes en el runtime, pero seis requerían `bridge_tool_query` y dos `bridge_tool_action`.

**Reproducción mínima / evidencia:** Bridge 0.6.51 publicó 126 tools con hash `f8786f2168cf6e18`; la auditoría Web registró cobertura MSSR directa `3/11` (27,27 %), 1063 usos de `bridge_tool_query` y 306 de `bridge_tool_action`. Alcanzabilidad por wrapper no demostró exposición directa.

**Causa:** Bridge puede publicar y listar su catálogo, pero no puede inspeccionar ni forzar la selección privada de schemas que el host entrega al modelo. Antes de esta corrección tampoco existía una comparación canónica que recibiera la observación visible del caller y la contrastara sin inferencias.

**Corrección:** se añadió `bridge_connector_catalog_compare`. Recibe únicamente nombres de tools observables suministrados por el caller, los valida contra el catálogo vivo y devuelve hash, cobertura total, cobertura MSSR, nombres no reconocidos y separación de fallbacks query/action. No guarda argumentos crudos ni afirma que una ausencia de uso prueba ausencia de schema.

**Regresión:** `test-v060-tools.mjs` reproduce el baseline directo 3/11, exige 27,27 %, clasifica `skill_bootstrap` como fallback query y `mssr_trace_record` como fallback action, y conserva explícitamente `wrapperReachabilityIsDirectExposure=false`.

**Seguimiento:** usar la comparación en chats nuevos o después de refrescar el conector. Sólo atribuir una mejora al host cuando cambie la lista directa observada; no retirar wrappers mientras la cobertura dedicada permanezca incompleta.

## 2026-07-30 — ChatGPT Web necesitaba discovery repetido para tools MSSR omitidas

**Estado:** Corregido en Bridge 0.6.53; la selección privada del catálogo del host sigue fuera del control de Bridge.

**Síntoma:** Chats nuevos exponían 102/127 tools directas pero sólo 3/11 tools MSSR. Para alcanzar `skill_bootstrap`, algunas ejecuciones buscaban documentación o schemas antes de usar `bridge_tool_query`, aumentando latencia y períodos sin feedback. El dashboard mostraba outcomes y loads, pero no separaba la ruta física directa/delegada ni el tiempo hasta la primera acción de dominio.

**Reproducción / evidencia:** La auditoría Web sobre runtime 0.6.52 y hash `c533eb541503ab88` observó 102 tools directas, MSSR directo 3/11, transporte legacy y `bridge_connector_catalog_compare` accesible sólo mediante query. El reinicio del conector no cambió esa selección.

**Causa:** El host decide qué schemas dedicados publica. Bridge ya ofrecía wrappers seguros, pero el contrato exigía schema-first incluso cuando una respuesta MSSR acababa de construir argumentos exactos. La proyección por perfil no unía `mssr_events` con las llamadas físicas correlacionadas por `trace_id`.

**Corrección:** Routing devuelve una política `direct-then-delegated` y `nextAction.fallback` listo para ejecutar. Los wrappers permiten saltar discovery cuando Bridge ya suministró argumentos autoritativos. El observatorio agrega directas, query, action, tasa fallback, desvíos preparatorios, primera acción, span y recordatorios idle por caller/modelo, manteniendo una sola llamada física y un objetivo lógico delegado.

**Regresión:** `scripts/test-v060-tools.mjs` exige fallback exacto para `skill_bootstrap`, verifica que los wrappers no fuercen discovery redundante y proyecta una traza mixta con 2 llamadas directas, 1 query y 1 action sin duplicar cardinalidad. La suite completa y el dashboard HTTP validan el contrato.

**Seguimiento:** Comparar estas métricas en chats Web nuevos y observar si futuras revisiones del host elevan la exposición MSSR directa o negocian MCP moderno. No interpretar idle como prueba de render o razonamiento privado.

---

## 2026-07-30 — Integración de GLB local en Roblox bloqueada por ausencia de importador/assetId verificable

**Estado:** Corregido y verificado en Bridge 0.6.54 y MyceliumFront.

**Capa / owner:** capacidad de importación de assets del conector Roblox Studio / Bridge y flujo de handoff de modelos locales.

**Síntoma:** el paquete B003 de MyceliumFront contiene Hero/LOD1/LOD2 GLB verificados, pero el catálogo vivo de Studio sólo ofrece `insert_asset` por assetId numérico y no un importador de GLB local. No existe un assetId ni una fuente B003 en Studio, ReplicatedStorage o ServerStorage.

**Reproducción mínima / evidencia:** con Studio único `1.rbxl` activo en Edit, `roblox_mcp_tool_list` expone 27 tools; `insert_asset` exige `assetId`, mientras que la búsqueda de `B003` y `mushroom-single-b-family` no devuelve instancias. Los archivos locales se verificaron contra `lod-package-report.json`: Hero `eaecef87…`, LOD1 `c682f553…`, LOD2 `ce0760fe…`.

**Causa:** el conector soporta inserción de contenido ya registrado en Roblox, no ingestión de un `.glb` arbitrario desde disco. Un import manual o un uploader propietario no puede sustituirse por una geometría procedural ni por un assetId inventado.

**Corrección aplicada:** Bridge 0.6.54 añadió `roblox_asset_upload`, un uploader batch de Model GLB/GLTF/FBX mediante Open Cloud con SHA-256 obligatorio, confirmación exacta de creator, secreto sólo por variable de entorno, polling, readback y manifiesto sin secretos. Como el entorno actual no tenía API key, el primer lote se importó mediante el 3D Importer autenticado de la única Studio abierta. Hero/LOD1/LOD2 quedaron montados como templates visuales de `MushroomPortVisual`; `InteractionRoot`, EntityId, puertos y hitbox permanecieron independientes.

**Regresión / gate:** `test-v060-tools.mjs` valida schema, clasificación destructiva y error seguro sin variable de entorno; el catálogo vivo 0.6.54 expone 128 tools e incluye `roblox_asset_upload`. MyceliumFront verificó los tres templates, cero visuales colisionables/consultables, una sola variante LOD visible en Client, cero errores Client/Server, post-Stop limpio y guardado con SHA-256 `D775732F8258A2F40036090356304865672E3A645ED1B69B502ED3FDAB183730`.

**Seguimiento:** configurar `ROBLOX_OPEN_CLOUD_API_KEY` sólo en entornos autorizados para que futuros agentes usen la ruta no interactiva. Mantener el 3D Importer como fallback autenticado y registrar como fricción cualquier carrera de replicación o fallo de confirmación de foco durante guardado.

---

## 2026-07-30 — La primera selección LOD del cliente compitió con la replicación inicial

**Estado:** Corregido y verificado en `1.rbxl`.

**Capa / owner:** lifecycle Client/Server del controlador LOD / MyceliumFront.

**Síntoma:** el atributo cliente indicaba `LOD2`, pero una inspección inicial encontró simultáneamente 40 piezas Hero y una pieza LOD2 visibles.

**Reproducción mínima / evidencia:** crear un `MushroomPortVisual` en Server dentro de una VM fresca y observarlo en Client después de la primera muestra del controlador. El servidor replicó propiedades del Hero después de la primera aplicación local.

**Causa:** `SetLOD` retornaba temprano al ver que `ActiveLOD` ya coincidía, aunque las transparencias replicadas todavía no estaban estabilizadas.

**Corrección:** cada transición nueva se reaplica durante tres muestras de 0,2 segundos; después el controlador deja de tocarla. El loop sigue siendo compartido y conserva máximo un Hero.

**Regresión:** Client fresco terminó con `LOD2=5/5`, `Hero=0/72`, `LOD1=0/5`, controlador presente y cero errores; Server conservó `InteractionRoot` y la hitbox.

**Seguimiento:** si la replicación vuelve a sobreescribir presentación local, medir el orden de propiedades y migrar la visibilidad a una propiedad exclusivamente local en lugar de aumentar muestras sin evidencia.

---

## 2026-07-30 — Edición Studio reportó éxito sin aplicar un reemplazo y el primer guardado no obtuvo foco

**Estado:** Recuperado; seguimiento abierto para las herramientas propietarias.

**Capa / owner:** Roblox Studio MCP `multi_edit` y Bridge `roblox_place_save`.

**Síntoma:** `multi_edit` informó dos ediciones aplicadas sobre `ConnectionFactory`, pero el readback no contenía `resolvedSourcePortId` y una prueba invertida conservó cactus→girasol. Más tarde, el primer `roblox_place_save` rechazó correctamente enviar `Ctrl+S` porque no pudo confirmar Studio como foreground.

**Reproducción / evidencia:** después del resultado exitoso de `multi_edit`, `script_grep("resolvedSourcePortId")` devolvió cero coincidencias y el probe runtime produjo `source=C003_Harness_13_CactusSentry`. El guardado devolvió `Roblox Studio window could not be confirmed as foreground; Ctrl+S was not sent`, PID `19488`.

**Causa:** la causa del falso positivo de `multi_edit` queda no resuelta. El fallo de guardado fue una restricción observable de foco de Windows, no pérdida de estado de Studio.

**Corrección:** se reaplicaron dos reemplazos literales separados y se exigió readback antes de Play. La prueba fresca produjo `source=SolarBloom`, `target=CactusSentry`, `flow=2`, `Powered=true` y balance `0`. Para persistir, se enfocó exclusivamente la ventana confirmada por PID/título y se repitió `roblox_place_save`, que verificó `1.rbxl` con SHA-256 `5077B3F43DDE1476C006E5D3FB4E0E39AE9AC5F1B28BEDCCFA95BE53F99ED9E7`.

**Regresión:** nunca aceptar éxito de mutación Studio sin `script_read`/`script_grep`; nunca sustituir el guardador acotado por un `Ctrl+S` no verificado. El segundo guardado confirmó Edit, ruta exacta, foreground y cambio de mtime.

**Seguimiento:** auditar por qué `multi_edit` contabilizó como aplicada una sustitución ausente y mejorar la recuperación de foco de `roblox_place_save` sin ampliar su alcance.

**Recurrencia observada:** en la corrección inmediatamente posterior, `roblox_place_save` volvió a rechazar dos veces el mismo PID/título aunque `WScript.Shell.AppActivate()` devolvió `true`. El fallback acotado activó ese título exacto, envió sólo `Ctrl+S` y verificó que el SHA-256 de `1.rbxl` cambió de `5077B3F43DDE1476C006E5D3FB4E0E39AE9AC5F1B28BEDCCFA95BE53F99ED9E7` a `A942A9D434BCDAAE31E8D93C3BD5808864AED1FF3C0A17EB9757CF58763E50E2`. Esto confirma que la recuperación de foco necesita un gate alternativo verificable.

## 2026-07-30 — Studio QA cannot synthesize GUI button/key input through ExecuteLuau

- **Estado:** Mitigado; no defecto del juego.
- **Capa / owner:** Roblox Studio MCP sandbox / Bridge integration evidence.
- **Síntoma:** `TextButton:Activate()` no existe y `VirtualInputManager:SendKeyEvent` falla con `lacking capability RobloxScript` desde `execute_luau` Client.
- **Reproducción / evidencia:** intento acotado sobre `PlacementGui.OpenBuildButton` durante Play de MyceliumFront; ambas llamadas fueron rechazadas por el sandbox y quedaron en Output.
- **Causa:** el contexto de comandos del Assistant no posee autoridad para sintetizar input de usuario ni una API pública `Activate` en `TextButton`.
- **Corrección aplicada:** se validó el contrato autoritativo mediante atributos replicados y el remoto real `BuildActionRequest`; `RemovePlant` aceptó una planta inicial del jugador y limpió dos conexiones sin dangling.
- **Regresión:** en futuras QA, no usar estas dos APIs como prueba automatizada de UI; separar interacción visual humana de validación de remotos/estado. Clasificar estos mensajes como artefactos de QA, no errores runtime del juego.
- **Seguimiento:** considerar una herramienta MCP dedicada y limitada para input de Play sólo si este bloqueo se repite y la prueba visual humana resulta insuficiente.

## 2026-08-01 — Input y captura de Roblox MCP agotaron tiempo; guardado volvió a rechazar foreground

- **Estado:** No resuelto; el juego y el catálogo se recuperaron sin reiniciar.
- **Capa / owner:** Roblox Studio MCP `user_mouse_input`/`screen_capture` y Bridge `roblox_screen_capture_save`/`roblox_place_save`.
- **Síntoma:** dos llamadas acotadas a `user_mouse_input` agotaron 60 s sin aplicar el clic. Luego `roblox_screen_capture_save` mantuvo una operación activa durante más de dos minutos y no produjo archivo. Tras liberarse la cola, `roblox_place_save` volvió a abstenerse de enviar `Ctrl+S` porque no confirmó foreground para PID `19488` y el título exacto de `1.rbxl`.
- **Evidencia:** `roblox_mcp_status` mostró `activeOperations=1` durante la captura y volvió a `0`; consultas pequeñas Client/Server, Stop y consola funcionaron después. El save devolvió literalmente `Ctrl+S was not sent`.
- **Causa:** no resuelta. El patrón apunta al lifecycle/foco del proveedor, no a la lógica de MyceliumFront.
- **Corrección/recuperación:** no se apilaron mutaciones; se esperó la liberación, se verificó el mismo Studio y modo, se cerró Play por `start_stop_play` y se documentó el guardado como pendiente. Una captura de ventana se usó sólo para revisión preliminar, no como evidencia del pipeline.
- **Regresión:** añadir smoke tests de `user_mouse_input` y `screen_capture` que confirmen finalización/cancelación y cero operaciones activas; mejorar `roblox_place_save` con un gate alternativo verificable sin ampliar el target más allá del PID/título exactos.

- **Recurrencia 2026-08-01, proof CS2:** `roblox_place_save` volvió a rechazar correctamente el primer intento sobre PID `19488` y título exacto `D:\Dev\MyceliumFront\1.rbxl - Roblox Studio` porque no confirmó foreground; `Ctrl+S` no fue enviado. Se seleccionó y activó la única ventana coincidente mediante Computer Use, sin enviar teclas, y se repitió el guardado acotado. El segundo intento confirmó foreground, Edit y cambio de disco de SHA-256 `7f973feeffc2055145eaab797eddaeb05bfb31298460927240247d002bf9d9eb` a `2e109c7241a9be5a83569fcc03c8013eaeff26b8ee027fa0bdfbd502bc635c53`. La causa del fallo inicial de foco sigue no resuelta; queda reproducido el mismo patrón y la misma necesidad de gate alternativo verificable.

- **Recurrencia 2026-08-01, proof CS2 V4:** el catálogo vivo ya no expuso `get_script_source`; el intento falló sin mutación y la recuperación correcta fue refrescar `roblox_mcp_tool_list`, leer el schema vivo y usar `script_read`. Además, `screen_capture` devolvió bytes JPEG (`image/jpeg`, firma `/9j/`) y `image_asset_save` rechazó correctamente el primer destino `.png` antes de escribir; repetir con `.jpg` produjo tres masters válidos de 1360×457 con SHA-256 y dashboard sin archivos faltantes. El primer `roblox_place_save` volvió a abstenerse por foreground; tras activar exclusivamente la ventana exacta mediante Computer Use, el segundo intento verificó cambio de `1.rbxl` de `da5793e9fcf200b357457215a32cd09db6bdc8a57e9f69ea75c9313c051eff49` a `def67f681c5a34be9b63923beb74d35198a7290f8aaa25c9bace52e4b800de42`. Regresión: consumir siempre el catálogo/schema vivo, derivar la extensión desde el MIME/firma y mantener el save fail-closed con recuperación de foco acotada.

- **Recurrencia 2026-08-01, build lab CS2 V5:** cuatro capturas solicitadas con destino `.png` volvieron a reportar `image/jpeg`; se preservaron los originales y se copiaron con extensión `.jpg` antes de registrar el run `crater-seed-cs2-v005-build-lab`, cuyo gate verificó cuatro hashes sin faltantes. `roblox_place_save` identificó PID `19488` y el título exacto pero abortó antes de `Ctrl+S`; Computer Use activó únicamente esa ventana y el segundo intento oficial verificó Edit y cambio de SHA-256 `def67f681c5a34be9b63923beb74d35198a7290f8aaa25c9bace52e4b800de42` → `bce5a4b65d5086ad77dc1af1da230dea9e54adbb7145607320cc197d167a14a5`. El patrón confirma dos seguimientos abiertos: extensión derivada del MIME real y fallback interno de foreground tan acotado como el guardador actual.

---

## 2026-08-05 — Imágenes generadas no podían persistirse desde parámetros de archivo de ChatGPT

**Estado:** Corregido y verificado en source/runtime `0.6.62`; pendiente confirmar la tool dedicada desde un chat nuevo cuyo catálogo directo incluya el schema actualizado.

**Capa / owner:** `src/tools/image-tools.ts`, `src/tools/types.ts`, `src/tool-registry.ts` y contrato de tools ChatGPT Apps/MCP.

**Síntoma:** los resultados de `image_gen` llegaban al chat como referencias de archivo autorizadas, pero `image_asset_save` sólo aceptaba texto Base64/data URL. Pasar un `file_id` como Base64 falló por payload inválido; la ruta temporal `/mnt/data` del host tampoco era visible para el proceso Bridge. Después del restart, el runtime tenía la tool nueva, pero el catálogo directo de la conversación actual permaneció stale.

**Reproducción mínima / evidencia:**

```text
image_asset_save(base64="file_...") -> Base64 inválido
binary_file_info("/mnt/data/...") -> ruta fuera de roots / no compartida
restart Bridge 0.6.62 -> runtime actualizado, catálogo directo del chat sin refresh
```

**Causa demostrada:** el Bridge no declaraba un parámetro superior de archivo ni `_meta["openai/fileParams"]`. Por lo tanto el host no transformaba la referencia autorizada en un objeto con `download_url`, `file_id`, `mime_type` y `file_name`; tratarla como string o ruta local no podía preservar los bytes originales.

**Corrección aplicada:** se añadió `image_asset_import_files`, que:

- declara `files` en `_meta["openai/fileParams"]`;
- acepta objetos de archivo autorizados con `download_url`, `file_id` y MIME/nombre opcionales;
- descarga con límite de tiempo y bytes;
- exige HTTPS, salvo loopback HTTP exclusivo para pruebas locales;
- valida firma real, MIME, dimensiones y extensión;
- persiste exactamente los bytes recibidos, calcula SHA-256 y registra procedencia;
- reutiliza el manifiesto atómico del pipeline de imágenes existente.

**Prueba de regresión:**

- PNG fixture de 67 bytes importado byte por byte, con SHA-256 y dimensiones `1×1` idénticos;
- URL HTTP no-loopback rechazada;
- `npm run check` y `npm run build` pasaron;
- `scripts/test-v060-tools.mjs` pasó con `139` tools y validó schema, riesgo y `openai/fileParams`;
- `npm run docs:tools` y `npm run docs:tools:check` pasaron;
- Bridge reinició correctamente en `0.6.62`.

**Seguimiento:** abrir una conversación nueva y ejecutar `image_asset_import_files` mediante su schema directo con un resultado real de `image_gen`. La recuperación exacta desde caché local de Chrome funcionó para este incidente, pero no debe convertirse en el flujo normal ni en sustituto del parámetro de archivo autorizado.

## 2026-08-05 — `blender_viewport_screenshot` aceptaba framebuffers anteriores como evidencia de la vista actual

**Estado:** Corregido y verificado en source/runtime `0.6.63`.

**Capa / owner:** `integrations/blender/mauro_blender_bridge.py`, `src/tools/blender-tools.ts`, `scripts/blender-viewport-window-capture.ps1` y contrato de evidencia visual Blender.

**Síntoma observable:** después de cambiar `region_3d` entre vistas ortográficas, la herramienta podía devolver un PNG del framebuffer anterior. Se reprodujo metadata `LEFT` acompañada por píxeles de `RIGHT`; hashes distintos, objetos existentes y quaternions correctos no detectaban por sí solos la falsedad semántica. Un trace previo cerró 6/6 usando esas capturas.

**Experimentos descartados:** retrasar `bpy.ops.screen.screenshot_area`, forzar `tag_redraw`/`redraw_timer` y dibujar mediante `GPUOffScreen` no garantizó el lado visible actual de pares de Image Empties coplanares.

**Causa raíz:** la captura ocurría sobre memoria/framebuffer de Blender que no necesariamente había sido presentado tras el cambio programático de vista. El contrato confundía orientación runtime con frescura de píxeles.

**Corrección:** Blender entrega PID, región exacta y orientación observada mediante `get_viewport_capture_context`; Bridge enfoca y valida esa ventana exacta, espera un intervalo acotado y captura mediante `CopyFromScreen` sólo la región cliente del viewport. El comando directo antiguo ahora falla explícitamente como freshness-unsafe.

**Regresión:** `scripts/test-blender-viewport-capture.mjs` exige pinning por PID, bounds del viewport, validación de foreground, resize acotado, ausencia de `screenshot_area` y uso del helper exact-window. La prueba viva en un Blender nuevo, puerto `9879`, produjo seis capturas cardinales correctas y distintas en `electronics-repair-simulator/blender/review/workbench_v004/bridge_063_live`.

**Contrapartida conocida:** se capturan los píxeles realmente presentados; un overlay visible sobre Blender también puede aparecer. La revisión semántica debe abrir los PNG y rechazar evidencia obstruida, no confiar sólo en metadata o hashes.
## 2026-08-05 — La sesión Blender conectada no demostraba proyecto correcto ni concurrencia segura

**Estado:** Corregido y verificado en runtime `0.6.64` con addon Blender `0.3.0`.

**Capa / owner:** `integrations/blender/mauro_blender_bridge.py`, `src/tools/blender-tools.ts`, `src/tools/image-tools.ts`, `integrations/images/prepare_reference_pack.py` y skills Blender.

**Síntoma observable:** una herramienta podía encontrar un puerto Blender sano y continuar aunque ese puerto perteneciera a otro `.blend`. El estado no exponía última carga/guardado, modificación en disco, dirty state ni actividad reciente humana. Además, generar referencias mientras Mauro modelaba no tenía un modo contractual que prohibiera foco, captura o mutación del Blender vivo.

**Riesgo:** trabajar sobre el proyecto equivocado, robar foco, reencuadrar el viewport, mezclar cambios humanos y del agente, guardar accidentalmente una escena dirty o instalar referencias durante una sesión de modelado activa.

**Corrección:** el addon publica ruta exacta, PID, estado dirty/saved, timestamp de disco, escena/modo/objeto activo y actividad de carga, guardado y depsgraph clasificada como Bridge o human/external. Las herramientas usan cuatro modos (`reference-only`, `inspect`, `scene-write`, `foreground-capture`), exigen `expectedBlendFile` para interacción viva, rechazan drift de ruta o puerto y bloquean foco/escritura ante actividad humana reciente salvo override explícito. Otras instancias se reportan y nunca se cierran automáticamente.

**Automatización de referencias:** `image_reference_pack_prepare` persiste atómicamente `coordination.operationMode`, `userModeling`, `targetBlendFile`, `blenderInteractionAllowed=false`, instalación diferida y la lista de herramientas Blender prohibidas. Esto permite que ChatGPT genere y deje referencias listas mientras Mauro continúa modelando sin tocar la sesión.

**Evidencia runtime:** una instancia aislada en puerto `9884` quedó fijada a `PID 9644` y al `.blend` v003 exacto; reportó carga, estado saved/clean y timestamp/hash de disco. `reference-only` devolvió `blenderInteractionAllowed=false`; una ruta v002 fue rechazada; `blender_open` se negó a redirigir el puerto; una edición diferida disparó `human-or-external` y bloqueó `scene-write`. Se detectaron otras tres instancias —una dirty— sin cerrarlas ni enfocarlas. El `.blend` conservó SHA-256 `3a9531f3fd961dc14be8efd9c53b2c350d3242229dfa56ecf01655c5d041f805`; sólo se cerró el PID aislado sin guardar.

**Regresiones:** `scripts/test-blender-session-coordination.mjs`, casos MSSR positivos/negativos/continuación, manifiesto reference-only en `test-blender-reference-pipeline.mjs`, validación de skills y prueba runtime aislada por puerto/PID.




## 2026-08-06 — Continuidad MSSR stateless ambigua entre repositorios y catálogo Web stale

**Estado:** Continuidad corregida en Bridge 0.6.65; exposición directa del catálogo mitigada y verificada, con selección final todavía propiedad del host.

**Capa / owner:** `src/mssr-trace-context.ts`, regresiones de trazas, wrappers Bridge y catálogo del conector ChatGPT Web.

**Síntoma observable:** al alternar entre repositorios dentro de la misma sesión Web, una llamada stateless podía encontrar dos trazas abiertas del mismo caller y quedar `mssr-trace-ambiguous`, aunque una ruta había sido planificada recientemente y la otra llevaba mucho tiempo inactiva. En paralelo, el runtime publicaba 139 tools pero el catálogo directo de la conversación ya abierta conservaba 127 y omitía doce schemas nuevos, incluido `image_asset_import_files`.

**Causa demostrada:** la resolución por sesión buscaba primero coincidencia exacta de proyecto y, si no existía, devolvía todas las trazas de esa sesión sin aplicar la dominancia temporal ya usada en otros scopes. El segundo comportamiento no nace en Bridge: el host fija su catálogo observable al conectar y Bridge no puede forzar esa selección privada desde el servidor.

**Corrección:** cuando existe una coincidencia exacta sesión/proyecto se conserva; si no existe, el coordinador aplica la regla de ruta reciente a las candidatas de la misma sesión. Sólo una ruta planificada dentro de la ventana puede desplazar candidatas stale; dos rutas frescas continúan siendo ambiguas. Las tools de proceso y los wrappers mantienen `traceId` explícito para selección deliberada. `bridge_connector_catalog_compare` verificó 127/139 schemas directos (91,37 %), MSSR 11/11 directo y listó las doce omisiones sin confundir wrapper con exposición dedicada.

**Regresión:** `test-mssr-trace-contract.mjs` crea dos trazas de la misma sesión, envejece una y exige que una llamada stateless desde un tercer proyecto herede la ruta fresca sin warning; el fixture concurrente existente sigue exigiendo ambigüedad cuando ambas rutas permanecen compatibles y recientes.

**Seguimiento:** después de activar 0.6.65, solicitar reinicio completo y volver a comparar el catálogo visible. Si la conversación conserva 127 tools, usar `bridge_tool_query`/`bridge_tool_action` y abrir un chat nuevo para obtener schemas dedicados; no duplicar tools ni afirmar que Bridge puede refrescar el catálogo privado del host.

## 2026-08-06 — Hardening de publicación, imágenes y lifecycle Web

**Estado:** Corregido en Bridge 0.6.66.

**Síntomas observados:** cierres multi-repositorio requirieron scripts temporales y cientos de llamadas wrapper; `image_asset_save` falló repetidamente con payloads no autoritativos y no ofrecía rollback conjunto con el manifiesto; el reminder Web podía aparecer durante builds largos; conflictos de edición y sesiones vencidas devolvían poca evidencia; varias fallas quedaban como `unknown`.

**Causa:** faltaban una operación manifest-driven de alto nivel, una transacción única para imágenes+manifest, un lease de progreso distinto de las fases MSSR y categorías/recovery estructurados en los límites de edición, catálogo y terminal.

**Corrección:** se agregó `git_multi_repo_publish`; persistencia atómica con readback y restauración; `progress` con lease acotado y outcome multidimensional; hashes/rangos/contexto en ediciones; detalle de fallback por tool ausente; preflight de sesiones y taxonomía específica de integridad, payload, fuente, estado stale, remoto y safety guard.

**Regresión:** `test-git-multi-repo-publication.mjs`, `test-image-persistence.mjs`, `test-image-file-import.mjs`, `test-system-hardening.mjs`, `test-mssr-trace-contract.mjs` y `test-selective-skill-context.mjs`, integrados en `test:regressions`. El gate completo verifica además 140 tools, routing y `TOOLS.md`.

**Límites:** la transacción de publicación es segura y verificable por repositorio, no atómica entre repositorios. El host de ChatGPT sigue siendo dueño de refrescar su catálogo dedicado; la reachability por wrapper no se reporta como exposición directa.

## 2026-08-08 — Un schema Web stale impedía reenviar `projectRoot` aunque el runtime ya lo soportaba

**Estado:** Corregido completamente en Bridge 0.6.72; 0.6.71 cubrió el caso intra-instancia, pero la verificación live mostró que ChatGPT Web podía encadenar las dos llamadas por instancias MCP distintas. El refresco visual del catálogo dedicado continúa siendo propiedad del host.

**Capa / owner:** continuidad de contexto de proyecto entre `project_context_load` y MSSR / `bridge-mcp`.

**Síntoma observable:** `project_context_load` devolvía un `nextAction` que pedía reutilizar `projectRoot`, y el runtime/source de `skill_bootstrap` ya declaraba ese campo, pero una conversación ChatGPT Web abierta conservaba un schema dedicado anterior que no permitía enviarlo. El bootstrap seguía siendo invocable, pero perdía el ensamblado modular del proyecto salvo usar un wrapper o abrir un chat con catálogo renovado.

**Causa demostrada:** el host puede cachear el catálogo dedicado durante la vida de una conversación. Bridge ya conservaba el proyecto cargado para atribución de trazas, pero no conservaba la ruta exacta para inyectarla en los argumentos efectivos de `skill_recommend`, `skill_route_plan` o `skill_bootstrap`.

**Corrección:** Bridge conserva el root exacto observado por `project_context_load` en scope de sesión + `workflowKey`, además del fallback local para sesiones anónimas. Si una llamada MSSR posterior no declara `projectRoot`, lo inyecta antes de tracing, validación y dispatch, incluso si esa llamada llega a otra instancia MCP del mismo host session. Un argumento explícito siempre gana. El root se reemplaza sólo cuando ese mismo scope carga otro proyecto; múltiples roots anónimos no se adivinan. La documentación de `project_context_load` explica este fallback.

**Regresión:** `test-delegated-mssr-route-project.mjs` ejecuta `project_context_load` y luego un `skill_bootstrap` directo sin `projectRoot`; exige que el resultado reporte exactamente el root cargado. La suite existente conserva además continuidad de wrappers, sesiones nombradas/anónimas y ambigüedad segura.

**Límite:** Bridge no puede reemplazar ni refrescar por sí mismo el schema privado ya cacheado por ChatGPT Web. La corrección hace que ese drift no pierda el proyecto cuando existe un único root inequívoco; un chat nuevo sigue siendo la forma de obtener el schema dedicado actualizado.

## 2026-08-09 — Acumulación no acotada de snapshots agotó el disco del host

**Estado:** Contenido redundante podado y runtime migrado; prevención automática pendiente.

**Capa / owner:** persistencia local de `data/workspace-snapshots` y operación del MauroPrime Bridge.

**Síntoma observable:** `C:` llegó a 0,08 GiB libres. `C:\Dev\bridge-mcp\data\workspace-snapshots` ocupaba 6,052 GiB y contenía 305 snapshots; aproximadamente 4,187 GiB correspondían a medios.

**Causa demostrada:** los snapshots se acumulaban sin una retención efectiva. Las imágenes generadas de Codex (~18 MiB) y los paquetes locales de Codex/ChatGPT no explicaban el crecimiento principal.

**Corrección:** se congeló un plan durable con hashes en `D:\Dev\_migration-manifests\bridge-snapshot-pruning-plan.json`; se conservaron el snapshot más reciente y el completo más reciente por cada uno de los 14 `sourceRoot`. Se eliminaron 288 candidatos exactos (5,690 GiB), sin fallos, y quedaron 17 snapshots protegidos (0,363 GiB). El repositorio y sus datos restantes se migraron con manifiesto SHA-256 idéntico a `D:\Dev\bridge-mcp`; `C:\Dev\bridge-mcp` quedó como junction de compatibilidad. El servicio HTTP se reinició desde `D:` y respondió `live` y `ready`.

**Regresión / verificación:** postflight con `remainingCandidateCount=0`, `protectedMissingCount=0`, 17 directorios reales y segunda selección con cero candidatos. El plan de poda tiene SHA-256 `F5BB3C9EE1AE39CC993C539920C0CC0A9B1B0577C0466BA189BAF0F1E3417A35`.

**Seguimiento:** implementar y probar una política de retención automática antes de considerar cerrado el riesgo de recurrencia. La poda destructiva siempre debe partir de un plan persistido, validar que cada objetivo sea hijo directo del root de snapshots y proteger explícitamente los IDs retenidos.

## 2026-08-11 — `git_multi_repo_publish` dejó validaciones Godot headless activas en Windows

**Estado:** Abierto; publicación recuperada con workaround acotado, prevención pendiente.

**Capa / owner:** runner de validaciones de `git_multi_repo_publish` y lifecycle de procesos hijo en MauroPrime Bridge.

**Síntoma observable:** un preflight cuya validación invocaba `Godot.exe --headless` mediante el call operator `&` de PowerShell agotó el timeout y dejó varios procesos Godot headless activos. Las mismas suites ejecutadas directamente desde PowerShell terminaron en aproximadamente un segundo y pasaron.

**Evidencia mínima:** la publicación de GodotAtlas falló sólo en la validación encapsulada; después del timeout se enumeraron procesos cuyo command line exacto era `Godot.exe --headless --path D:\Dev\GodotAtlas --script res://tests/test_atlas_(editor|services).gd`. Se detuvieron únicamente esos PIDs y la publicación posterior completó sus gates.

**Causa:** No resuelta. La diferencia entre la ejecución encapsulada y la directa apunta al tratamiento del comando PowerShell o al cleanup del árbol de procesos al vencer el timeout; no demuestra un defecto en las suites Godot.

**Corrección aplicada:** se reemplazaron las validaciones npm por `powershell -NoProfile -Command` con `Set-Location`, se ejecutaron las suites Godot directamente fuera del runner y se cerraron sólo los procesos headless identificados por command line. No se cambió todavía el runtime de Bridge.

**Regresión pendiente:** agregar un fixture Windows con ruta de ejecutable que contenga espacios y call operator de PowerShell; forzar timeout y exigir que el proceso y todos sus hijos terminen. El caso nominal debe comprobar también exit code, stdout y ausencia de procesos huérfanos.

**Seguimiento:** reproducir en el owner de `git_multi_repo_publish`, corregir quoting/lifecycle mínimo y publicar únicamente después del gate Windows. El catálogo directo stale observado en la misma tarea ya está cubierto por los incidentes de catálogo del host del 6 y 8 de agosto; no se duplica aquí.
