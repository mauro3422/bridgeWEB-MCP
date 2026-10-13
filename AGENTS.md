# AGENTS.md

Guía de trabajo para agentes que operen este repo.

## Proyecto

`bridge-mcp` es un MCP local propio para operar MauroPrime desde ChatGPT mediante OpenAI Secure MCP Tunnel.

Stack principal:

- Node.js / TypeScript
- `@modelcontextprotocol/sdk`
- `zod`
- MCP por stdio y Streamable HTTP
- OpenAI Secure MCP Tunnel con `tunnel-client`
- métricas locales con `node:sqlite`

## Rutas canónicas (promoción verificada 2026-10-11)

- **Checkout integrado/publicable:** `D:\Dev\bridge-mcp-candidate-0.6.160-mssr-0.2.109` (`main`, Bridge source 0.6.172); el candidato pasó `verify-all.ps1` antes de su activación.
- **BridgeCodeRoot del watchdog HTTP activo:** `D:\Dev\bridge-mcp-mssr-0.2.112-query-variants`, ejecutando Bridge 0.6.172 desde el commit `391a1bb` tras el reinicio controlado del 2026-10-11. Verifica PID, `/status`, `readyz` y argumentos del watchdog antes de cambiar rutas.
- **ProjectRoot del runtime HTTP:** `D:\Dev\bridge-mcp`, dueño de datos, logs, perfil y archivos request/ack del watchdog. También conserva un checkout histórico con cambios staged, unstaged y untracked: no usarlo para commits de release, no limpiarlo ni fusionarlo a ciegas.
- **MSSR dueño de routing/contexto:** `D:\Dev\mssr` (MSSR 0.2.130).
- `C:\dev\bridge-mcp` es una ruta heredada o alias posible: verificar su resolución antes de escribir.
- Preservar los worktrees y experimentos no reconciliados. No reiniciar Bridge/túnel sólo para documentación o para corregir el cache del catálogo del host.

Antes de escribir: `git_status` del checkout correcto, `bridge_health` del runtime y verificación de versión en `package.json`; diferenciar siempre **BridgeCodeRoot** de **ProjectRoot**.

## Estado recomendado

Modo actual recomendado:

```text
HTTP production-candidate
```

Arquitectura:

```text
ChatGPT
  -> Secure MCP Tunnel
  -> bridge-local-http
  -> http://127.0.0.1:3001/mcp
  -> bridge-mcp en MauroPrime
```

`stdio` sigue disponible como rollback.

## Reglas de seguridad

- No tocar perfiles de túnel estables sin dejar rollback.
- No commitear secretos, tokens, `.env`, logs ni bases SQLite.
- No borrar backups ni scripts de rollback.
- No matar procesos del bridge sin verificar cómo volver a levantarlo.
- No reemplazar archivos grandes a ciegas; preferir patches puntuales.
- Antes de cambiar código de transporte MCP, probar handshake completo.
- El catálogo de herramientas de ChatGPT puede quedar **desactualizado** aunque el runtime esté sano. Contrastar los nombres del conector con `bridge_connector_catalog_compare` y el schema del runtime con `bridge_tool_schema`; no suponer que un wrapper equivale a un parámetro MCP top-level ausente.
- **Selección predeterminada para archivos ChatGPT → PC (verificado 2026-10-09):** imágenes generadas/editadas o adjuntas → `image_asset_import_files` primero; otros formatos (audio, video, ZIP, documentos, `.blend`, etc.) → `asset_import_files` cuando acepte el dominio de descarga autorizado. Ambas usan `_meta["openai/fileParams"]` y `files` top-level expuesto por el host. Nunca inventar `download_url`, convertir `file_id` en URL, ni enviar Base64 grande por `blender_execute_code`.
- **Fallo concreto probado:** `asset_import_files` puede responder `[unsafe-url] Download hostname not allowlisted` ante una URL temporal genuina, aunque `image_asset_import_files` descargue esos mismos PNG correctamente. Para imágenes, reintentar UNA vez con `image_asset_import_files` y validar hashes; no debilitar allowlist/SSRF del importador genérico ni fabricar intermediarios. Para archivos no-imagen, conservar estado bloqueado y documentar el dominio sin divulgar tokens de la URL; investigar allowlist por separado y con pruebas de seguridad.
- Verificar `binary_file_info` de CADA destino en `D:` (existencia, bytes, firma/MIME y SHA-256) contra el manifiesto y la fuente antes de informar éxito. Un resultado MCP `saved` por sí solo no prueba archivo utilizable ni Blender abierto. `image_asset_save` y `binary_upload_*` son fallbacks únicamente cuando hay bytes reales accesibles; no traducir un adjunto inaccesible a texto para saltarse el contrato.
- **Biblioteca central de archivos:** por defecto guardar los originales nuevos en `D:\ChatGPT\Biblioteca` (clasificados como `imagenes`, `audio`, `videos`, `documentos`, `modelos-3d`, `otros`; manifiestos en `manifiestos`). El contrato de almacenamiento y las reglas de copia reutilizable están en `D:\ChatGPT\AGENTS.md` y `D:\ChatGPT\Biblioteca\README.md`. Para Blender, consultar primero la Biblioteca y copiar/usar allí imágenes originales antes del modelo y empaquetarlas en el `.blend`.
- Copiar/descargar un instalador no autoriza ejecutarlo o instalarlo. No usar Google Drive como relay por defecto. Procedimiento: `docs/ASSET_FILE_INGEST.md`.

## Comandos obligatorios antes de commitear

Desde el checkout de código canónico (ver **Rutas canónicas**):

```powershell
npm run check
npm run build
```

Para HTTP:

```powershell
.\scripts\test-bridge-http.ps1
Invoke-RestMethod http://127.0.0.1:3001/status
Invoke-RestMethod http://127.0.0.1:8081/readyz
```

## Watchdog HTTP

`-DryRun` is observational only: it must not stop or replace an external process, consume a restart request, or write a restart acknowledgement. Keep a regression for those side-effect boundaries.

Arranque manual recomendado:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bridge-http-watchdog.ps1 `
  -ProjectRoot D:\Dev\bridge-mcp `
  -BridgeCodeRoot D:\Dev\bridge-mcp-mssr-0.2.112-query-variants `
  -Profile bridge-local-http `
  -TunnelBaseUrl http://127.0.0.1:8081
```

Health esperado:

```text
http://127.0.0.1:3001/readyz -> ready
http://127.0.0.1:8081/readyz -> ready
```

Diagnóstico seguro sin matar procesos:

```powershell
.\scripts\bridge-doctor.ps1
```

Limpieza segura de procesos dev/test, primero en modo simulación:

```powershell
.\scripts\clean-bridge-dev-processes.ps1
.\scripts\clean-bridge-dev-processes.ps1 -Apply
```

El watchdog HTTP usa protección singleton. No arrancar otro watchdog production encima del activo salvo que se esté haciendo una prueba controlada con `-NoTunnel`, `-Once`, `-DryRun` o `-AllowDuplicate`.

## Rollback stdio

Si HTTP falla, volver a stdio:

```powershell
cd D:\Dev\bridge-mcp-candidate-0.6.160-mssr-0.2.109
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-bridge-watchdog.ps1 -ProjectRoot D:\Dev\bridge-mcp
```

Perfil estable histórico:

```text
bridge-local -> stdio
```

Perfil HTTP production-candidate:

```text
bridge-local-http -> http://127.0.0.1:3001/mcp
```

## Métricas

Archivos runtime ignorados por Git:

```text
logs/bridge-events.jsonl
data/bridge-metrics.sqlite
```

Consultas:

```powershell
node .\scripts\query-bridge-metrics.mjs status
node .\scripts\query-bridge-metrics.mjs summary 50
node .\scripts\query-bridge-metrics.mjs recent 25
node .\scripts\query-bridge-metrics.mjs errors 25
```

## Visualizaciones

El módulo `src/visualizations.ts` genera specs para gráficos renderizables en ChatGPT.

Tools relacionadas:

```text
bridge_visualization_catalog
bridge_visualize_metrics
```

Tipos disponibles:

```text
calls_by_tool
avg_duration_by_tool
errors_by_tool
activity_timeline
success_mix
```

## Dashboard local

Dashboard navegador local:

```text
http://127.0.0.1:3001/dashboard
```

No confundir con widgets internos de ChatGPT. La UI local sirve para MauroPrime; las cards internas del chat se generan desde specs de visualización.

## Flujo de trabajo recomendado

1. Leer `README.md`, `TOOLS.md`, `CONNECTOR_CONTEXT.md` y `CONNECTOR_PLAYBOOK.md`.
2. Verificar estado con `/status` y `/readyz`.
3. Hacer cambios pequeños y testeables.
4. Ejecutar `npm run check` y `npm run build`.
5. Probar HTTP si se tocó transporte, métricas o tools.
6. Commitear con mensaje corto y claro.
7. Pushear sólo si el estado queda estable.

## Convenciones

- Preferir TypeScript estricto y funciones pequeñas.
- Mantener herramientas peligrosas explícitas y auditables.
- Los scripts PowerShell deben ser copy-paste friendly.
- Los logs deben ayudar a diagnosticar sin filtrar secretos.
- Las métricas deben guardar nombres, tiempos y estados, no argumentos crudos.

## Notas para agentes futuros

Mauro usa este bridge como “mini-Codex” local. Priorizar estabilidad sobre features rápidas. Si hay duda entre probar y asumir, probar. Si el puente se cae, recuperar primero el acceso y recién después seguir programando.


## Alias mentales para procesos

- tarea_corta -> run_command
- tarea_larga -> terminal_start
- revisar_tarea -> terminal_read
- listar_tareas -> terminal_list
- enviar_entrada -> terminal_write
- cerrar_tarea -> terminal_stop


## Context loading and reusable workflow guides

- `AGENTS.md` is the Codex-facing repository instruction file.
- ChatGPT web and other MSSR hosts receive repository context through the portable MSSR project-control plane. Keep stable facts in `.mssr/PROJECT_CONTEXT.md`, durable decisions/lessons in `.mssr/PROJECT_MEMORY.md`, mutable progress in `.mssr/PROJECT_STATE.md`, topic/area knowledge in `.mssr/knowledge/`, and ephemeral receipts/cache under `.mssr/runtime/`; `.mssr/project-context.json` is the only selectable project-context manifest. MSSR never falls back to `.bridge/`; old MSSR-owned `.bridge` artifacts are migration/cleanup evidence only.
- Reusable Bridge workflow guides remain Bridge-owned and may live in `integrations/workflow-guides/<name>/` globally or `<project>/.bridge/workflow-guides/<name>/` per project. Do not migrate unrelated Bridge-specific `.bridge` data merely because MSSR project authorities moved to `.mssr`.
- Keep `.mssr/.gitignore` narrow: ignore only `/runtime/`; never ignore the whole `.mssr/` directory, PROJECT_* authorities, `.mssr/knowledge/`, or project-context manifests.
- When adding or changing a tool, update its description, schema, annotations, regression coverage, generated `TOOLS.md`, server version, and `tools/list` verification.
- Every substantive release uses `changelogs/X.Y.Z.md` plus `changelogs/INDEX.md`. The version file must summarize the change and declare `PROJECT_CONTEXT`, `PROJECT_MEMORY`, and `PROJECT_STATE` impact as `updated`, `reviewed-none`, or `pending`; `pending` is not publishable.
- Before persistence/publication, run the read-only `project_change_consistency` gate. Use `scope=staged` for the final commit gate when other tasks may share the working tree, so unrelated parallel edits are not attributed to this release. A clean build does not substitute for reviewing whether project knowledge and the current version changelog reflect the change. The gate may block persistence but must never invent or auto-write project memory.
- Keep MCP server instructions concise. Put detailed procedures in workflow guides and load them only when relevant.
- Never claim a file, process, scene, build, or remote update exists until a tool result verifies it.


## MSSR — Modular Semantic Skill Router

- MSSR is an independent sibling system. Canonical documentation: `D:\Dev\mssr\docs\skill-routing\README.md`.
- Custom skill Git source: `D:\Dev\mauroprime-skills\skills`; Codex runtime paths under `~/.codex/skills/<name>` are junctions to that repository.
- Canonical Git-tracked contract and fixtures: `D:\Dev\mssr\config\skill-routing\`.
- Bridge imports `@mauroprime/mssr` and remains an adapter for ChatGPT, local/plugin discovery, skill content loading and Roblox health. It is not the MSSR owner or an execution bottleneck.
- Project bootstrap uses canonical `.mssr/project-context.json`; packaged MSSR reads only the canonical `.mssr` project-control contract. Missing or invalid initialization is surfaced through Project Context Health and must be normalized explicitly; `.bridge` is never project-context fallback. `project_context_load` loads AGENTS plus only the manifest core before intent when possible; once canonical intent exists, project `context`, `memory`, `state`, and scoped `directive` modules are selected by stage and semantic tags instead of blindly injecting all durable documents.
- Keep `.mssr/PROJECT_CONTEXT.md` for stable facts/architecture/ownership, `.mssr/PROJECT_MEMORY.md` for durable decisions/lessons, and `.mssr/PROJECT_STATE.md` for mutable current status. A `directive` module is only a conditional local refinement and cannot weaken user instructions, AGENTS, safety, approvals, permissions, or verification. Pass the same `projectRoot` into `skill_bootstrap` so phase changes can re-select project modules with skill context.
- Persist deliberate project knowledge with `project_context_update` instead of blind append when the dedicated tool is available. Use stable headings, pass `expectedSha256` after reading an existing target, and register module metadata only when the section should be selectable by MSSR. `directive` registration is explicit and conditional; never use it to smuggle a broad permanent rule that belongs in AGENTS.
- Before substantial specialized work, infer compact structured intent with `domains`, `actions`, `artifacts`, `needs`, `signals`, `risk`, and `ambiguity`, then use `skill_route_plan` or `skill_bootstrap`.
- Always emit at least one semantic `signal`. Use only `nominal` when no anomaly exists; otherwise include observable incident, capability-discovery, tool-chain, provider-refresh or replan signals.
- The current agent produces that intent during its normal turn; MSSR does not call a hidden classifier model. Pass `caller=codex-local` or `caller=chatgpt-web` when known and follow the returned execution guidance.
- Load `mssr-agent-routing` as the transversal protocol. The first route is advisory, not an allowlist: if another capability is needed, search/inspect or refresh providers, re-plan, and continue through normally authorized tools.
- Semantic tags may select skills, tools, phases and checks, but must never bypass normal authorization for destructive mutations or external side effects.
- For every multi-turn specialized `skill_route_plan` or `skill_bootstrap` call, pass a bounded resolved `context` summary—normally 500–2000 characters covering the accepted goal, relevant constraints, completed work/current phase, and unresolved references. This applies to any short continuation or acceptance such as “dale”, “ok”, “sí”, “mandale”, “seguí”, “de una”, “hacé eso”, or equivalent wording. Omit context only for a genuinely standalone first turn; never pass chain-of-thought, irrelevant history, or a full transcript.
- `skill_bootstrap` usa ensamblado `selective` y planner global `global-required-core-first`: reserva todos los cores requeridos antes de módulos. Los stateful MSSR hosts usan `host-gated` por defecto: los roots requeridos siguen siendo obligaciones; un root opcional sólo se materializa tras `accepted`; `skipped` es feedback observable con motivo acotado; y ausencia de decisión permanece `pending`, nunca un skip sintético. El cierre transitivo de dependencias acompaña sólo a roots elegibles. `auto` es modo explícito de compatibilidad/debug, no el default normal del host. `contentMode=full` queda para diagnóstico/rollback; `skill_load` continúa siendo la lectura completa explícita.
- Bridge puede mantener working metadata efímera por traza (`workingSummary`, hipótesis, decisiones/evidencia y `nextGate`) sólo en RAM mientras la traza está abierta. Se purga en outcome o restart y nunca debe contener prompts crudos, transcripts, secretos ni chain-of-thought privado. El preflight de cierre expone `closureDue`, gates faltantes y `nextRequiredAction`; el idle sólo puede marcar una traza para revisión, nunca inferir `success`.
- El watcher host puede aportar a MSSR metadata acotada y observable —stage de traza, categorías/paths relativos modificados, cantidad de writes materiales, package/runtime adoption, cambios de routing/estructura de skills, freshness conflicts y user corrections— para `evaluateMssrProjectKnowledgeMaintenance`. `WATCH` no fuerza carga ni escritura; `REVIEW`/`REQUIRED` vuelve maintenance obligatoria y carga sólo `skill-maintenance-loop` más la autoridad `.mssr` señalada. Si afecta routing/skill/reference, compone `skill-routing-maintainer`. La metadata nunca es autoridad y no autoedita AGENTS, `.mssr/PROJECT_*`, skills, references ni routing.
- After creating, renaming, deleting, splitting, or materially changing a skill, load `skill-routing-maintainer`, run `skill_route_audit`, update positive/negative/continuation fixtures, and execute `npm run test:skill-routing` in `D:\Dev\mssr`.
- A new local skill may be discovered with inferred metadata, but it is not routing-stable until the audit is clean and its explicit entry and fixtures are committed.
- Automated checks may detect drift and block verification. Do not silently autoedit skills or routing configuration in the background.
