# Primera auditoría visual + código del dashboard Bridge/MSSR

Fecha: 2026-09-29

Evidencia visual verificada:

- `data/dashboard-visual-qa/2026-09-29T15-23-12-444Z/manifest.json`
- `data/dashboard-visual-qa/2026-09-29T15-23-12-444Z/contact-sheet.html`
- `data/dashboard-visual-qa/2026-09-29T15-23-12-444Z/screens/`

Esta auditoría se hizo en el orden visual -> código. No se modificó la UI productiva durante este pase.

## Resumen medible

| Tab | Alto | Descripciones | Palabras explicativas | `title` técnicos | Ayuda contextual explícita |
| --- | ---: | ---: | ---: | ---: | ---: |
| Resumen | 2.880 px | 4 | 70 | 67 | 0 |
| Dónde estoy | 5.629 px | 9 | 250 | 0 | 0 |
| Actividad | 1.753 px | 1 | 11 | 39 | 0 |
| Tools | 24.771 px | 4 | 45 | 180 | 0 |
| MSSR | 8.157 px | 17 | 406 | 83 | 0 |
| Errores | 1.383 px | 1 | 15 | 0 | 0 |
| Sistema | 1.000 px | 0 | 0 | 0 | 0 |

`title` significa atributo nativo del navegador. En este dashboard se usa sobre todo para barras, nombres completos o datos técnicos truncados. No equivale a una affordance de ayuda conceptual visible.

## Hallazgos prioritarios

### 1. Tools tiene una explosión de repetición por fila

Es el problema de densidad más claro. La tabla llega a 24.771 px y repite mensajes idénticos para decenas de tools.

Repeticiones medidas en el run:

- `Keep the current contract and continue collecting operational evidence.`: 75 veces.
- `Run a bounded smoke test before changing lifecycle or visibility.`: 63 veces.
- `No operational calls were observed in the selected metrics window.`: 63 veces.
- `Observed calls completed without errors.`: 54 veces.
- `Preserve the tool contract and require regression coverage for material changes.`: 19 veces.

Causa en código: `src/dashboard/script.ts`, renderer del portfolio alrededor de las líneas 639-645. Cada fila imprime siempre descripción, evidencia, recomendación y razón completas; no existe agrupación ni supresión de recomendaciones idénticas.

Dirección de corrección:

- mostrar recomendación/razón completa sólo cuando aporta una excepción o requiere atención;
- para estados normales, usar una etiqueta corta y llevar la explicación a tooltip/details;
- agrupar recomendaciones idénticas o mostrar una leyenda común una sola vez;
- limitar descripción secundaria por línea y permitir expandir cuando haga falta.

### 2. MSSR mezcla dashboard operativo con documentación metodológica

MSSR tiene 8.157 px, 37 cards, 11 tablas, 17 descripciones y 406 palabras de explicación estática antes de contar el contenido dinámico.

Visualmente aparecen, una detrás de otra, explicaciones de:

- cobertura y cumplimiento;
- ensamblado selectivo;
- salud estructural de skills;
- salud de contexto de proyectos;
- tunnel/runtime/restart;
- selected vs loaded skills;
- aceptación/skips;
- priors `observe-only`;
- correlación por identidad;
- llamadas físicas vs lifecycle;
- buckets de reasoning effort;
- atribución primaria de outcomes.

Causa en código: `src/dashboard/markup.ts` concentra esas explicaciones como `.card-description` permanentes, aproximadamente entre las líneas 289-430. `src/dashboard/styles.ts` muestra `.card-description` siempre; no hay un patrón de progressive disclosure asociado.

Dirección de corrección:

- separar lectura operativa de metodología/auditoría avanzada;
- mantener visible una frase corta por sección;
- mover definiciones, disclaimers y metodología a un componente de ayuda contextual consistente;
- considerar sub-secciones o colapsables para auditorías avanzadas sin perder evidencia.

### 3. Cockpit no cumple del todo su objetivo de “volver y entender rápido”

`Dónde estoy` ocupa 5.629 px y contiene 250 palabras explicativas fijas. Tiene 9 cards, 4 tablas y cero `title`, `aria-label` o affordances de ayuda contextual detectables.

El primer viewport sí contiene información útil, pero después conviven en la misma superficie:

- foco actual;
- resumen al volver;
- mapa de proyectos;
- capacidades del sistema;
- semana;
- últimos 30 días;
- checklist de trazas;
- presión Git;
- mantenimiento/referencias.

Además hay conceptos internos como `taskKey`, fallback de agrupación, owner canónico, snapshots y clasificación conservadora explicados permanentemente en cuerpo de página.

Causa en código: `src/dashboard/markup.ts` alrededor de las líneas 127-203 define nueve cards de Cockpit con descripciones extensas incrustadas.

Dirección de corrección:

- hacer que el primer viewport responda sólo “qué está activo / qué sigue / qué requiere atención”;
- mover semana, 30 días e inventarios a disclosure progresivo o vistas secundarias;
- evitar repetir el mismo título/contexto entre card principal y contenido interno;
- convertir semántica interna de MSSR en ayuda contextual, no en texto necesario para leer cada vez.

### 4. Falta un sistema coherente de tooltips/ayuda contextual

El código sí usa `title`, pero de manera incidental y técnica. Ejemplos en `src/dashboard/script.ts`:

- timeline bars: alrededor de la línea 86;
- tool hints de llamadas recientes: ~182;
- session/coverage: ~205-210;
- nombres/signatures truncados: ~429-485;
- métricas de transport/routing: ~526-557, ~814, ~869-871.

No se encontró un componente general de ayuda del tipo `data-tooltip`, `aria-describedby`, `.help-icon` o `.info-button` en ninguna de las siete tabs; el harness reportó `helpAffordanceCount = 0` en todas.

Dirección de corrección:

- crear un único patrón de ayuda accesible y reutilizable;
- usarlo para definiciones, advertencias metodológicas y semántica de métricas;
- no reemplazar contenido esencial por hover-only: el label/valor debe seguir siendo comprensible sin tooltip;
- mantener `aria-describedby`/teclado para no depender del mouse.

### 5. Resumen y Actividad son utilizables, pero pueden simplificarse

`Resumen` tiene una jerarquía visual razonable en el primer viewport, aunque su tabla inferior vuelve a densificarse con metadata host/proyecto. `Actividad` es compacta y sus barras tienen `title` + `aria-label`, lo que es una referencia útil para interacción técnica simple.

Conviene conservar su patrón de lectura rápida y evitar que absorban metodología que pertenece a MSSR/ayuda contextual.

### 6. Sistema es la mejor referencia actual de densidad

`Sistema` cabe en 1.000 px, muestra estado/runtime/persistencia con dos cards y no necesita explicación extensa para ser legible. Es una buena referencia interna para el principio “label claro + valor + agrupación”, aunque algunas métricas avanzadas sigan requiriendo ayuda contextual en otras tabs.

## Hallazgo funcional menor

Chrome registra un único error durante el recorrido:

`http://127.0.0.1:3001/favicon.ico -> 404`

No hubo `Network.loadingFailed` y el dashboard completó las siete tabs. Es un defecto cosmético/console-noise, no un fallo del dashboard.

## Secuencia de rediseño sugerida

1. Implementar primero el componente común de ayuda contextual/progressive disclosure.
2. Aplicarlo a Tools y eliminar repetición por fila; es la mayor reducción de ruido y altura.
3. Reorganizar Cockpit alrededor de “ahora / siguiente / atención”, dejando histórico e inventarios secundarios.
4. Dividir MSSR entre operación y auditoría/metodología, reduciendo texto permanente.
5. Reejecutar el harness con `1440x1000`, mismo umbral `0.86`, y comparar manifest/capturas contra este baseline.
6. Recién después ajustar detalles menores de Resumen, Actividad, Errores y favicon.

## Criterios de QA para la siguiente iteración

- Ninguna recomendación idéntica debería repetirse decenas de veces en Tools.
- Cockpit debería permitir decidir qué retomar desde el primer viewport sin leer metodología.
- MSSR debe conservar precisión sin convertir cada card en documentación permanente.
- Las definiciones técnicas deben tener una affordance de ayuda consistente y accesible.
- El número de capturas retenidas no es el objetivo; la evidencia debe representar estados visualmente distintos.
- No degradar observabilidad ni mover trabajo costoso al event loop del Bridge para resolver un problema de presentación.
