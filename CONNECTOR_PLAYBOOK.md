# Connector playbook

Este documento funciona como una skill/instruccion operativa para usar `BrigdeMCP-WEB` desde ChatGPT.

No reemplaza `AGENTS.md`. Lo complementa con patrones concretos de uso de tools.

## Principio central

El bridge no es solo filesystem + shell. Es un flujo agentico local:

```txt
entender -> inspeccionar -> analizar impacto -> editar -> verificar -> commitear -> pushear
```

Regla base:

```txt
Usar la tool mas especifica disponible antes que run_command.
```

`run_command` es fallback, no primera opcion.

## Contexto minimo para operar

```txt
Repo: C:\dev\bridge-mcp
Perfil activo: bridge-local-http
Bridge MCP: http://127.0.0.1:3001/mcp
Tunnel admin: http://127.0.0.1:8081
Server esperado: bridge-mcp v0.5.1
Rollback: scripts/start-bridge-watchdog.ps1
```

Si aparece `8080`, tratarlo como contexto viejo salvo que el perfil haya cambiado intencionalmente.

## Reglas generales del agente

1. Antes de modificar, inspeccionar.
2. Antes de editar, ubicar lineas/simbolos exactos.
3. Antes de commitear, correr check/build.
4. Si se toca runtime, tunnel, HTTP, registry o tools, correr smoke/regressions.
5. Si se toca flujo completo, correr `bridge_verify_all`.
6. Si se requiere restart, usar `bridge_request_restart`.
7. No matar procesos activos del bridge desde la misma llamada MCP.
8. No leer ni imprimir datos sensibles locales.
9. No commitear runtime files, logs, bases locales, build output ni dependencias instaladas.
10. Cuando una tool falle de forma segura, usar el error como senal y ajustar el plan, no forzar cambios grandes.

## Seleccion rapida de tools

### Estado / salud

```txt
bridge_self_check      -> estado general: check/build/git/tunnel
bridge_restart_status -> restart request/ack
bridge_verify_all     -> verificacion completa
tunnel_health         -> solo tunnel health
system_info           -> maquina/runtime
```

### Lectura / busqueda

```txt
read_text_file     -> archivo completo chico/mediano
read_file_lines    -> rango puntual con lineas
read_many_files    -> varios archivos/rangos
search_files       -> grep literal con contexto
list_files_smart   -> mapa de carpeta con metadata
list_dir           -> listar directorio simple
```

### Edicion

```txt
apply_patch      -> reemplazo exacto, preferido si se conoce el texto
edit_lines       -> edicion por rango cuando se conocen lineas
write_text_file  -> crear archivo nuevo o reemplazo completo controlado
```

### Codigo / impacto

```txt
analyze_code            -> simbolos/imports/exports/referencias por archivo
impact_analysis         -> impacto de un simbolo
find_duplicate_symbols  -> duplicados por nombre/kind
import_graph            -> grafo de imports
dependency_graph        -> resumen de dependencias/ciclos/fan-in/fan-out
find_dead_code          -> candidatos de codigo muerto
```

### Git

```txt
git_status               -> estado corto
git_commit_all           -> stage + commit
git_push_current_branch  -> push
git_set_remote           -> configurar remote GitHub HTTPS
```

### Metricas

```txt
bridge_metrics_status
bridge_metrics_summary
bridge_metrics_recent
bridge_visualization_catalog
bridge_visualize_metrics
```

## Loops canonicos

### Loop A: inspeccion segura

```txt
1. git_status
2. list_files_smart o search_files
3. read_file_lines / read_many_files
4. analyze_code si el archivo es codigo
5. responder con hallazgos y siguiente accion
```

### Loop B: cambio de codigo puntual

```txt
1. read_file_lines del area
2. impact_analysis del simbolo si aplica
3. apply_patch o edit_lines
4. npm run check
5. npm run build
6. test-bridge-regressions si toca tools/registry
7. git_status
```

### Loop C: cambio de tool MCP

```txt
1. read_many_files de modulo + registry + tests
2. impact_analysis del nombre de tool o helper
3. editar modulo/tool schema/handler
4. npm run check
5. npm run build
6. test-bridge-regressions
7. docs:tools si cambio schema
8. bridge_request_restart si el runtime debe cargar la tool
9. tools/list sanity o bridge_verify_all
10. commit/push
```

### Loop D: diagnostico de bridge caido

```txt
1. bridge_restart_status si responde
2. tunnel_health si responde
3. run_command bridge-doctor.ps1 si hace falta
4. identificar capa rota: bridge HTTP, tunnel, build, config, Git
5. recuperar acceso antes de seguir editando
```

### Loop E: limpieza/refactor

```txt
1. dependency_graph
2. impact_analysis engine=semantic
3. find_duplicate_symbols
4. find_dead_code engine=semantic
5. leer candidatos manualmente
6. editar poco a poco
7. check/build/regressions
```

## Motores de codigo

### `regex`

Uso:

```txt
rapido
fallback
archivos sueltos
cuando TypeScript no esta disponible
```

### `typescript`

Uso:

```txt
AST por archivo
imports/exports/simbolos/referencias de identificadores
bueno para inspeccion local precisa
```

### `semantic`

Uso:

```txt
TypeScript Program + TypeChecker
referencias reales entre archivos
aliases/imports
impacto mas confiable
find_dead_code mas serio
```

### `resolutionEngine=typescript`

Uso en:

```txt
import_graph
dependency_graph
```

Sirve para resolver:

```txt
tsconfig
baseUrl
paths
barrels/index
extension rewriting
```

## 40 casos de uso

### A. Estado y diagnostico

#### 1. Ver si el bridge esta sano

Proceso:

```txt
bridge_self_check
```

Esperar:

```txt
ok=true
server v0.5.1
tunnel 8081 live/ready
git limpio o cambios esperados
```

#### 2. Verificar todo antes de cerrar una tanda

Proceso:

```txt
bridge_verify_all
```

Usar cuando:

```txt
se tocaron tools
se toco registry
se toco HTTP/tunnel
se quiere cerrar commit estable
```

#### 3. Revisar si hay restart pendiente

Proceso:

```txt
bridge_restart_status
```

Usar si:

```txt
hubo 502 temporal
se pidio bridge_request_restart
el watchdog esta reciclando proceso
```

#### 4. Confirmar solo el tunnel

Proceso:

```txt
tunnel_health
```

Usar si:

```txt
el bridge responde pero ChatGPT no conecta bien
hay duda entre tunnel y server HTTP
```

#### 5. Diagnostico profundo por script

Proceso:

```txt
run_command "powershell -NoProfile -File .\scripts\bridge-doctor.ps1"
```

Usar solo cuando:

```txt
las tools especificas no alcanzan
se necesita salida del doctor completo
```

### B. Navegacion de proyecto

#### 6. Entender una carpeta nueva

Proceso:

```txt
list_files_smart path=src/tools depth=2
```

Luego:

```txt
read_many_files de los archivos relevantes
```

#### 7. Buscar donde se define una tool

Proceso:

```txt
search_files pattern="tool_name" path=src filePattern="*.ts"
read_file_lines del resultado
```

#### 8. Leer una implementacion sin saturar contexto

Proceso:

```txt
read_file_lines path=archivo startLine=N maxLines=120
```

Evitar:

```txt
read_text_file en archivos enormes si solo se necesita un rango
```

#### 9. Comparar modulo + tests + docs

Proceso:

```txt
read_many_files files=[modulo.ts:1-160, test.ps1:1-120, README.md:seccion]
```

#### 10. Buscar texto literal con contexto

Proceso:

```txt
search_files pattern="SERVER_VERSION" contextLines=2
```

Usar antes de:

```txt
reemplazos globales
version bumps
limpieza de docs
```

### C. Edicion segura

#### 11. Reemplazo exacto chico

Proceso:

```txt
apply_patch oldText=... newText=...
```

Ventaja:

```txt
falla si el texto exacto no coincide
reduce ediciones accidentales
```

#### 12. Edicion por rango conocido

Proceso:

```txt
read_file_lines
edit_lines startLine/endLine/newContent
```

Usar cuando:

```txt
el bloque es largo o el texto exacto es dificil
```

#### 13. Crear archivo nuevo

Proceso:

```txt
write_text_file append=false
npm run check si es codigo
```

#### 14. Agregar una seccion a docs

Proceso:

```txt
read_text_file
apply_patch insertando cerca de una seccion estable
```

Si el patch falla:

```txt
read_file_lines del area y ajustar oldText
```

#### 15. Regenerar docs desde schema

Proceso:

```txt
npm run docs:tools
npm run docs:tools:check
```

Usar si cambio:

```txt
tool name
description
inputSchema
module registry
```

`bridge_verify_all` tambien ejecuta `docs:tools:check`, asi que `TOOLS.md` queda controlado contra las definitions/schemas reales.

### D. Tools MCP y registry

#### 16. Agregar una tool nueva

Proceso:

```txt
read_many_files de modulo parecido + tool-registry.ts + regression test
crear/editar modulo
registrar modulo
npm run check/build
test-bridge-regressions
npm run docs:tools
bridge_request_restart
bridge_verify_all
```

#### 17. Cambiar schema de tool existente

Proceso:

```txt
analyze_code modulo
impact_analysis nombre_tool engine=semantic
editar schema + handler + tests
npm run docs:tools
```

#### 18. Mover una tool entre modulos

Proceso:

```txt
dependency_graph resolutionEngine=typescript
impact_analysis del handler
mover codigo
actualizar imports/registry
test-bridge-regressions
```

#### 19. Ver si una tool esta expuesta realmente

Proceso:

```txt
bridge_verify_all
```

o:

```txt
run_command directo a /mcp tools/list
```

#### 20. Resolver cache de catalogo en ChatGPT

Proceso:

```txt
confirmar tools/list por HTTP
reiniciar bridge si hace falta
refrescar/reabrir conector
nuevo chat si sigue stale
```

### E. Analisis de codigo

#### 21. Analizar un archivo TypeScript

Proceso:

```txt
analyze_code path=archivo engine=typescript
```

Devuelve:

```txt
imports
exports
symbols
diagnostics
references si se pasa symbol
```

#### 22. Analizar impacto real de simbolo

Proceso:

```txt
impact_analysis name=Simbolo engine=semantic
```

Usar antes de:

```txt
renombrar
mover
borrar
cambiar firma
```

#### 23. Ver duplicados de nombres

Proceso:

```txt
find_duplicate_symbols engine=typescript exportedOnly=false
```

Usar si:

```txt
hay helpers con nombres similares
se sospecha codigo repetido
```

#### 24. Ver dependencias del proyecto

Proceso:

```txt
dependency_graph resolutionEngine=typescript
```

Mirar:

```txt
cycles
unresolved
mostImported
mostImporting
orphanFiles
```

#### 25. Ver imports externos e internos completos

Proceso:

```txt
import_graph includeExternal=true resolutionEngine=typescript
```

Usar para:

```txt
auditar dependencias
ver aliases
ver barrels
```

### F. Limpieza y refactor

#### 26. Buscar codigo muerto conservador

Proceso:

```txt
find_dead_code engine=semantic includeExported=false
```

Despues:

```txt
read_file_lines candidato
impact_analysis candidato engine=semantic
```

No borrar automaticamente.

#### 27. Evaluar exports no usados

Proceso:

```txt
find_dead_code engine=semantic includeExported=true
```

Cuidado:

```txt
exports pueden ser usados fuera del repo
confidence baja si es exported
```

#### 28. Detectar acoplamiento excesivo

Proceso:

```txt
dependency_graph resolutionEngine=typescript
revisar mostImported y mostImporting
```

#### 29. Eliminar modulo obsoleto

Proceso:

```txt
impact_analysis simbolos principales
import_graph para edges hacia el archivo
find_dead_code
editar en pasos pequenos
check/build/regressions
```

#### 30. Dividir archivo grande

Proceso:

```txt
analyze_code archivo
impact_analysis simbolos exportados
crear nuevo modulo
mover con apply_patch/edit_lines
actualizar imports
check/build
```

### G. Git y release

#### 31. Ver estado antes de operar

Proceso:

```txt
git_status
```

#### 32. Commit de tanda estable

Proceso:

```txt
bridge_self_check
git_commit_all message="..."
```

#### 33. Push de branch actual

Proceso:

```txt
git_push_current_branch remote=origin branch=main
```

#### 34. Preparar release menor

Proceso:

```txt
search_files version actual
apply_patch version bump
npm run check/build/regressions
npm run docs:tools
git_commit_all
git_push_current_branch
```

#### 35. Verificar repo limpio post-push

Proceso:

```txt
git_status
bridge_self_check
```

### H. Metricas y observabilidad

#### 36. Ver si metricas funcionan

Proceso:

```txt
bridge_metrics_status
```

Esperar:

```txt
enabled=true
sqliteAvailable=true
paths validos
```

#### 37. Ver tools mas usadas

Proceso:

```txt
bridge_metrics_summary limit=50
bridge_visualize_metrics kind=calls_by_tool
```

#### 38. Revisar errores por tool

Proceso:

```txt
bridge_visualize_metrics kind=errors_by_tool
bridge_metrics_recent limit=50
```

Interpretacion:

```txt
apply_patch puede fallar sanamente si oldText no coincide
read_text_file puede fallar sanamente por limites/ruta
errores en write/git/restart/check son mas preocupantes
```

#### 39. Revisar latencias

Proceso:

```txt
bridge_visualize_metrics kind=avg_duration_by_tool
```

Esperado:

```txt
bridge_verify_all mas lento
bridge_self_check medio
read/apply/write muy rapidos
semantic analysis puede ser medio/lento
```

#### 40. Ver actividad reciente

Proceso:

```txt
bridge_metrics_recent limit=25
bridge_visualize_metrics kind=activity_timeline
```

Usar para:

```txt
saber que paso en la ultima tanda
ver si una tool realmente se llamo
confirmar que metricas estan vivas
```

## Instrucciones compactas para pegar en un conector/chat

```txt
Use BrigdeMCP-WEB as a local operating bridge for C:\dev\bridge-mcp.
Prefer explicit MCP tools over shell commands.
For code work: inspect with read/search/analyze tools, edit with apply_patch/edit_lines, validate with check/build/regressions, then commit/push.
Use impact_analysis engine=semantic before renaming/moving/removing symbols.
Use dependency_graph/import_graph resolutionEngine=typescript before module refactors.
Use bridge_request_restart for restarts; do not kill active bridge/tunnel processes directly.
Run npm run docs:tools after schema/tool changes.
Treat tunnel admin 8081 as current; 8080 is stale unless profile changed intentionally.
```

## Que falta despues de este playbook

Sacando seguridad/permisos/cache, lo mas util seria:

```txt
1. RELEASE.md con checklist de version
2. ejemplos reales por receta en EXAMPLES.md
3. tests fixture para tsconfig paths/barrels
4. script que compare TOOLS.md contra registry y falle si esta desactualizado
5. tool profile docs: minimal/read-only/coding/full-ops
6. guias de recuperacion por sintoma: 502, stale catalog, tunnel down, dirty git
```
