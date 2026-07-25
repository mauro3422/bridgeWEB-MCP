# Roblox Visual Benchmark

## Purpose

Plan, capture, criticize, compare, persist, and verify deterministic visual evidence for Roblox models, procedural growth, VFX, environmental props, world-space UI, 3D interaction visuals, and stateful presentation systems across projects.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **define-contract** — Definir el artefacto canónico, baseline, aspectos evaluados, fases semánticas, estados y criterios Pass/Fail.
2. **prepare-review-set** — Construir contextos de revisión aislado e integrado, regenerables y temporales.
3. **plan-cameras** — Diseñar cámaras repetibles según bounds, defecto investigado y contexto de uso.
4. **capture-matrix** — Capturar todas las combinaciones requeridas con progreso incremental y recuperación.
5. **measure-and-audit** — Combinar fotos con evidencia estructural, runtime y de cleanup.
6. **compare-and-criticize** — Revisar toda la matriz, guardar crítica accionable por versión y por captura, y elegir la corrección mínima.
7. **iterate-and-regress** — Aplicar la menor corrección canónica y repetir exactamente el benchmark.
8. **publish-dashboard** — Publicar automáticamente un historial navegable y verificable.
9. **maintain-workflow** — Convertir fricción repetida en mejoras transversales sin sobreajustar a un proyecto.

## Contrato de turnaround estático

Para modelos, props y carriers estáticos, usar por defecto una cabina aislada con **cámara hero fija y objeto giratorio**. Resolver una única posición, `lookAt` y FOV desde los bounds conservadores del giro completo; capturar frontal, tres cuartos, lateral y trasera variando sólo el yaw del sujeto. Usar una cámara superior separada únicamente cuando la huella, la corona o la distribución superficial aporten información.

El lote debe preservar los masters originales del backend. Cuando el backend interno de Studio incluya cubo de navegación u overlays fuera del sujeto, generar una derivada de revisión mediante recorte seguro a píxel nativo, registrar el rectángulo y el hash de origen, y conservar el raw intacto. Una captura física de ventana o una imagen con UI sobre el sujeto sigue siendo diagnóstica, no master aprobado.

## Tool policy

Recommended tools:

- `project_context_load`
- `workflow_guide_recommend`
- `workflow_guide_load`
- `skill_recommend`
- `skill_load`
- `roblox_mcp_status`
- `roblox_mcp_tool_list`
- `roblox_mcp_query`
- `roblox_mcp_action`
- `run_command`
- `write_text_file`
- `binary_file_info`
- `workspace_snapshot`
- `roblox_place_save`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
