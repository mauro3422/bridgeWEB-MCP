# Mantenimiento de MSSR

## Al crear una skill

1. Crear su `SKILL.md` con `name` y una descripción que explique claramente cuándo usarla.
2. Ejecutar `skill_route_audit`.
3. Revisar la metadata inferida sugerida.
4. Añadir una entrada explícita a `config/skill-routing/skill-routing-overrides.json` para skills propias.
5. Definir fase principal, `coversPhases` cuando el mismo procedimiento cubra fases adicionales, dominios, acciones, artefactos, necesidades, dependencias y activación. No uses `coversPhases` para ocultar varias responsabilidades independientes dentro de una sola skill.
6. Añadir un fixture positivo, uno negativo cercano y variantes de continuación cuando el flujo pueda retomarse con respuestas breves como “dale”, “sí”, “mandale”, “seguí”, “de una” o “hacé eso”.
7. Ejecutar `npm run test:skill-routing` y `npm run verify:all`.

La skill ya es visible antes del paso 4 porque el catálogo se reescanea, pero permanece en estado inferido y no se considera estable.

## Al modificar una skill

Actualizar routing y fixtures cuando cambie alguno de estos aspectos:

- propósito o disparadores;
- fase del workflow;
- dependencias o skills complementarias;
- artefactos cubiertos;
- tipo de prueba o persistencia requerida;
- alcance suficientemente grande como para justificar una segunda skill.

Una corrección de redacción que no cambia el comportamiento no requiere modificar el contrato.

## Renombrar o eliminar

- Cambiar todas las referencias en `requires`, `complements`, `excludes` y workflows.
- Migrar o eliminar la entrada anterior.
- Actualizar fixtures y documentación.
- Ejecutar la auditoría; una entrada vieja aparece como `staleConfigEntries` y una referencia rota como error.

## Skills grandes

La auditoría marca skills mayores de 500 líneas o 120.000 caracteres para revisión. Eso no obliga a dividirlas automáticamente.

Separar cuando exista:

- otro objetivo reusable;
- una referencia extensa que puede cargarse sólo cuando haga falta;
- scripts o plantillas que no deberían ocupar contexto;
- fases claramente independientes.

No separar sólo para cumplir una cifra si el procedimiento sigue siendo una unidad coherente.

## Tools nuevas o modificadas

Cuando una tool cambia qué workflows son posibles:

1. revisar descripciones y schemas MCP;
2. revisar qué skill debe enseñarla o exigirla;
3. actualizar routing y fixtures;
4. actualizar clasificación de riesgo en `src/tool-registry.ts`;
5. regenerar `TOOLS.md`;
6. ejecutar handshake y suite integral cuando corresponda.

## Errores de activación

- **Se activa de más:** añadir artefacto específico, `requireNeedMatch`, intención negativa o fixture negativo.
- **No se activa:** mejorar descripción, metadata, dependencia o fixture positivo.
- **Fase incorrecta:** corregir `phase`, workflow y `completedPhases` del caso.
- **Una continuación breve pierde el plan:** el caller debe enviar siempre un `context` resuelto y acotado para trabajos multi-turno, no depender de detectar una frase literal.
- **Dos skills compiten:** establecer roles complementarios, dependencia o exclusión; evitar duplicar procedimientos.

## Incidentes confirmados

Cuando una activación incorrecta sea reproducible, no la corrijas sólo con una condición ad hoc. Registra el caso en `docs/skill-routing/INCIDENTS.md` con:

- tarea y contexto mínimos;
- selección incorrecta observable;
- causa ubicada en vocabulario, fallback, metadata, workflow, scoring, dependencias o fases;
- corrección general aplicada;
- fixture positivo y negativo que bloquea la regresión;
- resultado de la suite completa.

Un exit code exitoso de un script de mantenimiento no prueba que el contrato cambió: lee de vuelta el archivo y ejecuta el fixture que debía fallar antes de continuar.

## Loop recomendado

```powershell
npm run check
npm run build
npm run test:skill-routing
python scripts\audit-skills.py
npm run verify:all
```

La detección se puede ejecutar automáticamente en CI o al cerrar una tarea. La reparación debe conservar revisión humana/agente, diff y rollback.
