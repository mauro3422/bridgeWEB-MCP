# MauroPrime Structured Skill Router

Nombre corto: **MSSR**.

MSSR es la capa de routing de skills de MauroPrime. No es un daemon separado ni una combinación informal de prompts: es un módulo TypeScript del Bridge, un contrato JSON versionado, fixtures de comportamiento, tools MCP y skills de mantenimiento.

## Objetivo

Traducir una petición natural, incluso incompleta, a una selección pequeña y verificable de procedimientos reutilizables.

```text
mensaje actual + contexto resuelto opcional
  -> intención estructurada del agente
  -> routing determinista
  -> skills de la fase actual
  -> ejecución
  -> verify / persist / close
```

La intención estructurada contiene únicamente el resultado de clasificación (`domains`, `actions`, `artifacts`, `needs`, `signals`, `risk`, `ambiguity`). No contiene razonamiento privado.

## Quién genera la intención

La intención la produce el mismo agente que recibió el mensaje, como parte de su turno normal. No existe un modelo clasificador oculto dentro de MSSR. El Bridge recibe el objeto ya resuelto y desde ese punto ejecuta TypeScript determinista. Cuando el caller no envía `intent`, el router usa `lexical-fallback`, basado en expresiones regulares, y lo marca explícitamente en la respuesta.

```text
mensaje del usuario
  -> agente actual: clasificación semántica compacta
  -> MSSR: scoring, gates, dependencias, exclusiones y fases
  -> carga de procedimientos
  -> acción mediante tools con sus permisos normales
```

La clasificación puede reutilizarse como capa de control para seleccionar skills, tools, pruebas, permisos o pipelines. No debe ejecutar por sí sola mutaciones destructivas o efectos externos: los tags recomiendan o enrutan; la autorización y las barreras de cada tool siguen gobernando la acción.

`signals` siempre contiene al menos un valor. Usa `nominal` sólo cuando no hay anomalías; si existe evidencia relevante, omite `nominal` y declara `error-observed`, `warning-observed`, `degraded-capability`, `uncertainty`, `conflicting-evidence`, `repeated-friction`, `manual-workaround`, `missing-capability`, `recovery-needed`, `skill-gap` o `reusable-pattern`. Las señales de incidente fuerzan verificación; las de fricción o patrón requieren considerar mantenimiento al cerrar.

## Componentes canónicos

| Componente | Ruta |
|---|---|
| Motor y auditoría | `src/tools/skill-routing.ts` |
| Tools MCP y carga de skills | `src/tools/skill-catalog-tools.ts` |
| Registro de tools/riesgo | `src/tool-registry.ts` |
| Contrato de activación | `config/skill-routing/skill-routing-overrides.json` |
| Schema del contrato | `config/skill-routing/skill-routing.schema.json` |
| Casos de comportamiento | `config/skill-routing/skill-routing-fixtures.json` |
| Schema de fixtures | `config/skill-routing/skill-routing-fixtures.schema.json` |
| Prueba dedicada | `scripts/test-skill-routing.mjs` |
| Auditoría visual | `scripts/audit-skills.py` |
| Fuente Git de skills propias | `C:\Dev\mauroprime-skills\skills` |
| Montaje runtime de Codex | `~/.codex/skills/<name>` como junction |
| Skill mantenedora | `C:\Dev\mauroprime-skills\skills\skill-routing-maintainer\SKILL.md` |
| Incidentes y regresiones confirmadas | `docs/skill-routing/INCIDENTS.md` |

`C:\Dev\bridge-mcp` versiona el motor y el contrato de routing. `C:\Dev\mauroprime-skills` versiona los procedimientos propios. La carpeta `~/.codex/skills/_dashboard` contiene salidas generadas para inspección; no es una fuente editable.

## Tools públicas

- `skill_catalog`: inventario vivo.
- `skill_recommend`: recomendación léxica simple y compatible con clientes antiguos.
- `skill_route_audit`: drift, referencias, ciclos, tamaño y metadata inferida.
- `skill_route_plan`: plan de fases sin cargar contenido.
- `skill_bootstrap`: carga sólo las skills activas de la fase actual.
- `skill_load`: carga explícita de una skill.

## Skills requeridas, opcionales y diferidas

El plan distingue entre skills requeridas por un workflow o dependencia, skills opcionales seleccionadas por relevancia y skills diferidas para fases posteriores. El agente puede descartar una skill opcional si resulta claramente irrelevante o impráctica para la fase actual, usando el conjunto mínimo suficiente. Una skill requerida sólo debe omitirse cuando una regla superior de seguridad o una capacidad realmente ausente lo impida, y el motivo debe reportarse. Las diferidas no se cargan antes de tiempo.

`phase` indica la fase principal de carga. `coversPhases` permite que un único procedimiento coherente cubra varias fases sin crear skills artificiales. Cuando `coversPhases` no se declara, la cobertura es únicamente la `phase` explícita; la fase inferida por descripción nunca debe reemplazar una fase explícita.

## Contexto conversacional

El Bridge no puede leer por sí solo todo el historial de ChatGPT. El agente que ve la conversación debe enviar:

- `task`: el mensaje actual;
- `context`: resumen resuelto y acotado de la conversación relevante en cualquier tarea especializada multi-turno;
- `intent`: clasificación estructurada cuando sea posible.

La política recomendada es enviar normalmente entre 500 y 2000 caracteres de contexto, con un máximo de 4000. Debe cubrir el objetivo aceptado, restricciones relevantes, trabajo ya realizado o fase actual y referencias todavía abiertas. Se aplica tanto a “dale”, “sí”, “mandale”, “seguí”, “de una” o “hacé eso” como a mensajes más completos que dependen de decisiones anteriores. Sólo se omite en un primer turno realmente independiente.

`context` no debe ser una transcripción completa, conversación irrelevante ni cadena de pensamiento. Es evidencia adicional: el mensaje actual, las instrucciones superiores y la intención explícita conservan prioridad.

## Perfil del caller

`skill_route_plan` y `skill_bootstrap` aceptan `caller`:

- `codex-local`: prioriza filesystem, shell y MCPs directos; usa el Bridge cuando agrega snapshots, recuperación, routing compartido, terminales persistentes, guardado verificado de Roblox o coordinación.
- `chatgpt-web`: el acceso aprobado a MauroPrime normalmente ocurre mediante el Bridge y el túnel seguro.
- `other`: el agente debe inspeccionar las capacidades disponibles y elegir la ruta autoritativa más corta.

El router devuelve `executionGuidance` y también declara en `classifier` si la clasificación provino del agente o del fallback. `skill_route_plan` es la opción compacta; `skill_bootstrap` añade el contenido completo de las skills activas y por eso tiene mayor costo de contexto.

## Vocabulario estructurado

El vocabulario debe describir tanto cambios dentro de una aplicación como trabajo administrativo alrededor del proyecto. Además de gameplay y código, MSSR reconoce dominios `git` y `filesystem`; acciones `move`, `verify` y `version`; artefactos `project`, `repository`, `place-file` y `backup`; y necesidades `integrity-verification` y `version-control`.

Usa estos conceptos para migraciones de carpeta, bootstrap de repositorios, comparación de hashes, actualización de rutas absolutas y versionado. No clasifiques automáticamente una operación de archivos como edición de gameplay sólo porque contiene un `.rbxl` o la palabra Roblox.

La documentación local (`README`, roadmap, changelog, notas) es el artefacto `document`. `official-docs` se reserva para documentación oficial o referencias de API explícitas.

## Descubrimiento de skills nuevas

Cada llamada reescanea `~/.codex/skills` y el catálogo vivo de Roblox. Una skill nueva aparece inmediatamente y recibe metadata inferida por nombre y descripción. Eso permite descubrimiento sin reiniciar, pero las skills propias deben recibir una entrada explícita y fixtures antes de considerarse estables.

También se reescanea `~/.codex/plugins/cache`. Ese árbol administrado se permite únicamente como entrada de descubrimiento en modo lectura y sólo mientras cada ruta resuelta permanezca dentro de la raíz exacta del caché; no amplía los permisos generales del filesystem del Bridge. Las copias y versiones repetidas se canonicalizan por precedencia. Una raíz completa inaccesible produce un warning observable.

`skill_route_audit` marca esta situación como mantenimiento pendiente y devuelve una propuesta inicial de metadata.

### Salud de la fuente Roblox

Una conexión de proceso a `StudioMCP.exe` no prueba que el catálogo dinámico esté disponible. El Bridge clasifica por separado:

- `healthy`: `tools/list` devolvió tools vivas;
- `degraded`: el catálogo vivo falló o volvió vacío, pero existe un último catálogo sano persistido;
- `unavailable`: no existen tools vivas ni un catálogo anterior utilizable.

Ante una lista vacía, el Bridge reinicia únicamente su conexión hija a StudioMCP y reintenta una vez. No cierra Roblox Studio ni modifica el DataModel. Cada catálogo sano se guarda bajo `data/`, fuera de Git, para conservar nombres, schemas y annotations durante una interrupción posterior. Los schemas de caché siempre se marcan como `usingCachedTools`; una llamada remota todavía puede fallar si Roblox retiró o cambió la tool.

`roblox_mcp_status` y `roblox_mcp_tool_list` aceptan `refresh=true` para ignorar el caché corto de salud y repetir el probe acotado. `skill_catalog`, routing y auditoría devuelven `sourceHealth`; una fuente Roblox solicitada y degradada produce warning y mantenimiento pendiente.

### Concurrencia, ownership y múltiples Studios

El Bridge mantiene una sola conexión hija a `StudioMCP.exe` para todas sus sesiones HTTP. Codex y ChatGPT web pueden abrir sesiones MCP independientes, pero las operaciones que atraviesan esa conexión se serializan. El probe de catálogo usa single-flight: varias sesiones que detectan una caída comparten la misma recuperación y no generan una tormenta de procesos ni se cierran mutuamente la conexión.

`roblox_mcp_status` expone el PID del Bridge, el PID exacto de su hijo, generación de conexión, reconexiones, cola y último motivo de reset. Otros procesos `StudioMCP.exe` pueden pertenecer al MCP directo de Codex u otros clientes; el Bridge sólo cierra su propio transporte y lo libera durante shutdown limpio.

Cuando existen varias ventanas de Roblox Studio:

- `roblox_mcp_studio_list` devuelve ids, nombres y target activo;
- `roblox_mcp_query` acepta `studioId` y fija selección + llamada dentro de una operación atómica;
- `roblox_mcp_action` exige `studioId` si hay más de una instancia;
- los proxies rechazan `set_active_studio` directo;
- schemas cacheados sirven para descubrimiento degradado, pero nunca autorizan ni ejecutan una query, acción o carga de skill viva.

Cerrar una sesión HTTP no cierra StudioMCP mientras otras sesiones siguen activas; cerrar o reiniciar el servidor libera el hijo administrado.

## Fases

1. `discovery`
2. `safety`
3. `implementation`
4. `verification`
5. `persistence`
6. `maintenance`

No se cargan todas a la vez. El caller vuelve a planificar con `stage=verify`, `persist` o `close` y pasa `completedPhases`.

`missingRequiredPhases` conserva compatibilidad y señala fases obligatorias sin una skill seleccionada. `agentFallbackPhases` hace explícito que esas fases siguen siendo responsabilidad del agente usando sus procedimientos generales; una lista vacía de skills no autoriza a omitir análisis, pruebas o persistencia requeridos.

## Principio de seguridad

La detección puede ser automática. La autoedición silenciosa no. Cualquier cambio de skill, contrato o fixture debe ocurrir en una tarea visible con snapshot, diff, pruebas y verificación integral.
