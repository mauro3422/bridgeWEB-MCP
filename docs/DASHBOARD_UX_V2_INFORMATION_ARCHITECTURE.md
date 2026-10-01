# Dashboard UX v2 — Information Architecture and Metric Semantics

Status: research/design specification. This document does **not** authorize frontend implementation, publication, restart, or changes to MSSR/Bridge authority.

## 1. Why v2 exists

Human UX v1/v1.1 improved density, responsive behavior, contextual help and progressive disclosure, but retained the original information architecture. The dashboard is still organized primarily around what Bridge/MSSR emits (tool calls, traces, registries, runtime metadata and observatory families), rather than around the questions a human needs answered.

The v2 goal is not to compress the existing dashboard further. It is to change the unit of presentation from **technical source** to **human decision**.

The dashboard must answer, in this order:

1. What is happening now?
2. What needs my attention?
3. What should I continue next?
4. What changed?
5. Is the system healthy?
6. If something is abnormal, why?
7. Where is the exact technical evidence?

Raw telemetry remains available, but it must stop defining the primary navigation and visual hierarchy.

## 2. Evidence from the current implementation

### 2.1 Navigation follows backend categories

Current top-level tabs are Summary, Cockpit/“Dónde estoy”, Activity, Tools, MSSR, Errors and System. This makes the user choose a data source before they know what question they are trying to answer.

### 2.2 Global chrome consumes too much attention

The top of every page repeats five large technical health cards: Bridge HTTP, MCP transport, SQLite metrics, MSSR and MCP connections. On 390×844 mobile these stack vertically and consume almost an entire viewport before the actual page content begins. Most of these values are stable system metadata, not the task the user came to perform.

### 2.3 Summary prioritizes telemetry over meaning

The first screen of Summary currently emphasizes a five-minute tool-call timeline, retained/active connections, PID, runtime boot, uptime, cumulative tool calls, aggregate errors, average duration and structured routing percentage. These are valid diagnostics, but they do not directly answer “what changed?”, “what should I do?” or “what is blocked?”.

### 2.4 MSSR presents unlike percentages as if they formed one quality ladder

The first MSSR screen places structured routing, route→load, required-load compliance, verification coverage, persistence coverage, outcome coverage, outcome success and acceptance into visually similar progress rows. They have different denominators and different semantics; some are compliance metrics, some are coverage, some are outcome quality. They must not look like one funnel unless the lifecycle contract guarantees a single denominator and strict stage order.

### 2.5 Attention semantics are currently encoded as UI thresholds

`src/dashboard/script.ts` decides attention using hardcoded percentage thresholds, including route→load coverage and outcome coverage. The progress renderer also assigns fixed `goodAt`/`warnAt` values to routing, verification, persistence and outcome metrics.

This creates a semantic problem: a metric can be painted red because it is below an arbitrary UI threshold even when the underlying state is not necessarily an incident. For example, outcome coverage can be low because work is still open; route→load coverage can be descriptive rather than a universal failure condition.

In v2, the frontend must not invent health meaning from a number.

### 2.6 Current aggregate latency is not a useful single service signal

The active snapshot currently contains heterogeneous calls: very fast reads and health checks coexist with deliberately long jobs (`work_once`, commands, snapshots). A single average duration across all tool calls is therefore difficult to interpret. The current active epoch also contains very long outliers, so average duration is especially vulnerable to distortion.

V2 should distinguish interactive latency from long-running job duration and use percentiles/trends rather than one global average.

## 3. External patterns used for the design

The design borrows principles, not visual clones, from established observability systems:

- Grafana dashboard guidance: a dashboard should answer a question or tell a story, progress from general to specific, reduce cognitive load, use meaningful color and directed drill-down rather than expose everything at once. https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/
- Google SRE: latency, traffic, errors and saturation are the four core operational signals when a small set is required. https://sre.google/sre-book/monitoring-distributed-systems/
- Datadog Query Value: current value + conditional meaning + optional time-series context + explicit change indicator against a previous period + contextual drill-down. https://docs.datadoghq.com/dashboards/widgets/query_value/
- Elastic APM service overview: alerts/SLO-like health appears before metadata; latency, throughput and failed rate are compared over time; errors are grouped by message with count and first/last occurrence; charts drill into underlying evidence. https://www.elastic.co/docs/solutions/observability/apm/service-overview
- Honeycomb BubbleUp: deep investigation begins from an unusual subset/outlier and compares it with a baseline, instead of exposing every dimension before there is a reason to investigate. https://docs.honeycomb.io/investigate/analyze/identify-outliers/

## 4. Target information architecture

### 4.1 Primary navigation

Replace the seven source-oriented top-level tabs with four human-intent destinations:

**Inicio** — What is happening, what requires attention, what should I continue, what changed, and a compact system pulse.

**Trabajo** — Active work, projects, blockers, next gates and semantic activity over time.

**Salud** — Operational health for Bridge and MSSR, trends, anomalies and actionable maintenance signals.

**Explorar** — Tools, skills, traces, projects, errors and historical evidence for intentional investigation.

**Inspector** is not a fifth content page. It is a global side drawer/modal opened from any item when exact IDs, raw calls, trace lifecycle, boot/PID, provenance or JSON are needed.

### 4.2 Secondary navigation

Health may contain scoped selectors such as `General | Bridge | MSSR | Project/Skill health` rather than a full top-level MSSR tab.

Explore may contain `Eventos | Errores | Traces | Tools & Skills | Proyectos`.

The selected global time range and project/scope filter should persist while moving between these destinations.

## 5. New shell

The shell must become much smaller.

Desktop target: one compact header line containing product/version, overall runtime state, current human-work state, time range, project/scope and Inspector entry.

Mobile target: title/status first, four primary navigation items immediately reachable, then content. The five current system cards must not stack above every page.

Stable subsystem metadata moves behind a compact “Sistema operativo” status or Inspector. If every subsystem is healthy, one green state is enough. Only a degraded subsystem should earn additional visual space.

Suggested semantic header example:

`MauroPrime · Sistema operativo · 2 trabajos activos · 7 cierres para revisar   [24 h] [Todos] [Inspector]`

The exact counts remain data-driven; this is a composition example, not a new authority.

## 6. Inicio — decision-first overview

The first viewport should be readable in seconds.

### 6.1 Status sentence

A short synthesized sentence, not a wall of cards. It should separate system health from work attention, for example:

`Bridge está operativo. Hay 2 trabajos activos y 7 tareas con cierre pendiente.`

Never merge “system unhealthy” and “human workflow debt” into one red/green score.

### 6.2 Continue now

The most relevant current task should be the primary object on the page: project/workflow, human summary, stage, next gate, last meaningful update and one `Continuar` action/drill-down.

### 6.3 Actionable attention

Only evidence with a defined action or contract enters this section: failed ready/health checks, transport failures, persistence drops/failures, required-load violations, explicit REVIEW findings, blockers and closure debt.

Descriptive coverage metrics do not become red alerts merely because a UI threshold says so.

### 6.4 Compact system pulse

Use a small row of metric-value cards for signals that benefit from immediate comparison. Each metric should have current value, time range, delta versus previous comparable range, a small sparkline when useful, unit and drill-down.

The system pulse should prefer operational symptoms over implementation metadata.

### 6.5 What changed

A semantic change feed should replace “latest raw tool calls” as the default activity model. Examples: task started/closed, verification passed/failed, restart/adoption, version change, project health changed, error spike, recovery, commit/push when observable.

Multiple low-level tool calls belonging to one human event should aggregate into one event.

## 7. Trabajo — continuity and projects

Work is the owner of `Dónde estoy`, `Al volver`, project state and human-scale activity.

### 7.1 Active work

Cards/rows should show:

- project/workflow name;
- one-line current intent;
- stage/status;
- next gate;
- blocker/attention if any;
- last meaningful change/time;
- Git state only when it changes the next decision.

### 7.2 Project map

Default to active/review projects. Historical or paused projects are filterable, not mixed equally with current work.

A project row should answer: `what is it doing?`, `what changed?`, `what blocks it?`, `what is next?`.

### 7.3 Semantic timeline

Timeline items should be human events rather than physical tool calls. A low-level call timeline remains available through Inspector/Explore.

The global time selector (`Ahora / 24 h / 7 d / 30 d`) replaces separate “this week” and “last 30 days” page sections.

## 8. Salud — operational truth without false alarms

Health combines Bridge runtime and MSSR integrity while keeping their semantics distinct.

### 8.1 Bridge operational signals

Adapt the SRE RED/Golden Signals model to Bridge:

**Traffic** — calls per minute / selected interval, not only cumulative calls since epoch.

**Errors** — rate + count, classified so expected validation/rejection is not automatically equal to infrastructure failure.

**Latency** — interactive p50/p95 (and optionally p99) with success/failure distinction where useful. Long-running jobs should have a separate duration view and must not distort interactive latency.

**Saturation/capacity** — queue occupancy, worker capacity, session pressure or dropped telemetry when those have meaningful limits.

**Availability/transport** — ready/health state, transport failures since baseline, restart marker and persistence failures/drops.

### 8.2 MSSR health groups

Do not show one pseudo-funnel. Group metrics by meaning:

**Routing integrity** — structured routing, required-load compliance, orphan load rate. Required compliance is contract-like; generic route→load coverage is descriptive unless a route required a load.

**Lifecycle state** — open work and closure debt first. Verification/persistence/outcome coverage must always show their denominator and whether open work is included.

**Outcome quality** — success and acceptance only with sample size and measurement coverage visible (`198/225`, `100/109`, etc.). Never present a percentage without its measured population.

**Context efficiency** — loaded vs full-estimated context, savings and fallback/full-load rate. This is an efficiency diagnostic, not a quality score.

Stable near-perfect metrics such as structured routing should collapse into a quiet healthy status and expand only on regression.

### 8.3 Project/skill health

Show actionable findings as a ranked list by severity/impact, deduplicated by owner and recommendation. Tables of every skill/project move to Explore.

## 9. Explorar and Inspector

### 9.1 Errors

Group errors by normalized signature/fingerprint. Default fields: short message, affected subsystem/tool, occurrence count, first seen, last seen, trend/change and current state. Expand for concrete occurrences and raw text.

### 9.2 Traces

Trace rows should show project/workflow, human summary, stage, duration/age, verification, persistence/outcome and explicit anomalies. IDs are secondary.

### 9.3 Tools & Skills

The existing Tool Portfolio becomes an intentional inventory/explorer. Its useful registry/audit data remains, but “180 registered tools” is not a daily-home KPI.

### 9.4 Inspector

Any card, event, warning or metric can open Inspector with exact evidence: source authority, trace IDs, runtime boot, PID, timestamps, denominators, underlying calls, raw JSON and links to related evidence.

This is where System metadata, raw call tables, identity buckets, reasoning-effort comparison, selected-vs-loaded skills and other forensic material belongs.

## 10. Metric contract

Every v2 metric should be rendered from a semantic descriptor rather than ad-hoc frontend thresholds. Recommended fields:

```text
id
label
value
unit
denominator / sampleSize
timeRange
comparisonRange
deltaAbsolute
deltaRelative or deltaPercentagePoints
direction = higher-better | lower-better | neutral
target/warn/critical = optional, contract-defined only
status = neutral | ok | watch | review | critical
sparkline/trend = optional
sourceAuthority
interpretation
nextAction/drilldown
```

Rules:

- A percentage delta should normally use percentage points when comparing rates (`2.2% → 2.8% = +0.6 pp`).
- No red/green without a documented target, invariant or explicit health projection.
- Cumulative totals belong in historical/inspector views unless the total itself changes a decision.
- Average alone is insufficient for latency with skewed distributions; prefer percentiles and distribution-aware diagnostics.
- Always display sample/denominator for success, acceptance and coverage rates.
- Compare current values to the immediately previous equivalent window where meaningful.
- Do not invent a single “MSSR score” or “system score”; preserve independent dimensions so one good metric cannot hide another failure.

## 11. Visualization grammar

Use one chart type for one question:

| Question | Preferred visualization |
| --- | --- |
| What is the value now and did it change? | query-value card + delta + sparkline |
| Is a signal improving or degrading over time? | time series with previous-period comparison |
| What changed at this moment? | semantic event markers on timeline |
| Which tools/errors/projects dominate? | sorted horizontal bars / ranked list |
| Which error family is recurring? | grouped error list with count + first/last + trend |
| Are we near a hard capacity? | compact utilization bar/gauge only with a real limit |
| Which stage has contract compliance? | individual compliance card/bar with explicit denominator |
| Why is an outlier different? | investigation heatmap/subset-vs-baseline, not home dashboard |
| What is the exact evidence? | Inspector/raw table/JSON |

Avoid pie charts for routine comparison, giant tables on primary pages, decorative gauges without thresholds, and visually identical progress bars for metrics with unrelated denominators.

## 12. Visual composition

The current dark palette can remain, but the page needs stronger hierarchy and less chrome.

Use three surface levels at most: page, primary section, secondary/inspectable item. Avoid a border around every nested piece of information.

Primary content should be visually larger by **space and position**, not by adding more boxes. Use section headings and whitespace to separate topics.

Reserve strong red/amber for actionability. Healthy/stable information should be quiet. Neutral informational data should not compete with problems.

Desktop should favor a 12-column layout with one main story column and a narrower attention/context column where appropriate. Mobile should preserve semantic order rather than merely stack every desktop card.

Mobile first viewport target: product/status + primary nav + current task/attention. Stable subsystem metadata must not consume the initial viewport.

## 13. Data-model changes needed before visual implementation

Most required raw data already exists in `/api/dashboard/snapshot`, the metrics store and MSSR observatory, but v2 needs a semantic projection layer.

Create a versioned dashboard view model (for example `dashboard-v2`) that derives:

- human work summary and next gates;
- actionable attention with explicit reason/owner/action;
- comparable time-window metrics and deltas;
- semantic event groups/change markers;
- grouped error signatures;
- interactive latency percentiles separated from long-running jobs;
- normalized health descriptors with target metadata;
- drill-down references to raw evidence.

The frontend should render this model and stop embedding product semantics such as arbitrary health thresholds inside `script.ts`.

Keep the existing snapshot/raw structures as evidence sources during migration; v2 is a read-only projection and must not become a new MSSR authority.

## 14. Safe implementation sequence

### V2-A — shell + Inicio prototype

Build the new compact shell and a decision-first Inicio while leaving v1 available behind a temporary switch. Prove desktop/mobile first viewport, metric semantics and no-regression/no-refetch behavior before touching the rest.

**V2-A status (2026-09-29): implemented and verified locally.** The dashboard now opens on a compact `human-v2-a` shell with intent navigation `Inicio / Trabajo / Salud / Explorar`; only `Inicio` is fully migrated in this slice. The previous seven-panel Human UX v1.1 dashboard remains intact inside the closed `Vista v1 · diagnóstico anterior` comparison disclosure. The Inspector is a global dialog/drawer and reads exact technical evidence from the same bounded dashboard snapshot without refetching it.

`Inicio` projects current system/work state, a single continue-now task, contract-backed attention, a four-signal pulse and semantic recent changes. Attention no longer reuses v1's arbitrary presentation thresholds: it promotes explicit readiness/persistence failures, missing **required** skill loads with their denominator, human closure debt and Project Health REVIEW evidence. Descriptive error/activity rates remain neutral until V2-C supplies the stronger health model.

Final interaction receipt: `data/dashboard-visual-qa/human-ux-v2a-interaction-final3/2026-09-29T23-20-26-189Z/receipt.json`. It proves four intent tabs, v1 closed by default with zero legacy panels visible, Inspector no-refetch, keyboard V2 navigation, and a 390×844 mobile chrome of 95 px (52 px header + 43 px navigation) with both human status and the continue-now surface starting in the first viewport. Final visual manifests are `data/dashboard-visual-qa/human-ux-v2a-desktop-final3/2026-09-29T23-20-33-958Z/manifest.json` and `data/dashboard-visual-qa/human-ux-v2a-mobile-final3/2026-09-29T23-20-38-199Z/manifest.json`; both report zero heuristic opportunities, runtime errors and network failures. The retained-v1 harness smoke `data/dashboard-visual-qa/human-ux-v2a-legacy-smoke/2026-09-29T23-20-41-809Z/manifest.json` is also green.

### V2-B — Trabajo

Move continuity, active work, projects and semantic activity into the new Work model. Replace separate 7d/30d cards with global time range.

**V2-B status (2026-09-29): implemented and verified locally.** `Trabajo` is now the second fully migrated V2 surface and the shell contract is `human-v2-b`. It projects current human work, next gate, bounded attention, a project map and semantic human activity from the existing dashboard snapshot; no backend endpoint, lifecycle owner, Project Health meaning or historical query authority changed.

The global range selector `Ahora / 24 h / 7 d / 30 d` is presentation-only and never refetches the dashboard snapshot. `Ahora` preserves explicit workspace classification and defaults the Project Map to `active + review-needed`; `24 h` and `7 d` use retained evidence labelled `observed`; `30 d` uses retained daily/project snapshots labelled `historical`. Current-work cards remain current while the project/timeline range changes, so browsing history cannot hide the work that can be resumed now. Git appears only when it can change the next decision (diverged/behind, or bounded dirty context on the current project map); full Git and classification evidence remains in retained v1.

Final interaction receipt: `data/dashboard-visual-qa/human-ux-v2b-interaction-final/2026-09-29T23-53-06-851Z/receipt.json`. It proves current Project Map semantics, `Todos` expansion, `7 d = observed`, `30 d = historical`, semantic timeline/no raw tool-call rows, client-side range/filter switching with no extra snapshot request, full v1 regression, and mobile Trabajo without horizontal overflow. Final visual manifests are `data/dashboard-visual-qa/human-ux-v2b-work-desktop-final/2026-09-29T23-53-22-874Z/manifest.json` and `data/dashboard-visual-qa/human-ux-v2b-work-mobile-final/2026-09-29T23-53-35-342Z/manifest.json`; both report zero heuristic opportunities, runtime errors and network failures.

### V2-C — Salud

Introduce Bridge RED/Golden-Signal trends, MSSR semantic groups and contract-driven health meaning. Remove the pseudo-funnel and arbitrary frontend thresholds.

### V2-D — Explorar + Inspector

Move tools, grouped errors, traces, system metadata and raw technical evidence into intentional investigation surfaces.

### V2-E — remove v1 duplication

Only after A/B visual and interaction QA proves v2 answers the core questions faster should duplicate v1 panels/routes be removed.

## 15. Acceptance criteria for the redesign

V2 is successful only if all of the following are observable:

- A user can identify system health, active work, next action and actionable attention from the first desktop viewport.
- Mobile reaches current work/attention without first scrolling through subsystem metadata.
- Primary navigation is based on intent, not source tables.
- No health color comes from an undocumented UI-only threshold.
- Rates show denominator/sample and time window.
- Important metric cards show comparison/delta when a comparable previous window exists.
- Errors are grouped and prioritized before raw instances.
- Raw IDs, PIDs, boot IDs, physical call lists and forensic tables remain reachable but are absent from the primary reading flow.
- A chart or metric can drill to its evidence without losing scope/time context.
- The dashboard can explain a degradation from symptom → likely dimension → raw evidence.
- Existing Bridge/MSSR authority boundaries remain unchanged.

## 16. Design decision

Do not continue Human UX v1.x by adding more disclosures. The next frontend work should be treated as a **new information architecture (UX v2)**. The first implementation gate is the shell + Inicio prototype, because that is the smallest slice capable of proving whether the strategic model is actually easier to understand before migrating the rest of the dashboard.
