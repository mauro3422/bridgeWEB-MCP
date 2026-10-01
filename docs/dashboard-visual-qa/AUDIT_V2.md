# Dashboard Bridge/MSSR — auditoría visual exhaustiva v2

Fecha: 2026-09-29

## Evidencia y alcance

La auditoría visual se realizó sobre el run headless:

- `data/dashboard-visual-qa/2026-09-29T15-59-38-263Z/`
- 61 vistas únicas retenidas.
- 33 vistas seleccionadas por la primera versión de la review queue y revisadas visualmente.
- 26 candidatas near-duplicate descartadas.
- 0 fallos de red; el único error de navegador observado fue `/favicon.ico -> 404`.

Después de la revisión se refinó la diversidad de la cola. El gate final del harness es:

- `data/dashboard-visual-qa/2026-09-29T16-07-24-857Z/`
- 60 vistas únicas.
- 30 vistas en review queue.
- 27 near-duplicates descartadas.
- 21 oportunidades heurísticas.
- 0 fallos de red.

La diferencia 61/60 corresponde a contenido vivo del dashboard durante capturas realizadas en momentos distintos; la UI productiva no fue modificada durante esta auditoría.

## Lectura general

El problema dominante no es falta de datos sino falta de **capas de lectura**. El dashboard expone con frecuencia el agregado, el detalle, la explicación metodológica y el registro forense al mismo tiempo. Eso vuelve superficies útiles en páginas muy altas y hace que la repetición visual compita con lo realmente excepcional.

Hay dos referencias internas que prueban una alternativa viable:

- **Errores** ya usa `details/summary`: resumen compacto primero, detalle completo sólo al expandir.
- **Sistema** cabe en un viewport y comunica estado con `label + valor + agrupación`, sin prosa repetida.

Esos patrones pueden generalizarse sin quitar observabilidad.

## Revisión cuadro por cuadro

### Resumen

#### Frame 000 · top

La cabecera, indicadores de salud y orientación inicial funcionan. Se entiende que Bridge está operativo antes de leer detalle. Mantener este carácter de primer vistazo.

#### Frame 002 · Estado actual

La sección sigue siendo escaneable. El problema empieza cuando metadata de host/modelo/variante se repite como texto secundario en múltiples agrupaciones. Esa metadata sirve para forense, no siempre para primer nivel.

#### Frame 004 · Resumen operativo limpio

Es uno de los mejores patrones de la página: pocos KPIs, jerarquía clara y poca explicación. Debe tomarse como referencia para otras superficies.

#### Frame 005 · Últimas operaciones

La combinación de acumuladores de tools y operaciones recientes es útil. Los bars de volumen ya demuestran que un agregado puede informar más rápido que una lista cruda.

#### Frame 007 · Resultados por tarea, sesión y proyecto

Comienza la pérdida de densidad: cliente, modelo, esfuerzo, tarea/session y proyecto generan filas visualmente parecidas. Las agrupaciones sin `task_key` repiten `tarea no identificada`, `sesión no expuesta`, host/model/effort y proyecto.

#### Frame 010 · final de Resultados

Confirma que la tabla crece verticalmente sin aportar la misma cantidad de información nueva. Propuesta: agrupar perfiles equivalentes por `proyecto + caller + modelo + esfuerzo + identidad de tarea`, mostrar `N sesiones`, calls, errors, cobertura y duración; expandir para ver las sesiones crudas.

**Cruce de código:** `renderAgentProfiles()` en `src/dashboard/script.ts` 188-214 imprime todos esos campos por fila. La propia descripción de `markup.ts` 116-120 ya dice que cada fila es una agrupación; la siguiente capa natural es una agrupación superior con drill-down.

### Dónde estoy / Cockpit

#### Frame 011 · top

`Dónde estoy ahora` debe seguir siendo dominante. Es la pregunta humana principal. `Al volver` es útil, pero ocupa demasiado pronto una gran superficie con Ayer + Trabajo activo + Deuda MSSR.

Propuesta: primer viewport dedicado a **Ahora / Siguiente / Atención**. `Ayer` y deuda administrativa pueden comenzar colapsados o en una segunda capa.

#### Frame 013 · En qué está cada proyecto

Los estados resumidos son útiles, pero la tabla vuelve a narrar contexto largo por proyecto. Mantener un resumen de estados y mostrar primero activos/review; el resto puede filtrarse o expandirse.

#### Frame 015 · Qué puede hacer el sistema hoy

El grid de familias es más legible que una tabla de 180 tools, pero aún es un inventario grande. Mejor patrón: búsqueda + familias compactas + `provider dependent` como filtro; abrir una familia para sus tools/capacidades.

#### Frame 016 · Qué hicimos esta semana

Los cuatro KPIs superiores funcionan. La tabla completa de proyectos es útil como segundo nivel. Conviene mostrar top proyectos/cambios primero y dejar `Ver todos los proyectos de la semana` como disclosure.

#### Frame 018 · Últimos 30 días

Es una superficie histórica y, por naturaleza, crece. Se observan varias filas con mensajes equivalentes como `Sin resumen diario retenido para este proyecto`. Agrupar esa ausencia en un contador y abrir la lista sólo si hace falta. El histórico no debería competir con el foco actual.

#### Frame 020 · Checklist de trabajo

Hay varias cards que pertenecen al mismo objetivo humano: tarea principal, trazas intermedias y recordatorios de cierre. Repetir la línea de fases para cada traza fragmenta la lectura.

Propuesta: una card por **tarea humana** con una sola barra/rail de lifecycle y un disclosure `trazas técnicas (N)` que contenga retries, recordatorios e intermediarios. Esto preserva provenance sin presentar cada trace como trabajo independiente.

**Cruce de código:** `markup.ts` 127-203 define nueve cards completas y sus explicaciones permanentes. Cockpit actualmente no tiene disclosure progresivo general.

### Actividad

#### Frame 021 · top

El timeline comunica actividad, pero consume mucho alto para una serie de buckets simples. Puede reducirse o ganar interacción.

#### Frame 022 · Timeline completo

La vista es casi el mismo estado del frame anterior. Esta repetición fue la razón para endurecer la review queue por sección.

Propuesta funcional: cada bucket de 5 min debería poder abrir un resumen de `calls / errors / p50 / p95 / top tools` y filtrar el detalle inferior.

#### Frame 023 · Timeline lower

Confirma redundancia visual con 021/022; no aporta una sección nueva. El harness final ya evita seleccionar tres cuadros equivalentes de esta zona.

#### Frame 024 · Llamadas recientes

`Herramientas MCP más usadas` es un buen acumulador: count, error rate, avg y barra. En contraste, `Llamadas recientes` muestra filas crudas y un campo Detalle muy largo.

#### Frame 025 · Llamadas recientes middle

Se repiten tools y detalles casi idénticos en segundos consecutivos. Propuesta: modo por defecto **Agregado**, agrupando una ventana corta por `tool + estado + task/session` con count, error rate, avg/p95 y last seen.

#### Frame 026 · final de llamadas

El raw log sigue siendo necesario para forense, pero debe ser segundo nivel. Toggle `Agregado | Raw`, o click en un grupo para desplegar invocaciones individuales. El campo Detalle puede vivir en el drill-down.

**Cruce de código:** `markup.ts` 206-228 coloca timeline, acumulador y 20 llamadas raw en la misma superficie. El acumulador ya existente es el patrón que conviene reutilizar.

### Tools

#### Frame 027 · top

Los cuatro KPIs del Tool Portfolio son correctos: registradas, con evidencia, sin evidencia, para revisar. El problema empieza inmediatamente debajo con el stream de recordatorios.

#### Frame 028 · Recordatorios accionables

Se ven múltiples notices con estructura y acción casi idénticas. Un `mssr-project-knowledge-review-due` debería ser un grupo con `N ocurrencias`, último timestamp, proyectos/traces afectados y una acción común.

#### Frame 030 · Recordatorios lower

La repetición continúa durante varios viewports. Aunque los notices individuales conserven provenance, no necesitan renderizar el mismo texto de preflight doce veces.

#### Frame 031 · Inventario verificable start

Cada tool imprime descripción completa, badges de contrato, evidencia, estado, recomendación y razón. Algunas descripciones ocupan varias líneas antes de llegar siquiera a la métrica operacional.

Propuesta: fila compacta con `tool | familia | calls | error | latencia | estado`. Click/expand abre descripción, schema/contrato, evidencia y recomendación. Sólo excepciones deberían iniciar expandidas.

#### Frame 032 · Inventario verificable bottom

A ~24k px el patrón sigue idéntico. Decenas de filas muestran literalmente `Keep the current contract and continue collecting operational evidence` y `Observed calls completed without errors.`. Esa recomendación normal debe convertirse en badge/leyenda compartida (`mantener`) y no texto repetido por tool.

Una estructura más útil sería:

1. `Requiere atención (N)` — abierto por defecto.
2. `Sin evidencia (N)` — colapsado, con smoke-test workflow.
3. `Sano con evidencia (N)` — colapsado.
4. dentro de cada grupo, filtros + tabla compacta/virtualizada.
5. expansión por tool para detalle completo.

**Cruce de código:** `renderToolPortfolioRows()` en `script.ts` 621-646 concatena siempre descripción completa y recomendación/razón completas. `updateToolNotices()` 649-667 renderiza cada notice como article individual aunque el `code` y la acción sean equivalentes. Los filtros existen (`markup.ts` 256-268), pero aparecen después del stream de notices y no solucionan la presentación por defecto.

### MSSR

#### Frame 034 · top

Los cuatro KPIs y el embudo son una buena capa operativa. El texto `Cada barra explica una etapa distinta` es razonable una vez, pero muchas secciones posteriores añaden explicación metodológica permanente.

#### Frame 043 · Contexto por traza / Presión por skill

Dos vistas relacionadas funcionan bien lado a lado, pero son ya una capa de diagnóstico avanzada. Podrían pertenecer a un grupo `Contexto y presión` expandible, dejando sólo un indicador de salud/resumen visible por defecto.

#### Frame 046 · Skills seleccionadas / cargadas

La comparación lado a lado es conceptualmente útil y debería conservarse. Puede resumirse con ratios/deltas arriba y listas sólo al expandir si el usuario quiere investigar por qué selección != carga.

#### Frame 052 · Activación/Rendimiento por identidad observada

Ambas tablas repiten la misma descripción de perfil (`chatgpt-web`, modelo, esfuerzo, lifecycle-only) en lados paralelos. Mejor master-detail por identidad: una fila/card de perfil con métricas de activación + resultado, y drill-down de lifecycle/transport.

#### Frame 056 · Ejecución por bucket

Esta es una buena agregación: low/high/other/unknown con métricas comparables. El problema es la cantidad de columnas y la explicación larga. Mantener el agregado, mover definiciones semánticas a ayuda contextual.

#### Frame 057 · Outcomes por skill primaria

La tabla es legible y accionable. Puede ser una sección secundaria sin necesidad de explicación larga siempre visible.

Diseño propuesto para MSSR dentro de la misma página:

- sticky local nav: `Overview | Contexto/Health | Routing/Skills | Identidad/Host | Outcomes`;
- Overview abierto con KPIs + embudo + alertas;
- las otras familias como secciones colapsables o anclas con resumen corto;
- metodología/definiciones en ayuda contextual accesible;
- tablas avanzadas conservadas, no eliminadas.

**Cruce de código:** `markup.ts` 286-438 define una larga secuencia de cards independientes; no existe un nivel superior que agrupe estas familias. Varias `.card-description` contienen metodología que podría vivir en un componente de ayuda.

### Errores

#### Frame 058 · top

Este patrón ya es correcto para densidad: lista compacta, mensaje truncado y una fila que puede abrirse. Es la referencia de disclosure progresivo para Tools/Actividad/Cockpit.

#### Frame 059 · lista inferior

La lista sigue siendo escaneable aun con muchos errores porque no imprime el payload completo. Para mejorar, se puede añadir agrupación opcional por `tool + categoría de error`, pero no es una urgencia estructural comparable a Tools.

**Cruce de código:** `renderErrors()` en `script.ts` 222-243 usa explícitamente `<details class="error-item"><summary ...>`. El harness v2 detectó `collapseAffordanceCount=20`, por lo que la medición de disclosure funciona correctamente.

### Sistema

#### Frame 060 · única vista

Es la mejor referencia de densidad general. Dos cards, campos claros, todo en un viewport. El espacio vacío inferior no es un problema: no hay que llenar la página por llenar. Este principio debe conservarse al compactar otras tabs.

## Modelo de interacción recomendado

No conviene resolver el problema con una sola técnica. La combinación más coherente es:

### 1. Summary-first

Cada tab empieza con 3–6 indicadores que respondan qué pasa y si requiere atención.

### 2. Acumuladores para repetición

Para eventos/calls/notices:

`grupo -> count -> last seen -> error/success stats -> projects/tasks afectados -> expandir eventos crudos`

Ejemplos inmediatos:

- `Llamadas recientes`: agrupar por tool/estado/task.
- `Recordatorios`: agrupar por notice code/source.
- `Resultados por sesión`: agrupar perfiles equivalentes.
- `Checklist`: agrupar trazas por tarea humana.

### 3. Disclosure progresivo

Usar el patrón ya existente de Errores: resumen compacto y detalle al expandir. Para cards enteras puede utilizarse `details/summary` o un componente accesible equivalente con `aria-expanded` y estado de teclado.

No esconder información esencial detrás de hover-only.

### 4. Master-detail para inventarios grandes

Tools no debería mostrar 180 descripciones completas simultáneamente. Tabla/lista compacta + panel/fila expandida para una tool seleccionada. Si el volumen sigue creciendo, virtualización o paginación del detalle es preferible a scroll infinito.

### 5. Navegación local para páginas profundas

MSSR puede conservarse como una sola tab, pero con subnav sticky/anclas por familia. El objetivo es poder saltar a una categoría sin recorrer ocho viewports.

### 6. Agregado vs. raw explícito

Cuando el raw log es valioso, no eliminarlo. Presentar dos niveles claros:

- `Agregado` por defecto para operación.
- `Raw` para forense.

## Cambios realizados al harness durante esta auditoría

El harness ahora separa **evidencia completa** de **review queue**:

- conserva todas las screenshots suficientemente distintas;
- calcula sección dominante y headings visibles;
- cuenta rows/cards/tables/buttons/links visibles por frame;
- registra repeticiones visibles;
- registra delta/novelty respecto del frame retenido anterior;
- calcula oportunidades deterministas de QA (`deep-scroll`, `large-row-set`, `repeated-row-copy`, `static-explanation-load`, `contextual-help-gap`, `progressive-disclosure-gap`, `table-fragmentation`);
- selecciona una cola representativa con máximo 2 vistas por sección, salvo extremos obligatorios;
- `--review-per-tab` es máximo, no cuota; no rellena con frames redundantes;
- genera `review-queue.json` y `review-queue.md`;
- el `contact-sheet.html` muestra primero la cola de revisión y deja la evidencia completa colapsada por tab.

Esto reduce trabajo visual sin sacrificar evidencia forense.

## Criterios para el siguiente slice de UI

Antes de tocar toda la página a la vez, conviene implementar un patrón común de disclosure/agrupación y probarlo en una superficie de alto impacto. La prueba debe demostrar:

- menor altura total sin perder datos;
- menor repetición visible;
- acceso en <=1 interacción al detalle que antes estaba inline;
- teclado/aria correctos;
- raw evidence todavía recuperable;
- mismo harness a `1440x1000` mostrando reducción real de deep-scroll/repetición y sin introducir errores runtime.

No se modificó la UI productiva en esta auditoría.