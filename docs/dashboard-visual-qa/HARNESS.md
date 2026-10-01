# Dashboard Visual QA Harness

## Objetivo

`Bridge/MSSR Dashboard Visual QA Harness` recorre el dashboard local de Bridge/MSSR de forma automática, captura evidencia visual por pestaña y scroll, elimina vistas redundantes y deja un paquete reproducible para revisión visual + revisión de código.

El harness está en:

- `scripts/dashboard-visual-harness.mjs`

No modifica el dashboard ni dispara acciones de producto. Usa una instancia separada de Chrome en modo `--headless=new`, con perfil temporal y `windowsHide=true`, por lo que no abre una ventana de escritorio ni roba foco al usuario.

## Ejecución

Desde `D:\Dev\bridge-mcp`:

```bat
node scripts\dashboard-visual-harness.mjs --url http://127.0.0.1:3001/dashboard --viewport 1440x1000 --similarity 0.86 --max-per-tab 24
```

Opciones principales:

- `--url`: URL del dashboard.
- `--out`: raíz de evidencia; por defecto `data/dashboard-visual-qa`.
- `--viewport WxH`: viewport de captura.
- `--tabs summary,cockpit,...`: limita pestañas dentro de la superficie elegida.
- `--surface legacy|v2`: selecciona la navegación retenida v1 (`[data-tab]`, default) o la nueva navegación humana v2 (`[data-v2-tab]`). En modo `legacy` el harness abre explícitamente `Vista v1 · diagnóstico anterior`; en modo `v2` la deja cerrada.
- `--similarity 0..1`: umbral para descartar vistas cercanas.
- `--settle-ms`: espera después de tab/scroll.
- `--max-per-tab`: máximo de posiciones candidatas por pestaña.
- `--chrome`: Chrome/Chromium explícito si no se detecta automáticamente.

## Algoritmo de captura

1. Abre Chrome headless por CDP, sin Playwright/Puppeteer ni dependencias nuevas.
2. Descubre dinámicamente todos los elementos `[data-tab]`; no mantiene una lista hardcodeada de páginas.
3. Para cada tab calcula posiciones candidatas a partir de:
   - inicio y final de la página;
   - landmarks de `article`, tablas y timeline;
   - una grilla regular de scroll.
4. En cada candidato obtiene una firma de contenido visible:
   - tokens normalizados;
   - bloques visibles;
   - geometría cuantizada.
5. Compara la firma con vistas ya retenidas mediante Jaccard. Si supera `--similarity`, la candidata queda registrada como `near-duplicate-signature` y no genera otro PNG.
6. Las capturas restantes se validan además por SHA-256 del PNG para detectar duplicados exactos.
7. Se conservan siempre el primer y último estado de cada tab para no perder extremos por deduplicación.

La deduplicación busca el mismo objetivo que los harness de fotogramas: revisar estados visualmente distintos en vez de llenar evidencia con imágenes casi idénticas.

## Evidencia generada

Cada ejecución crea `data/dashboard-visual-qa/<run-id>/` con:

- `screens/*.png`: capturas de viewport retenidas.
- `manifest.json`: evidencia estructurada, hashes, posiciones, fingerprints, errores y métricas de densidad.
- `manifest.md`: resumen legible por tab.
- `contact-sheet.html`: índice visual de las capturas.

El manifest registra además:

- capturas retenidas y candidatas descartadas;
- altura total por tab;
- cantidad de descripciones y palabras explicativas;
- textos largos repetidos tres o más veces;
- `title` nativos versus affordances de ayuda contextual (`data-tooltip`, `aria-describedby`, `.help-icon`, `.info-button`);
- errores JavaScript/log con URL y línea cuando Chrome la expone;
- fallos de red observados.

La evidencia vive bajo `data/` y no debe convertirse en fuente de autoridad del producto. Sirve para QA y comparación entre iteraciones.

## Baseline verificado

Run verificado el 2026-09-29:

- `data/dashboard-visual-qa/2026-09-29T15-23-12-444Z/manifest.json`
- 7 tabs descubiertas: `summary`, `cockpit`, `activity`, `tools`, `mssr`, `errors`, `system`.
- 61 capturas retenidas.
- 26 candidatas cercanas descartadas.
- 0 fallos de red.
- 1 error de recurso: `GET /favicon.ico -> 404`; no afecta la funcionalidad del dashboard.
- `node --check scripts/dashboard-visual-harness.mjs`: PASS.

## Uso recomendado para QA

Para una revisión de UI:

1. ejecutar el harness contra el dashboard vivo;
2. abrir `contact-sheet.html` o inspeccionar `screens/` por grupos;
3. usar `manifest.json` para detectar densidad, repetición y ausencia de ayuda contextual;
4. contrastar los hallazgos visuales con `src/dashboard/markup.ts`, `script.ts` y `styles.ts`;
5. realizar cambios de UI sólo después de fijar una hipótesis concreta;
6. repetir el harness con el mismo viewport/threshold y comparar evidencia.

Para regresiones, conservar el manifest de referencia y comparar métricas/capturas del nuevo run. No usar sólo conteos DOM: una vista puede conservar el mismo número de cards y aun degradar jerarquía, legibilidad o densidad.


## Audit assistant v2 — 2026-09-29

El harness ya no trata todas las capturas retenidas como una cola de revisión humana. Separa:

- **evidencia completa**: todas las vistas suficientemente distintas conservadas bajo `screens/`;
- **review queue**: subconjunto representativo elegido para inspección visual;
- **audit opportunities**: señales deterministas que apuntan a superficies que merecen revisión, sin decidir automáticamente que exista un bug de UX.

La firma por frame incorpora sección dominante, headings visibles, rows/cards/tables/buttons/links visibles, textos repetidos y delta de tokens respecto de la vista retenida anterior. La review queue pondera inicio/final, cambios de sección, novedad, densidad y repetición, y limita normalmente a dos representantes por sección. `--review-per-tab` es un máximo, no una cuota: una pestaña simple puede aportar menos vistas.

Además de `manifest.json`, `manifest.md`, `contact-sheet.html` y `screens/`, cada run genera:

- `review-queue.json`: cola representativa estructurada;
- `review-queue.md`: checklist frame-by-frame con razón de selección y espacio para notas de QA.

`contact-sheet.html` presenta primero la review queue con navegación sticky por tab. La evidencia completa queda colapsada por pestaña para evitar que el propio informe replique el problema de scroll infinito que audita.

Las heurísticas actuales incluyen `repeated-row-copy`, `large-row-set`, `deep-scroll`, `static-explanation-load`, `contextual-help-gap`, `progressive-disclosure-gap` y `table-fragmentation`. Son evidencia de atención, no autoridad de rediseño.

### Gate final v2

Run verificado:

- `data/dashboard-visual-qa/2026-09-29T16-07-24-857Z/manifest.json`
- 7 tabs descubiertas.
- 60 screenshots únicas retenidas.
- 30 vistas en review queue.
- 27 near-duplicates descartadas.
- 21 oportunidades heurísticas.
- 0 fallos de red.
- 1 recurso 404 de `favicon.ico`, sin impacto funcional.
- `node --check scripts/dashboard-visual-harness.mjs`: PASS.

La auditoría visual detallada derivada del harness está en `docs/dashboard-visual-qa/AUDIT_V2.md`.


### Visibility semantics after Human UX H1

The repeated-copy probe now counts only text that is actually in the active layout and is not contained by a closed `<details>`. Collapsed detail remains in the DOM for forensic recovery but must not be scored as visible copy. This distinction became necessary once Tools adopted the `Summary → Aggregate → Detail → Raw` contract.

Focused H1 verification: `data/dashboard-visual-qa/2026-09-29T16-37-20-655Z/manifest.json` reports Tools at 2,286 px, 189 disclosure affordances, zero repeated visible detail strings, zero runtime/network failures, and only the independent contextual-help heuristic remaining.


### Human UX H2 — Activity

H2 adds `scripts/test-dashboard-human-ux-browser.mjs` as a deterministic headless interaction gate for the Activity projection. It verifies `Agregado → Raw → Agregado`, retained Raw evidence, absence of an extra dashboard snapshot fetch on mode switch, and timeline-bucket inspection. The visual harness now computes `rowLikeCount` and `tableCount` from visibly rendered nodes, matching the existing visible-copy rule so hidden forensic layers do not inflate default-density metrics.

Final H2 evidence: `data/dashboard-visual-qa/2026-09-29T17-11-59-301Z/manifest.json` and `data/dashboard-visual-qa/activity-interaction-final/2026-09-29T17-11-57-508Z/receipt.json`.

### Human UX H4 — visible load vs retained evidence

H4 generalizes the visibility rule beyond repeated copy. The harness now treats descendants of closed `<details>` and `[hidden]` containers as **retained evidence**, not as default human load. `descriptionCount` / `descriptionWords`, technical `title` counts, cards, tables, row-like items, headings, layout landmarks and per-frame visible counts all follow that visible-layout rule. When useful for audit integrity, the manifest also keeps retained counterparts such as `retainedDescriptionCount`, `retainedDescriptionWords` and `retainedNativeTooltipCount` so a compact default projection cannot hide the fact that diagnostic evidence still exists in the DOM.

Closed `<details>` remain counted as disclosure affordances through their visible `<summary>` controls. This is intentionally different from their hidden descendants: the control itself is part of the human surface, while the collapsed evidence is not. Signature generation, dominant-section detection and review-queue selection use the same boundary, preventing collapsed diagnostic tables from creating fake section changes, density warnings or extra review frames.

Final H4 MSSR evidence demonstrates the contract: `data/dashboard-visual-qa/2026-09-29T19-19-19-706Z/manifest.json` reports 2 visible descriptions / 26 words, 0 visible tables/rows, 4 visible family disclosures, while retaining 17 descriptions / 406 words and 85 technical `title` values. Mobile evidence is `data/dashboard-visual-qa/2026-09-29T19-19-57-376Z/manifest.json`; both runs have zero runtime/network failures and zero heuristic QA opportunities.

### Human UX v1.1 — cross-viewport closeout

The v1.1 closeout adds a full three-viewport gate over all seven tabs after contextual-help normalization and the Cockpit secondary-context pass. Final manifests:

- desktop 1440×1000: `data/dashboard-visual-qa/human-ux-v1-1-desktop-secondary-final/2026-09-29T21-48-35-198Z/manifest.json`;
- tablet 820×1180: `data/dashboard-visual-qa/human-ux-v1-1-tablet-secondary-final/2026-09-29T21-48-42-099Z/manifest.json`;
- mobile 390×844: `data/dashboard-visual-qa/human-ux-v1-1-mobile-secondary-final/2026-09-29T21-48-51-627Z/manifest.json`.

All three runs report `auditOpportunities=0`, zero runtime errors and zero network failures. On mobile, Cockpit dropped from 5,514 px in the pre-grouping v1.1 run to 3,182 px after capabilities/history/raw/Git/maintenance moved behind the closed `Contexto adicional` disclosure. The harness continues to count the visible outer `<summary>` as human load while treating every retained descendant as hidden until explicitly opened.
