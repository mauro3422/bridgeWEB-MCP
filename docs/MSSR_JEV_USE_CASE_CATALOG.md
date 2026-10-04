# Catálogo de 100 casos candidatos para Jev / Decisions API en MSSR y Bridge

Este catálogo convierte la arquitectura y los lotes actuales de MSSR/Bridge en decisiones finitas que podrían evaluarse con Jev o, cuando exista acceso y documentación suficiente, OpenAI Decisions API. **No implica que los casos propuestos estén implementados ni que Jev se invoque automáticamente en esos flujos.**

## Leyenda y límites

- **EXISTE**: la capacidad base está en código o en un contrato ya integrado. No significa que cada operación use Jev.
- **PARCIAL**: hay componentes/contratos componibles, pero no un flujo completo validado para ese caso.
- **NUEVO**: propuesta, no capacidad actual.
- **Prioridad**: P0 = evaluación próxima en shadow/review; P1 = candidato posterior a evaluación; P2 = exploratorio.
- **Dueños**: **M** = MSSR/contrato portátil; **B** = Bridge/host; **J** = modelo Jev/Decisions; **G** = modelo generativo; **C** = código, benchmark o decisión humana.
- **Gate**: condición o riesgo que debe resolverse antes de usar la salida para influir en un flujo.

La integración candidata incluye seis herramientas: `mssr_librarian_search` (retrieval determinista por contenido con metadatos tipados opcionales de declaraciones exactas del proyecto), `mssr_librarian_jev_select` (elección Jev entre headings o hasta 100 handles provistos, con `none`), `mssr_librarian_fetch` (relectura exacta individual), `mssr_librarian_evidence_pack` (relectura y empaquetado citado de hasta 16 handles), `mssr_semantic_evidence_relation_review` (juicios Jev acotados sobre relaciones, incluida contradicción) y `mssr_semantic_evidence_synthesis_preview` (preview inmutable ensamblado con rangos fuente exactos). En search, la búsqueda lexical es el default; los modos metadata-aware opt-in usan selectores de sección declarados y verifican manifests/fingerprints. Estas herramientas no hacen un rastreo recursivo del repositorio, y tampoco son el agente entero: el host puede iterar consultas dentro de fuentes autorizadas y componer selección, revisión de contradicciones, síntesis externa y verificación. Los juicios son advisory; ni el pack ni el preview redactan prosa o escriben autoridad canónica. El pack revalida handles actuales, pero no autentica que Jev los haya seleccionado; ese historial lo afirma el caller. Los límites del review de relaciones incluyen hasta 64 átomos/evidencias y 128 pares; el default es 32 pares por request y concurrencia 4. El selector acepta hasta 100 handles exactos. Consultar source/schema antes de diseñar otro batch.

## 1. Retrieval y evidencia (1–20)

| # | Caso | EXISTE / PARCIAL / NUEVO | Señales o decisión finita | Dueño | Pri. | Gate / riesgo |
|---:|---|---|---|---|:---:|---|
| 1 | Búsqueda lexical en fuentes declaradas | **EXISTE** | coincidencia, rango, puntaje léxico | B+C / M | P0 | Solo busca `sourceRefs` Markdown explícitos; no rastrea archivos ni prueba ausencia global. |
| 2 | Elegir bloque que responde la consulta | **EXISTE** | `handle_i / none` | J→M+B | P0 | Solo elige candidatos provistos; exact-fetch antes de usar el texto. |
| 3 | Abstenerse si ningún candidato sirve | **EXISTE** | `handle_i / none` | J; policy C | P0 | Medir falsos `none`; la salida es advisory. |
| 4 | Releer el rango seleccionado | **EXISTE** | `valid / stale / range_invalid` | B+C | P0 | La decisión Jev nunca reemplaza la comprobación de owner, revisión, rango y fingerprint. |
| 5 | Elegir la rama de encabezados a inspeccionar | **NUEVO** | `heading_i / sibling / child / stop` | M+B; J sugiere | P1 | Limitar rondas, rangos y caracteres; sin recorrido arbitrario. |
| 6 | Detectar shortlist lexical insuficiente | **NUEVO** | `sufficient / broaden_sources / inspect_index / abstain` | M+C | P0 | Jev no puede recuperar una fuente que no recibió; medir recall por separado. |
| 7 | Seleccionar del catálogo completo de headings | **PARCIAL** | `heading_i / none` | J+B | P1 | El experimento con 200 headings no demuestra calidad en repositorios mayores ni en catálogos con más opciones. |
| 8 | Elegir un bloque más pequeño cuando falla el fetch por tamaño | **NUEVO** | `neighbor / child_heading / narrower_block / skip` | M+B; J sugiere | P1 | No presentar texto truncado como rango exacto; respetar límites. |
| 9 | Rechazar un handle obsoleto | **EXISTE** | `revision_matches / stale_retry / stale_stop` | M+B+C | P0 | Si cambió la fuente, buscar otra vez con la revisión actual. |
| 10 | Priorizar autoridad declarada | **PARCIAL** | `canonical / reference / derived_index / exclude` | M+C; J solo sugiere | P0 | Selectores y owner canónicos prevalecen; Jev no promueve autoridad. |
| 11 | Detectar cobertura insuficiente de fuentes | **PARCIAL** | `scope_complete / likely_missing_source / unknown` | M+C | P0 | Scope parcial no debe mostrarse como búsqueda exhaustiva. |
| 12 | Diversificar candidatos por fuente | **NUEVO** | `retain / replace_same_source / add_source` | M+C; J sugiere | P1 | Verificar recall por fuente y mostrar qué quedó fuera. |
| 13 | Decidir si hace falta más evidencia | **NUEVO** | `enough / fetch_related / request_verifier / abstain` | J+M; B ejecuta | P0 | Presupuestos explícitos; no habilita acceso ni llamadas por sí solo. |
| 14 | Elegir entre secciones plausibles para un claim | **NUEVO** | `A / B / both / neither` | J+M | P1 | Labels deben permitir más de una sección válida; medir cobertura además de exactitud. |
| 15 | Señalar una referencia cruzada para fetch | **NUEVO** | `fetch_explicit_ref / inspect_local / ignore` | J sugiere; B resuelve | P1 | No seguir rutas o links fuera del scope autorizado. |
| 16 | Clasificar tipo de documento | **NUEVO** | `project_context / ADR / roadmap / skill / changelog / other` | J+M | P1 | Etiqueta de apoyo; no modifica autoridad, freshness o routing. |
| 17 | Distinguir evidencia de skill y de proyecto | **NUEVO** | `procedure / project_fact / both / neither` | J+M+B | P1 | `SKILL.md` sigue siendo la entrada de capacidad; refs no crean reglas de activación. |
| 18 | Detectar pregunta fuera del corpus entregado | **NUEVO** | `answerable / needs_other_source / unanswerable` | J; policy M+B | P0 | No insinuar que hubo rastreo global. |
| 19 | Priorizar contenido posterior frente al hint inicial | **NUEVO** | `hint_sufficient / read_full_section / fetch_neighbor` | J sugiere; B aporta | P1 | El hint puede omitir evidencia posterior; evaluar misses por ubicación. |
| 20 | Marcar consulta con interpretaciones distintas | **NUEVO** | `interpretation_A / interpretation_B / clarify` | G pregunta; J podría clasificar | P2 | No inferir la intención del usuario mediante un score. |

## 2. Átomos, relaciones y conflictos (21–40)

| # | Caso | EXISTE / PARCIAL / NUEVO | Señales o decisión finita | Dueño | Pri. | Gate / riesgo |
|---:|---|---|---|---|:---:|---|
| 21 | Deduplicar registros estructuralmente iguales | **EXISTE** | `exact_record / same_revision / same_payload / same_metadata / identity_collision` | M+C | P0 | Va antes de clasificación semántica; colisión no equivale a duplicado. |
| 22 | Revisar relación de un par de átomos | **EXISTE** | `supports / contradicts / supersedes / duplicate / unrelated / unresolved` | J→M+B | P0 | Juicio no verificado, ligado a evidencia exacta. |
| 23 | Separar componentes desconectados | **EXISTE** | pares agrupados por componente conexo | M+C | P0 | No mezclar componentes sin relación en un mismo estado Jev. |
| 24 | Comprobar comparabilidad antes del juicio | **PARCIAL** | `comparable / scope_mismatch / time_mismatch / unknown` | M+C; J no sustituye | P0 | Incomparable o desconocido queda en revisión. |
| 25 | Distinguir supersession de contradicción | **PARCIAL** | `newer_replaces_old / simultaneous_conflict / compatible / unresolved` | J sugiere; M policy | P0 | Tiempo/freshness deben venir de evidencia observada. |
| 26 | Revisar si dos átomos comparten sujeto | **NUEVO** | `same / related / different / unknown` | J; identity C | P1 | La identidad canónica del sujeto pertenece al owner/código. |
| 27 | Marcar claims con polaridad opuesta | **NUEVO** | `same_polarity / opposite / incomparable` | J+M | P1 | Polaridad opuesta no basta para concluir contradicción. |
| 28 | Distinguir duplicado semántico de solapamiento | **NUEVO** | `equivalent / overlap / distinct / unresolved` | J shadow | P1 | Separar de deduplicación estructural determinista. |
| 29 | Elegir clase de relación o abstenerse | **EXISTE** | relación tipada o `unresolved` | J→M | P0 | Medir abstención; confianza actual sin calibración MSSR. |
| 30 | Proponer relación claim–fuente | **NUEVO** | `direct_support / context_only / conflict / no_evidence` | J sugiere; B fetch | P1 | Referencia cercana no demuestra entailment. |
| 31 | Revisar claridad de los nombres/rúbricas de opciones | **NUEVO** | `clear / overlapping / polarity_risk / revise` | C+owner; J puede probar | P0 | Probar permutaciones de nombre, orden y polaridad. |
| 32 | Detectar claim sin scope explícito | **NUEVO** | `scope_present / missing / conflict` | J marca; M conserva unknown | P1 | No completar el contexto implícitamente. |
| 33 | Comparar atom con revisión de fuente | **EXISTE** | `same_revision / newer_source / no_revision / mismatch` | M+B+C | P0 | Revision exacta requerida; Jev no decide freshness. |
| 34 | Priorizar pares para revisión humana | **NUEVO** | `review_now / defer / no_review` | J sugiere; M ordena | P1 | Score no equivale a severidad o urgencia autoritativa. |
| 35 | Mantener ambos lados como conflicto abierto | **PARCIAL** | `preserve_both / supersede / merge_candidate / insufficient` | M policy; J recomienda | P0 | Preview conservador mantiene conflicto/unresolved en review. |
| 36 | Bachear pares conectados dentro de límites | **EXISTE** | lotes por componente con límites | M+C | P0 | Código impone caps y concurrencia; no aumentar por inferencia. |
| 37 | Comparar juicios con anotadores independientes | **PARCIAL** | `agree / disagree / gold_ambiguous` | M benchmark | P0 | Gold congelado antes de llamar al modelo. |
| 38 | Incluir conflictos positivos en benchmark | **NUEVO** | `true_conflict / no_conflict / supersession / incomparable` | M benchmark | P0 | La corrida anterior no incluyó contradicciones positivas adjudicadas. |
| 39 | Detectar owner distinto o mezcla de proyectos | **EXISTE** | `same_owner / cross_owner / unknown` | M+B+C | P0 | Owner mismatch debe bloquear; Jev no autoriza cruces. |
| 40 | Aprender de corrección explícita de relación | **PARCIAL** | `confirms / corrects / withdraws / unresolved` | M Semantic Experience | P1 | Registrar provenance; el modelo no se valida a sí mismo. |

## 3. Contexto y skill routing (41–60)

| # | Caso | EXISTE / PARCIAL / NUEVO | Señales o decisión finita | Dueño | Pri. | Gate / riesgo |
|---:|---|---|---|---|:---:|---|
| 41 | Clasificar intención estructurada | **PARCIAL** | dominios, acciones, artifacts, needs, signals | Host+M; J candidato | P1 | Clasificación observable, no chain-of-thought ni permiso. |
| 42 | Elegir skill entre candidatos | **NUEVO** | `skill_id / none / clarify` | J sugiere; M router | P1 | No materializar opcionales sin aceptación; required prevalece. |
| 43 | Elegir módulo de contexto de proyecto | **NUEVO** | `module_id / core_only / none` | M; J candidato | P1 | `project-context.json` y selectors canónicos mandan. |
| 44 | Clasificar dato como contexto, memoria o estado | **NUEVO** | `PROJECT_CONTEXT / PROJECT_MEMORY / PROJECT_STATE / other` | J sugiere; M owner | P1 | No escribir ni reclasificar autoridades automáticamente. |
| 45 | Recomendar replanning por cambio de fase | **NUEVO** | `continue / verify / persist / close` | M workflow; J candidato | P0 | El host mantiene gates obligatorios de cada fase. |
| 46 | Detectar necesidad de otra capacidad | **PARCIAL** | `available / discover / refresh / unavailable` | B registry+MSSR | P1 | Disponibilidad se verifica en catálogo vivo, no en memoria del modelo. |
| 47 | Elegir familia de herramienta a consultar | **NUEVO** | `filesystem / git / librarian / dashboard / process / other` | J sugiere; B ejecuta | P1 | Selección no es allowlist ni permiso. |
| 48 | Marcar ambigüedad que requiere aclaración | **NUEVO** | `clear / ambiguity_A_B / ask_user` | G pregunta; J clasifica | P2 | No generar una respuesta de usuario por score. |
| 49 | Clasificar match de workflow guide | **PARCIAL** | `strong / weak / negated / none` | M+B router | P1 | Preservar reglas existentes de negación y strong match. |
| 50 | Elegir referencia situacional de skill | **NUEVO** | `reference_id / core_only / none` | M skill manifest/bootstrap | P1 | Cargar solo ante match de etapa/contexto. |
| 51 | Detectar catálogo host obsoleto | **PARCIAL** | `matches_live / stale_schema / refresh` | B | P0 | Contrastar runtime; catálogo degradado no prueba ausencia. |
| 52 | Seleccionar página siguiente bajo presupuesto | **PARCIAL** | `required_page / accepted_optional_page / stop_replan` | M+C | P0 | No truncar obligaciones requeridas por preferencia del modelo. |
| 53 | Distinguir recuperación de tarea humana | **PARCIAL** | `support_trace / human_task / synthetic_probe` | M+B Cockpit | P1 | Score no cierra lifecycle ni convierte soporte en tarea. |
| 54 | Proponer owner de proyecto para evidencia | **NUEVO** | `owner_i / cross_project / unknown` | J shadow; C valida | P0 | Owner ambiguo detiene operación; no correlacionar solo por similitud. |
| 55 | Clasificar señal mínima de fricción | **NUEVO** | `nominal / anomaly / recovery / discovery / refresh / tool_chain / replan` | Host+M | P1 | Usar el set más pequeño y verdadero; no elevar riesgo artificialmente. |
| 56 | Elegir contexto global o específico | **NUEVO** | `portable_core / project_core / scoped_module / none` | M bootstrap | P1 | Solo `.mssr` como control activo; sin fallback a `.bridge`. |
| 57 | Recomendar aceptar o dejar pendiente un opcional | **NUEVO** | `accept / skip / pending` | Host decide; J sugiere | P1 | Falta de decisión debe seguir como pending. |
| 58 | Proponer cadena autorizada cuando falta capacidad | **NUEVO** | `existing_tool / discover / replan / ask_user` | B host | P1 | MSSR es advisory; herramientas nuevas requieren autorización normal. |
| 59 | Separar resumen de continuidad de hechos persistibles | **PARCIAL** | `bounded_summary / project_fact_candidate / raw_content_excluded` | M+C/G | P0 | Excluir prompt crudo, transcript, secretos y razonamiento privado. |
| 60 | Señalar discrepancia entre autoridad y telemetry | **PARCIAL** | `consistent / freshness_review / semantic_review / unknown` | M maintenance | P1 | Revisión visible; telemetry no reescribe autoridades. |

## 4. Batching, síntesis y verificación (61–80)

| # | Caso | EXISTE / PARCIAL / NUEVO | Señales o decisión finita | Dueño | Pri. | Gate / riesgo |
|---:|---|---|---|---|:---:|---|
| 61 | Bachear preguntas del mismo estado | **PARCIAL** | preguntas relacionadas dentro de un estado | J/M | P1 | Compartir llamada solo cuando sujeto/contexto sea el mismo. |
| 62 | Bachear relaciones de componente conectado | **EXISTE** | pares conectados por batches acotados | M+J | P0 | Respetar caps, concurrency y exact source bindings. |
| 63 | Separar componentes sin relación | **EXISTE** | un batch por componente | M+C | P0 | No ahorrar llamadas mezclando evidencia inconexa. |
| 64 | Priorizar lotes para revisión | **NUEVO** | `high / medium / low / defer` | J sugiere; M policy | P1 | Score no es severidad canónica ni urgencia de usuario. |
| 65 | Crear preview reversible de síntesis | **EXISTE** | secciones exactas incluidas o review | M+B+C | P0 | Preview inmutable, sin escritura; host revalida revision antes de usarlo. |
| 66 | Redactar párrafo final legible con citas | **NUEVO** | claims + citas → prosa | G | P1 | No lo hace Jev ni el preview actual; verificar cada claim por rango. |
| 67 | Medir cobertura de cita por claim | **NUEVO** | `all / partial / unsupported` | C+G/verifier | P0 | Fetch íntegro no demuestra que la cita sostenga la frase. |
| 68 | Comprimir contexto redundante | **NUEVO** | `keep / collapse_duplicate / preserve_conflict / drop_with_reason` | C/G; J puede clasificar | P1 | Mantener provenance y conflictos; nunca cambiar la fuente. |
| 69 | Elegir segmentos bajo presupuesto de caracteres | **NUEVO** | handles con coste y `none` | J+M | P1 | Medir utilidad/cobertura; required no compite con opcionales. |
| 70 | Resumir muchos documentos en lenguaje natural | **NUEVO** | párrafo/resumen con citas | G | P1 | No es selección Jev; la salida es borrador, no autoridad. |
| 71 | Clasificar preview como candidato o bloqueado | **EXISTE** | `review_candidate / conflict / stale / unsupported` | M+C | P0 | Conflict, no-comparability o freshness desconocida impide consolidar. |
| 72 | Decidir cuándo pedir segundo verificador | **NUEVO** | `independent_verifier / owner_review / no_extra_check` | M policy; J prioriza | P1 | La independencia declarada no queda autenticada por el schema. |
| 73 | Comparar salida Jev con gold | **PARCIAL** | `correct / acceptable_alternative / miss / ambiguous_gold` | M benchmark | P0 | Etiquetas blindadas y denominadores por tarea. |
| 74 | Calibrar umbral de confianza por tarea | **NUEVO** | `shadow / fallback / review / candidate` | C+owner; J aporta score | P0 | Confianza MSSR sin calibrar; no copiar umbrales externos. |
| 75 | Detectar si el siguiente batch aporta evidencia nueva | **NUEVO** | `new_expected / duplicate_read / stop` | M+C | P1 | Dedupe por source revision y rango; registrar razón de parada. |
| 76 | Detectar apoyo repetido desde la misma fuente | **PARCIAL** | `independent_support / same_source_repeat / none` | M policy | P0 | Caller freshness/independence es una aserción, no recibo autenticado. |
| 77 | Redactar resumen que conserva conflicto | **NUEVO** | ambos claims y sus citas | G | P1 | No elegir ganador ni borrar uno de los lados. |
| 78 | Medir si el resumen preservó conflicto | **NUEVO** | `preserved / collapsed / omitted` | C benchmark | P0 | Requiere positivos de contradicción con gold adjudicado. |
| 79 | Enrutar cálculos/fechas exactas a código | **NUEVO** | `use_code / use_model / require_source` | C | P0 | Conteo, arithmetic y comparación de fechas no se delegan a Jev. |
| 80 | Verificar idioma y cobertura de respuesta | **NUEVO** | `language_ok / missing_section / untranslated_query` | G+C | P1 | Métricas segmentadas por idioma; no confiar en promedio agregado. |

## 5. Observabilidad, Git y runtime (81–100)

| # | Caso | EXISTE / PARCIAL / NUEVO | Señales o decisión finita | Dueño | Pri. | Gate / riesgo |
|---:|---|---|---|---|:---:|---|
| 81 | Clasificar atom por familia productora | **PARCIAL** | `routing / context / tool / Git / runtime / visual_QA / other` | M adapters | P1 | Coverage por familia debe mostrar missing/partial, no asumir cobertura global. |
| 82 | Priorizar anomalía runtime para inspección | **NUEVO** | `inspect_now / monitor / expected_noise` | B+C; J sugiere | P1 | PID, boot, readiness y liveness se leen determinísticamente; no reinicio automático. |
| 83 | Correlacionar trace con task explícita | **EXISTE** | `same_task / child / owner_mismatch / ambiguous` | B+M | P0 | Si ambiguo, traceId explícito; mismatch bloquea. |
| 84 | Elegir vista compacta o full de observabilidad | **PARCIAL** | `compact / full` | B+C | P0 | Full requiere opt-in; modelo no debe ampliar el envelope en silencio. |
| 85 | Detectar salida de observabilidad sobre presupuesto | **PARCIAL** | `within_budget / truncate_with_count / async_export` | B+C | P0 | No perder denominadores o refs en truncado silencioso. |
| 86 | Priorizar fricción repetida para maintenance review | **PARCIAL** | `watch / review / required` | M+B | P1 | Acción advisory; mantenimiento visible antes de editar skills o authorities. |
| 87 | Clasificar fallo de tool/host | **NUEVO** | `provider / schema / timeout / permission / stale_catalog / host / unknown` | B+C; J triage | P1 | Error de permiso no se elude redirigiendo a otra herramienta. |
| 88 | Recomendar refresh del catálogo/provider | **NUEVO** | `current / refresh_registry / reconnect / investigate` | B | P1 | Degradado/obsoleto no demuestra que la capacidad no exista. |
| 89 | Separar metadata del payload privado | **EXISTE** | `project_metadata / private_content / excluded_runtime` | B+C/M | P0 | Librarian admite Markdown explícito y excluye `data/`, `logs/`, `.mssr/runtime`, `.git` y no-Markdown. |
| 90 | Sugerir partición Git por subsistema | **PARCIAL** | `cockpit / storage_auditor / quietdesk / blender / project_context / shared` | C+skill Git; J sugiere | P1 | Archivos compartidos requieren revisión de hunks; nunca `git add -A`. |
| 91 | Clasificar untracked para investigación | **NUEVO** | `source / generated / artifact / historical / unknown` | J sugiere; C verifica | P1 | No borrar por edad/extensión/score; comprobar provenance, refs y hash. |
| 92 | Proponer agrupación de commits | **NUEVO** | `batch_id / shared_mixed / hold` | C+skill Git | P1 | No stage/commit automático; exigir diff, owner y rollback revisados. |
| 93 | Recomendar gates según paths afectados | **NUEVO** | `check / focused_tests / build / full_verify` | C | P1 | Mapa path→owner mantenido; aplicar gates release requeridos. |
| 94 | Revisar impacto de changelog y PROJECT_* | **EXISTE** | `updated / reviewed_none / pending` | M+C | P0 | `pending` bloquea persistencia; el modelo no declara cumplimiento canónico. |
| 95 | Detectar diferencia entre runtime y candidato | **PARCIAL** | `same_build / source_mismatch / catalog_diff / boot_unknown` | B+C | P0 | Usar build, boot y catálogo live; no reiniciar desde worktree incompleto. |
| 96 | Priorizar filas del benchmark a repetir | **NUEVO** | `repeat / holdout / measured` | M benchmark | P1 | Manifiesto/labels congelados; no ajustar corpus tras inspeccionar respuestas. |
| 97 | Distinguir métrica de retrieval y selector | **NUEVO** | `retrieval_recall / conditional_selection / end_to_end` | M+C | P0 | Reportar denominadores separados; Jev no corrige candidatos omitidos. |
| 98 | Decidir recuperación de cache/context inventory | **NUEVO** | `cache_valid / reconstruct / defer_expensive_scan` | B+C | P1 | Freshness/cobertura deterministas; Jev no certifica recuperación. |
| 99 | Revisar retención de artifact histórico | **NUEVO** | `retain / inspect_provenance / eligible_for_owner_review` | Owner+C | P2 | El modelo nunca borra; verificar refs, respaldo y autorización. |
| 100 | Promover decisión repetida a fast path | **NUEVO** | `keep_shadow / deterministic_candidate / human_review` | M Semantic Experience/governance | P2 | Holdout cross-project, coverage, calibración, rollback y aprobación/versionado. |

## Cómo leer las propuestas

Las seis herramientas son componentes explícitos de un flujo más amplio: el host define fuentes autorizadas y metadatos disponibles; MSSR construye candidatos con rangos exactos; Jev puede seleccionar entre los candidatos recibidos o evaluar relaciones; Bridge/MSSR releen y comprueban vigencia; relation review preserva contradicciones y dudas; synthesis preview arma una vista reversible con evidencia exacta; un modelo generativo del host puede después redactar o compactar, y otro paso debe verificar cada afirmación contra sus citas. El host puede iterar retrieval y ampliar consultas dentro de su política de fuentes. Bridge no hace un crawl recursivo automático y el preview actual no genera prosa. Por eso conviene evaluar por separado lo que ya es un componente disponible y lo que depende de orquestación y generación del host.

Por eso los P0 propuestos son primero trabajo de evaluación: medir recall de retrieval (contenido y metadatos) antes de medir la selección Jev condicionada a candidatos presentes; sumar etiquetas humanas blindadas, contradicciones positivas, confianza por tarea, citas, owner/contexto ausente, orden/nombres/polaridad de opciones e idioma. Resultados previos de MSSR son exploratorios: selector de shortlist fue condicionado a lo que retrieval encontró; el benchmark español tuvo grandes misses de recuperación. Ninguno prueba umbrales de producción.

## Fuentes y alcance de mercado

- OpenAI anunció **Decisions API** en su recap de DevDay del **29 de septiembre de 2026**. La describe con respuestas finitas y contexto de texto o imágenes para clasificación, routing y siguiente acción de agente; el anuncio declara limited preview y no especifica allí schema, endpoint, precio, calibración o benchmark. [OpenAI DevDay 2026](https://openai.com/index/devday-2026-recap/).
- TypeSafe describe Jev como modelo de decisiones tipadas/probabilísticas para workflows y propone clasificación, routing, scoring, map-reduce y guardrails. Son claims y casos del proveedor; no demuestran que el Bridge actual los implemente todos. [Introducción de TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
- Una evaluación independiente de Entagl encontró rendimiento competitivo en su set, pero también errores por contexto ausente y un caso equivocado con confianza alta. Sus datos no calibran el umbral MSSR; sirven para motivar gold labels, shadow y gates por tarea. [Evaluación de Entagl](https://www.entagl.com/blog/typesafe-jev-benchmark-ai-decision-models).
- Un hilo comunitario de Reddit propone routing, prefetch, seleccionar subpáginas y deduplicar lugares; el autor reporta solo dos ejemplos, así que es inspiración de uso, no validación. [Prueba exploratoria en Reddit](https://www.reddit.com/r/LLMDevs/comments/1wihigc/tried_typesafes_new_decisiononly_model_jev_as_an/).
- Un preprint reporta sensibilidad a nombres/polaridad de las opciones, y otro advierte que type safety no implica decisión correcta. Son evidencia temprana que respalda pruebas de robustez, no consenso establecido. [Opción/rúbrica](https://arxiv.org/abs/2609.26758), [control agentic 5G](https://arxiv.org/abs/2609.33689).
