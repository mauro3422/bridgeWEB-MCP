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

La intención estructurada contiene únicamente el resultado de clasificación (`domains`, `actions`, `artifacts`, `needs`, `risk`, `ambiguity`). No contiene razonamiento privado.

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

## Vocabulario estructurado

El vocabulario debe describir tanto cambios dentro de una aplicación como trabajo administrativo alrededor del proyecto. Además de gameplay y código, MSSR reconoce dominios `git` y `filesystem`; acciones `move`, `verify` y `version`; artefactos `project`, `repository`, `place-file` y `backup`; y necesidades `integrity-verification` y `version-control`.

Usa estos conceptos para migraciones de carpeta, bootstrap de repositorios, comparación de hashes, actualización de rutas absolutas y versionado. No clasifiques automáticamente una operación de archivos como edición de gameplay sólo porque contiene un `.rbxl` o la palabra Roblox.

La documentación local (`README`, roadmap, changelog, notas) es el artefacto `document`. `official-docs` se reserva para documentación oficial o referencias de API explícitas.

## Descubrimiento de skills nuevas

Cada llamada reescanea `~/.codex/skills` y el catálogo vivo de Roblox. Una skill nueva aparece inmediatamente y recibe metadata inferida por nombre y descripción. Eso permite descubrimiento sin reiniciar, pero las skills propias deben recibir una entrada explícita y fixtures antes de considerarse estables.

`skill_route_audit` marca esta situación como mantenimiento pendiente y devuelve una propuesta inicial de metadata.

## Fases

1. `discovery`
2. `safety`
3. `implementation`
4. `verification`
5. `persistence`
6. `maintenance`

No se cargan todas a la vez. El caller vuelve a planificar con `stage=verify`, `persist` o `close` y pasa `completedPhases`.

## Principio de seguridad

La detección puede ser automática. La autoedición silenciosa no. Cualquier cambio de skill, contrato o fixture debe ocurrir en una tarea visible con snapshot, diff, pruebas y verificación integral.
