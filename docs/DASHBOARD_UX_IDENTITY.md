# MauroPrime Dashboard — Human UX Identity

Status: normative project UX contract
Last reviewed: 2026-09-29
Scope: Bridge/MSSR dashboard rendered by `src/dashboard/*`

## 1. Product identity

The MauroPrime dashboard is a **human control surface over observable system evidence**. It is not a telemetry dump, another database, or a replacement for MSSR, Git, Project Context, provider state, or Bridge runtime authority.

Its first responsibility is to let a person answer quickly:

1. **¿Qué está pasando?**
2. **¿Qué requiere mi atención?**
3. **¿Qué debería mirar o hacer después?**
4. **Si necesito comprobarlo, dónde está la evidencia completa?**

The dashboard should feel calm when the system is healthy and become more explicit only when evidence requires attention. Normality must visually recede; exceptions must become easier to find.

The visual identity is therefore **operational, quiet, layered, auditable and reversible**. Density is useful; undifferentiated density is not.

## 2. Relationship with `HUMAN_COCKPIT.md`

`docs/HUMAN_COCKPIT.md` owns the semantic/data contract for the human work projection: lifecycle meaning, task identity, freshness, owner boundaries, privacy and data flow.

This document owns the cross-dashboard **presentation and interaction contract**. It may decide how evidence is grouped, summarized, expanded, filtered or navigated, but it must never reinterpret or manufacture owner truth.

When the two documents appear to conflict:

- owner semantics and freshness rules from `HUMAN_COCKPIT.md` win;
- this document controls presentation only;
- the UI must expose uncertainty instead of hiding it with a visual simplification.

## 3. Primary reading contract

Every high-volume surface follows this hierarchy:

`Summary → Aggregate → Detail → Raw`

### Summary

A bounded first view that answers state and attention. Prefer 3–6 metrics or short state blocks. Summary must not require scrolling through raw rows to determine whether there is a problem.

### Aggregate

Repeated evidence becomes an accumulator. A group exposes at least the useful subset of:

`identity → count → health/error signal → latest observation → affected scope`

Examples:

- repeated tool calls grouped by tool/status/task;
- repeated notices grouped by notice code/source;
- repeated sessions grouped by stable profile/task identity;
- technical traces grouped beneath one human task.

### Detail

One explicit interaction reveals the explanation necessary to understand an aggregate or entity: descriptions, contract metadata, evidence statistics, recommendations and provenance.

### Raw

Forensic rows/events remain reachable when they are useful, but they are not the default reading layer. Raw evidence may be bounded by the owning backend contract; the UI must not imply that a bounded window is exhaustive history.

## 4. First-viewport contract

For a normal desktop viewport around `1440×1000`, the first viewport of a tab should prioritize:

- current state;
- exceptional/attention state;
- the next useful navigation or action;
- freshness/scope when it materially changes interpretation.

Historical, methodological and forensic material should not displace current orientation from the first viewport.

A short page is not a defect. Empty space is preferable to filler.

## 5. Progressive disclosure contract

Large or repeated detail is closed by default unless it represents current attention.

Preferred primitive: native `<details>/<summary>` when its semantics fit. An equivalent custom control is allowed only when it preserves:

- keyboard operation;
- visible focus;
- explicit expanded/collapsed state (`aria-expanded` when custom);
- a meaningful accessible label;
- no essential information hidden behind hover-only interaction.

The existing Errors tab is the reference implementation for native disclosure.

### Default-open policy

- attention groups may start open;
- healthy/normal bulk groups start closed;
- an active search/filter may open groups containing matches;
- individual entity detail normally starts closed;
- raw/forensic event lists start closed.

## 6. Repetition contract

If multiple visible rows repeat substantially the same explanation, action or normal recommendation, the repetition must be challenged.

Prefer:

- one group-level explanation;
- a badge/status token;
- a count plus drill-down;
- a shared legend;
- one common action for equivalent notices.

Do not print sentences such as a normal `maintain` recommendation hundreds of times when the status conveys the same information.

Provenance may remain per event in the Raw layer.

## 7. Inventory contract

Inventories that can grow beyond a few dozen entities use **compact master/detail**, not fully expanded prose per row.

A compact entity summary should normally expose:

- identity;
- one useful category/family;
- observed volume;
- error/health signal;
- current status.

Expansion may expose:

- full description;
- aliases/preferred replacement;
- lifecycle/risk/role metadata;
- detailed evidence statistics;
- error categories;
- recommendation and reason.

For very large collections, filters/search must appear before the inventory. If DOM size or interaction cost becomes material, pagination or virtualization is preferred to infinite visual scroll.

## 8. Attention hierarchy

UI tone is evidence-driven, not decorative.

### Healthy / normal

Visually quiet. Green/neutral may confirm health but should not compete with warnings.

### Informational / unknown / insufficient evidence

Clearly different from success. `Sin evidencia`, stale snapshots and unknown provider state must never look like verified health.

### Review / warning

Visible enough to find quickly, but not styled as failure unless owner semantics say failure.

### Error / blocking

Reserved for observable failure/blocking states. Do not promote WATCH/REVIEW or advisory MSSR notices into errors merely to attract attention.

Color is supplementary. Labels/text remain the semantic carrier.

## 9. Copy contract

Human-facing copy should be short, concrete and scoped.

Prefer:

- `18 llamadas · 0 errores · p95 42 ms`
- `14 avisos · último hace 3 min`
- `Sin evidencia · smoke test requerido antes de decidir`

Avoid repeating methodology inline in every card. Stable definitions belong in one of:

- concise contextual help;
- one group-level description;
- documentation linked from the diagnostic surface.

The dashboard may use technical names when they are the actual inspectable identity (`tool`, workflow, skill), but opaque trace IDs and transport metadata should not dominate human task titles.

## 10. Navigation contract

Top-level tabs answer different human questions. Deep tabs may have a local sticky sub-navigation or anchored group navigation.

Local navigation is warranted when a tab contains multiple diagnostic families or routinely exceeds several viewports. MSSR is the first planned proving case:

`Overview | Contexto/Health | Routing/Skills | Identidad/Host | Outcomes`

Navigation must not create a second semantic hierarchy. It only organizes existing evidence.

## 11. Aggregate vs Raw contract

When both operational and forensic inspection are valid, make the mode explicit:

`Agregado | Raw`

Default is `Agregado`.

Switching to Raw must not silently change the underlying scope/window. The same freshness/scope metadata applies unless the backend explicitly provides a different query contract.

## 12. Human task vs technical trace contract

Human work is the primary presentation identity when MSSR exposes a stable `taskKey` or the Cockpit has a documented fallback identity.

Technical traces remain provenance. They should normally appear as a subordinate count/disclosure such as:

`Trazas técnicas (N)`

A retry, routing probe, setup trace or maintenance trace should not visually masquerade as N independent human tasks.

This is a presentation rule only; grouping never closes, merges, rewrites or changes trace lifecycle authority.

## 13. Interaction state contract

Filtering, expansion and local navigation are browser-local UI state unless a separate persistence contract is explicitly created.

The first implementation should not add another database or project authority for UI preferences.

A refresh may reset disclosure state. If future evidence shows that preserving view state materially improves work, it must be implemented as bounded presentation state and never confused with system truth.

## 14. DOM contract for layered UX

New/refactored surfaces should annotate important hierarchy where practical:

- `data-ux-contract="human-v1"` on a migrated surface;
- `data-ux-layer="summary"` for first-look state;
- `data-ux-layer="aggregate"` for grouped evidence;
- `data-ux-layer="detail"` for entity/group expansion;
- `data-ux-layer="raw"` for forensic event rows/lists.

These attributes are **presentation/testing metadata**, not backend schema and not authority.

Stable element IDs used by dashboard scripts/tests remain compatibility contracts during incremental migration unless intentionally versioned.

## 15. Liveness and performance contract

Human UX improvements must preserve the existing Bridge liveness boundary:

`browser → /api/dashboard/snapshot → isolated dashboard worker → bounded projections`

Presentation changes should preferentially aggregate already-delivered snapshot data in the browser. Expanding a row must not trigger unbounded repository scans, provider fan-out, Git fetches or heavy synchronous HTTP-owner work.

If richer detail requires new backend data, it must remain bounded and isolated according to the existing dashboard worker contract.

## 16. Authority, privacy and safety contract

The dashboard is a projection. UI grouping must never:

- mark lifecycle phases complete;
- mutate MSSR routing or Project Context;
- stage/restore/delete/commit/push Git state;
- infer provider connectivity from registration alone;
- turn advisory notices into automatic actions;
- claim bounded cached evidence is complete current truth;
- add prompts, transcripts, secrets or private reasoning to dashboard persistence.

Grouping is lossless with respect to the data the UI already received: an aggregate may hide detail visually, but must not fabricate, rewrite or silently reclassify it.

## 17. QA contract

A migrated surface is not accepted merely because it looks shorter. The before/after review must verify:

1. total visual height is reduced where the old surface was deep;
2. repeated copy is reduced;
3. important detail remains reachable in no more than one deliberate expansion from its aggregate/entity summary;
4. forensic/raw evidence that existed before remains reachable within the same bounded data window;
5. keyboard/focus semantics work;
6. summary and attention states remain understandable without expansion;
7. no new runtime/network errors appear;
8. `npm run check` and `npm run build` pass;
9. the visual harness at `1440×1000` shows a real reduction in `deep-scroll` / repetition opportunities where applicable.

The visual harness keeps full evidence separate from its review queue. A smaller review queue is not proof of a better product unless the underlying screenshots confirm the improvement.

## 18. Migration order

The migration is incremental. Do not rewrite every tab at once.

### Slice H1 — Tools

Proving case for the full hierarchy:

- summary metrics stay visible;
- notices aggregate by `code + source`;
- portfolio groups tools by human attention class using existing audit status semantics;
- attention group open by default;
- `sin evidencia` and healthy bulk groups collapsed by default;
- each tool becomes a compact expandable entity;
- complete current description/evidence/recommendation remains in detail;
- raw notice events remain behind a Raw disclosure.

**H1 status (2026-09-29): implemented and visually gated.** The first production slice now uses the contract above in `src/dashboard/{markup,script,styles}.ts` without changing dashboard APIs or owner semantics. Baseline evidence `data/dashboard-visual-qa/2026-09-29T16-07-24-857Z/manifest.json` measured Tools at 24,857 px / 24.9 viewports, 180 row-like items, 0 disclosure affordances and repeated visible copy up to 76×. The Human UX gate `data/dashboard-visual-qa/2026-09-29T16-37-20-655Z/manifest.json` measures 2,286 px / 2.3 viewports, 0 raw row-like items at the default layer, 189 disclosure affordances and no repeated visible detail copy. The remaining Tools heuristic is contextual-help debt; it is not a blocker for H1.

The harness visibility probe was tightened during H1 so content retained inside closed `<details>` does not count as visible repeated copy. This keeps forensic DOM retention separate from the human default reading layer.

### Slice H2 — Activity

Introduce explicit `Agregado | Raw` for recent calls and interactive timeline buckets.

**H2 status (2026-09-29): implemented, interaction-gated and visually gated.** Activity now defaults to an aggregate projection of the same latest-20 call evidence, grouped by tool with calls/errors/average latency and one-step detail; `Raw` restores the original forensic rows without changing the backend query window. Timeline bars are native buttons that expose a bounded five-minute calls/errors/error-rate detail. Baseline `data/dashboard-visual-qa/2026-09-29T16-56-47-977Z/manifest.json` measured 1,740 px, 32 DOM row-like items and repeated visible technical copy up to 7×. Final visual evidence `data/dashboard-visual-qa/2026-09-29T17-11-59-301Z/manifest.json` measures 1,604 px, 12 visible row-like items, 0 visible tables, 11 disclosure affordances and no repeated visible detail copy; runtime/network errors remain zero. The remaining Activity heuristic is contextual-help debt.

The deterministic browser gate `scripts/test-dashboard-human-ux-browser.mjs` proves the interaction contract against a live dashboard projection. Final receipt `data/dashboard-visual-qa/activity-interaction-final/2026-09-29T17-11-57-508Z/receipt.json` observed 11 aggregate groups and 20 retained Raw rows, showed all 20 after one explicit Raw action, verified that the mode switch caused no snapshot refetch, and verified timeline-bucket detail. Harness `rowLikeCount` and `tableCount` now use visibly rendered nodes so hidden forensic evidence is not mislabeled as default human density.

### Slice H3 — Cockpit

Prioritize `Ahora / Siguiente / Atención` in the first viewport and group technical traces under human tasks.

**H3 status (2026-09-29): implemented, interaction-gated and visually gated.** The first Cockpit viewport now answers `Ahora / Siguiente / Atención` before exposing lifecycle mechanics. MSSR `taskKey`/legacy task identity remains the human work unit; linked technical traces are nested below each task and the global trace list moved behind an explicit forensic disclosure. `Deuda MSSR` and `Ayer` are secondary disclosures instead of sibling primary work panes. The backend/authority contract is unchanged: this remains a projection over MSSR + Bridge + Git.

Baseline `data/dashboard-visual-qa/2026-09-29T17-21-54-161Z/manifest.json` measured 5,626 px (5.6 viewports), 37 row-like items, 250 static explanation words and 0 disclosure affordances. Final visual evidence `data/dashboard-visual-qa/2026-09-29T18-55-59-241Z/manifest.json` measures 5,016 px, 209 static explanation words and 10 disclosure affordances with zero runtime/network failures. The main H3 gain is hierarchy rather than pure compression: the first viewport is now human-oriented while technical provenance stays reachable.

The browser gate `scripts/test-dashboard-human-ux-browser.mjs` now covers Cockpit as well as Activity. Receipt `data/dashboard-visual-qa/human-ux-interaction/2026-09-29T18-58-58-799Z/receipt.json` observed 2 human MSSR tasks with 2 nested evidence disclosures, 0 globally raw trace cards visible by default, 5 raw trace cards after one explicit disclosure, and no additional dashboard snapshot fetch caused by opening task/raw evidence. Remaining Cockpit debt is secondary: historical/capability tables still make the overall page long and contextual-help affordances are not yet standardized.

### Slice H4 — MSSR

Add local diagnostic navigation and collapse advanced methodology/tables behind family summaries.

**H4 status (2026-09-29): implemented, interaction-gated, desktop/mobile visually gated.** MSSR now keeps only the active-epoch quality summary and execution funnel in the default reading layer. A local diagnostic navigator exposes `Overview`, `Contexto y health`, `Routing y skills`, `Identidad y host` and `Outcomes`; the four diagnostic families are collapsed by default and each summary carries bounded live context (`context savings + health`, selected/loaded skills, observed identities/buckets, attributed outcomes/success). All previous cards, tables, IDs and explanatory evidence remain inside those families, so this is a projection change rather than an MSSR semantic/API change.

Baseline `data/dashboard-visual-qa/2026-09-29T19-05-43-444Z/manifest.json` measured 8,199 px (~8.2 desktop viewports), 120 visible row-like items, 11 visible tables, 406 visible explanatory words and 0 disclosure affordances. Final desktop evidence `data/dashboard-visual-qa/2026-09-29T19-19-19-706Z/manifest.json` measures 1,407 px, 0 visible detail tables/rows, 2 visible descriptions / 26 explanatory words and 4 family disclosures while retaining 17 descriptions / 406 words and 85 technical `title` values in the hidden diagnostic layer. Final mobile evidence `data/dashboard-visual-qa/2026-09-29T19-19-57-376Z/manifest.json` remains responsive at 390×844 with the same 4 disclosure families, no runtime/network failures and no heuristic QA opportunities.

The live browser gate receipt `data/dashboard-visual-qa/human-ux-interaction/2026-09-29T19-17-36-236Z/receipt.json` proves that all four MSSR families start closed, Overview exposes 0 detail tables, `Routing y skills` opens its 2 diagnostic tables from one local-navigation action, and opening a family does not trigger another dashboard snapshot. The harness was strengthened during H4 so visible-load metrics, headings, cards, landmarks and review counts ignore descendants of closed `<details>` while retained evidence is reported separately; collapsed diagnostic DOM is no longer mislabeled as default human density.

### Slice H5 — Summary / consistency pass

Apply shared copy, density, help and accessibility rules without over-compressing the already effective summary/system surfaces.

**H5 status (2026-09-29): implemented, interaction-gated, desktop/mobile visually gated.** `Resumen` and `Sistema` now declare the same `human-v1` presentation contract as the migrated H1–H4 surfaces. Stable technical definitions moved from long inline prose into native keyboard-accessible `details/summary` help affordances with visible focus; the current-state card explains session/runtime identity, the active-epoch summary explains scope and structured routing without implying quality, the tool summary distinguishes execution from outcome, and `Sistema → Observabilidad` defines epoch/baseline/contract/scope without changing owner semantics. On narrow viewports the selected top-level tab is automatically brought fully into the horizontal rail instead of remaining clipped off-screen.

`Resumen` keeps attention, timeline, current state, active-epoch metrics and top tools in the default reading layer, but moves the two forensic tables (`Últimas operaciones` and task/session/project attribution) behind one native Raw disclosure. Their existing IDs/data stay populated from the same dashboard snapshot; the disclosure summary reports the bounded retained evidence count. Baseline desktop evidence `data/dashboard-visual-qa/2026-09-29T19-28-24-942Z/manifest.json` measured Summary at 2,848 px, 44 visible row-like items, 2 visible tables, 70 visible explanation words, 59 technical `title` values and 0 contextual-help/disclosure affordances. Final desktop evidence `data/dashboard-visual-qa/2026-09-29T19-50-24-277Z/manifest.json` measures 1,564 px, 16 visible row-like items, 0 visible tables, 33 visible explanation words, 3 contextual-help affordances and 4 disclosures with no heuristic opportunities. Mobile Summary falls from 5,442 px in baseline `data/dashboard-visual-qa/2026-09-29T19-28-33-712Z/manifest.json` to 3,181 px in final `data/dashboard-visual-qa/2026-09-29T19-50-32-803Z/manifest.json`; `Sistema` intentionally remains a simple two-card diagnostic surface and gains one help affordance rather than artificial compression. Both final runs report zero runtime/network failures and zero heuristic audit opportunities.

The browser gate receipt `data/dashboard-visual-qa/human-ux-interaction-h5-final/2026-09-29T19-48-51-574Z/receipt.json` proves Summary starts with 0 forensic tables visible while retaining 8 recent-operation rows and 20 profile rows in DOM, then exposes both tables after one native disclosure with no snapshot refetch. Opening contextual help also causes no refetch. At 390×844, selecting `Sistema` exercised a genuinely overflowing tab rail (`556 px` content / `357 px` viewport), scrolled it to `199 px` and left the selected tab fully visible. During H5 the harness visibility predicate was corrected so the direct `<summary>` of a closed `<details>` counts as a visible affordance while descendants remain hidden; final help metrics therefore represent the human-visible control rather than retained hidden content.
## 19. Definition of done for Human UX v1

Human UX v1 is complete when the major dashboard surfaces consistently obey the layered reading contract, current work/attention is visible before forensic detail, and the user can still drill from a compact human summary to the same bounded evidence without leaving the dashboard or reconstructing context manually.

## 20. Human UX v1.1 — consistency and polish

**Status (2026-09-29): implemented, interaction-gated and visually gated at desktop/tablet/mobile.** The v1.1 pass does not introduce another reading architecture: it keeps `Summary → Aggregate → Detail → Raw` and applies the existing rules consistently across all seven top-level surfaces. `Tools`, `Actividad`, `Dónde estoy` and `Errores` now use the same native keyboard-accessible contextual-help pattern for stable technical definitions. `Errores` formally declares `data-ux-contract="human-v1"`; each compact error row is `detail` and its full message is retained as `raw`, with no grouping or backend-query change because the existing disclosure pattern was already the density reference for the rest of the dashboard.

Cockpit keeps the primary human path visible: `Ahora / Siguiente / Atención`, current/resumable work and the conservative project map remain in the default layer. Capabilities, seven-day history, 30-day history, forensic MSSR traces, related Git detail and maintenance/reference diagnostics are grouped under one closed `Contexto adicional` disclosure. Their existing IDs and populated DOM remain intact; opening the outer context or any inner disclosure is presentation-only browser state and does not refetch the dashboard snapshot. Persisting expansion/filter state across refreshes remains deliberately out of scope: current evidence did not justify adding another preference store or authority.

Final interaction evidence is `data/dashboard-visual-qa/human-ux-v1-1-interaction-secondary-final/2026-09-29T21-48-20-588Z/receipt.json`. It proves the outer Cockpit context starts closed with 0 secondary cards visible, exposes 6 retained context cards after one action, and causes no snapshot refetch; workspace detail and Raw trace evidence remain independently reachable without refetch. The same gate covers contextual help in Tools/Errors, `Agregado | Raw`, MSSR family disclosure, Summary forensic disclosure, and keyboard `ArrowRight` top-level tab navigation. At 390×844 the overflowing tab rail still scrolls the selected `Sistema` tab fully into view.

Final visual manifests are `data/dashboard-visual-qa/human-ux-v1-1-desktop-secondary-final/2026-09-29T21-48-35-198Z/manifest.json`, `data/dashboard-visual-qa/human-ux-v1-1-tablet-secondary-final/2026-09-29T21-48-42-099Z/manifest.json` and `data/dashboard-visual-qa/human-ux-v1-1-mobile-secondary-final/2026-09-29T21-48-51-627Z/manifest.json`. All three cover the seven tabs and report 0 heuristic audit opportunities, 0 runtime errors and 0 network failures. The mobile Cockpit default reading fell from 5,514 px (~6.5 viewports) to 3,182 px (~3.8 viewports); visible descriptions fell to 3 / 28 words while 8 / 79 words remain retained behind disclosures. No Bridge/MSSR semantic owner, query window, lifecycle state or backend API changed.


## 21. Human UX v2-A — intent shell + Inicio

**Status (2026-09-29): implemented, interaction-gated and desktop/mobile visually gated.** V2-A supersedes the default v1 shell without deleting its evidence surfaces. The default dashboard now uses `data-ux-contract="human-v2-a"` and primary navigation `Inicio / Trabajo / Salud / Explorar`; `Inicio` is the only fully migrated v2 surface in this slice. The complete seven-panel v1.1 dashboard remains reachable under one closed `Vista v1 · diagnóstico anterior` disclosure so regression evidence and forensic workflows stay available during staged migration.

The first reading flow is now system/work status → continue-now task → actionable attention → compact operational pulse → semantic recent changes. Raw PID/boot/epoch/snapshot metadata moved to the global Inspector dialog. Opening Inspector, switching V2 tabs, opening the retained v1 comparison, Activity Aggregate/Raw, MSSR families and v1 forensic disclosures remain presentation-only and do not cause an extra dashboard snapshot fetch.

V2-A attention uses explicit semantic contracts rather than percentage aesthetics: Bridge readiness/closing and metrics persistence failures are failure states; missing required skill loads use `satisfied / expected`; closure debt and Project Health REVIEW are review states. Activity/error-rate values are descriptive in V2-A and do not acquire health color from v1's legacy UI-only thresholds. Stronger RED/Golden-Signal semantics and percentile/window comparison belong to V2-C.

Final receipt `data/dashboard-visual-qa/human-ux-v2a-interaction-final3/2026-09-29T23-20-26-189Z/receipt.json` reports four V2 tabs, zero legacy panels visible by default, no Inspector refetch, keyboard navigation, and mobile shell+nav height 95 px at 390×844 with both status and continue-now content starting in the first viewport. Visual manifests `human-ux-v2a-desktop-final3/2026-09-29T23-20-33-958Z` and `human-ux-v2a-mobile-final3/2026-09-29T23-20-38-199Z` report 0 heuristic opportunities, 0 runtime errors and 0 network failures. The harness now accepts `--surface v2|legacy`; the retained legacy Summary smoke is green at `human-ux-v2a-legacy-smoke/2026-09-29T23-20-41-809Z`.


## 22. Human UX v2-B — Trabajo

**Status (2026-09-29): implemented, interaction-gated and desktop/mobile visually gated.** The default shell contract is now `human-v2-b`: `Inicio` keeps the V2-A decision-first reading, while `Trabajo` becomes the second fully migrated intent surface. Work continuity is no longer reconstructed from separate Cockpit/week/30-day cards; it is one page with current human work, explicit next gates, Project Map and semantic human activity. The complete v1.1 Cockpit remains available as retained diagnostic evidence during migration.

The global `Ahora / 24 h / 7 d / 30 d` selector changes only the Project Map and semantic timeline. Current work remains present regardless of historical range. `Ahora` preserves explicit workspace classification and defaults to `active + review-needed`; the historical windows never pretend to be current health—24 h/7 d rows are `observed`, 30 d rows are `historical`. Range/filter changes reuse the same bounded snapshot and do not trigger another dashboard request. Git is projected only when it can alter a next decision; exact dirty-tree and classification evidence stays in v1.

Final browser receipt `data/dashboard-visual-qa/human-ux-v2b-interaction-final/2026-09-29T23-53-06-851Z/receipt.json` proves current-map filtering, no-refetch range switching, 7-day observed semantics, 30-day historical semantics, semantic timeline/no raw tool-call rows, full v1 regression, and a mobile Work surface with the status, time selector and `Trabajo activo` beginning in the first viewport without horizontal overflow. Final visual manifests `data/dashboard-visual-qa/human-ux-v2b-work-desktop-final/2026-09-29T23-53-22-874Z/manifest.json` and `data/dashboard-visual-qa/human-ux-v2b-work-mobile-final/2026-09-29T23-53-35-342Z/manifest.json` report 0 heuristic opportunities, 0 runtime errors and 0 network failures.
