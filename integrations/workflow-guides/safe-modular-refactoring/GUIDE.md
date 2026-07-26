# Safe Modular Refactoring

## Purpose

Refactoriza aplicaciones y herramientas monolíticas por módulos sin cambiar su contrato visible ni su flujo de datos. Congela baseline, mapea ownership y dependencias, extrae responsabilidades en pasos pequeños, preserva compatibilidad y verifica equivalencia estructural, funcional y visual antes de cerrar.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **freeze-baseline** — Congelar comportamiento, estructura, hashes, tests y evidencia visual antes de editar.
2. **map-ownership-and-data-flow** — Entender responsabilidades, dependencias, estado y contratos antes de extraer código.
3. **extract-pure-modules** — Extraer primero lógica pura y compartida con el mínimo cambio observable.
4. **extract-state-and-interactions** — Separar estado, routing, render y wiring sin alterar eventos ni timing.
5. **preserve-render-contract** — Demostrar que DOM, CSS y aspecto siguen equivalentes.
6. **verify-equivalence** — Ejecutar la matriz completa de sintaxis, tests, build, runtime y regresión visual.
7. **persist-maintenance** — Cerrar con documentación mínima, diff acotado, rollback y aprendizaje reusable.

## Tool policy

Recommended tools:

- `project_context_load`
- `workflow_guide_load`
- `read_many_files`
- `list_files_smart`
- `analyze_code`
- `impact_analysis`
- `import_graph`
- `call_graph`
- `find_dead_code`
- `find_duplicate_symbols`
- `workspace_snapshot`
- `workspace_diff`
- `apply_patch`
- `edit_lines`
- `write_text_file`
- `work_once`
- `binary_file_info`
- `image_file_attach`
- `git_status`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
