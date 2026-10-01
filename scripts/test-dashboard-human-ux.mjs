import assert from "node:assert/strict";
import { renderDashboardHtml } from "../dist/dashboard.js";

const html = renderDashboardHtml();

assert.match(html, /data-ux-contract="human-v1"/, "Tools must declare the human UX contract");
assert.match(html, /id="tools-portfolio-body" class="portfolio-list" data-ux-layer="aggregate"/, "Tool inventory must expose the aggregate layer");
assert.doesNotMatch(html, /class="portfolio-table"/, "Tool inventory must not regress to the fully expanded table");
assert.match(html, /function toolPortfolioGroup\(item\)/, "Tool attention grouping logic must ship in the dashboard script");
assert.match(html, /class="portfolio-group"/, "Tool groups must use progressive disclosure");
assert.match(html, /class="portfolio-item"/, "Individual tools must use detail disclosure");
assert.match(html, /data-ux-layer="detail"/, "Dashboard must expose detail-layer metadata");
assert.match(html, /function groupToolNotices\(items\)/, "Repeated notices must be accumulated before rendering");
assert.match(html, /class="notice-group"/, "Notice groups must be progressively disclosed");
assert.match(html, /data-ux-layer="raw"/, "Forensic notice evidence must remain reachable as a raw layer");
assert.match(html, /Eventos raw \(/, "Raw notice events must remain explicitly reachable");
assert.match(html, /Requiere atención/, "Attention-first tool group must be present");
assert.match(html, /Sano con evidencia/, "Healthy tool bulk must be represented as a group");
assert.match(html, /Sin evidencia/, "Unknown/no-evidence state must remain distinct from health");
assert.match(html, /:focus-visible/, "Disclosure controls must retain visible keyboard focus styling");

assert.match(html, /id="panel-activity"[^>]*data-ux-contract="human-v1"/, "Activity must declare the human UX contract");
assert.match(html, /data-activity-mode="aggregate"[^>]*aria-pressed="true"/, "Activity must default recent calls to aggregate mode");
assert.match(html, /data-activity-mode="raw"[^>]*aria-pressed="false"/, "Activity must expose explicit Raw mode");
assert.match(html, /id="activity-recent-aggregate"[^>]*data-ux-layer="aggregate"/, "Activity aggregate layer must be explicit");
assert.match(html, /id="activity-recent-raw"[^>]*data-ux-layer="raw"[^>]*hidden/, "Activity Raw layer must stay reachable but hidden by default");
assert.match(html, /function aggregateActivityCalls\(inputRows\)/, "Recent Activity rows must be accumulated client-side without changing backend scope");
assert.match(html, /data-activity-bucket=/, "Activity timeline must render inspectable buckets");
assert.match(html, /function setupActivityControls\(\)/, "Activity mode and timeline interactions must be wired");
assert.match(html, /activity-timeline-detail/, "Timeline bucket detail must remain one interaction away");

assert.match(html, /id="panel-cockpit"[^>]*data-ux-contract="human-v1"/, "Cockpit must declare the human UX contract");
assert.match(html, /data-orientation="now"[^>]*>\s*<span>Ahora<\/span>/, "Cockpit must expose Ahora in the primary orientation layer");
assert.match(html, /data-orientation="next"[^>]*>\s*<span>Siguiente<\/span>/, "Cockpit must expose Siguiente in the primary orientation layer");
assert.match(html, /data-orientation="attention"[^>]*>\s*<span>Atención<\/span>/, "Cockpit must expose Atención in the primary orientation layer");
assert.match(html, /class="cockpit-technical-disclosure" data-ux-layer="raw"/, "Cockpit raw technical traces must remain behind explicit forensic disclosure");
assert.match(html, /function groupCockpitTracesByTask\(tasks, traces\)/, "Cockpit must group technical traces under human MSSR tasks");
assert.match(html, /class="cockpit-human-task"/, "Cockpit human task projection must use progressive disclosure");
assert.match(html, /class="cockpit-task-evidence" data-ux-layer="detail"/, "Technical task evidence must stay one nested interaction away");
assert.match(html, /id="cockpit-secondary-context"[^>]*class="cockpit-secondary-stack span-12"[^>]*data-ux-layer="detail"/, "Cockpit secondary context must be grouped behind one explicit disclosure");
assert.doesNotMatch(html, /id="cockpit-secondary-context"[^>]*\sopen(?:\s|>)/, "Cockpit secondary context must be collapsed by default");
for (const id of ['cockpit-workspace-detail', 'cockpit-capabilities-detail', 'cockpit-weekly-detail', 'cockpit-history-detail', 'cockpit-git-detail']) {
  assert.match(html, new RegExp(`id="${id}"[^>]*class="cockpit-secondary-disclosure"[^>]*data-ux-layer="detail"`), `${id} must keep secondary Cockpit evidence collapsed behind detail disclosure`);
}
assert.doesNotMatch(html, /id="cockpit-(?:workspace|capabilities|weekly|history|git)-detail"[^>]*\sopen(?:\s|>)/, "Cockpit secondary detail must be collapsed by default");
assert.ok((html.match(/id="panel-cockpit"[\s\S]*?class="context-help"/g) || []).length >= 1, "Cockpit must expose contextual help for projection semantics");
assert.match(html, /id="panel-mssr"[^>]*data-ux-contract="human-v1"/, "MSSR must declare the human UX contract");
assert.match(html, /data-mssr-nav="overview"[^>]*aria-current="true"/, "MSSR must default local navigation to Overview");
assert.match(html, /data-mssr-nav="context"/, "MSSR must expose Contexto y health navigation");
assert.match(html, /data-mssr-nav="routing"/, "MSSR must expose Routing y skills navigation");
assert.match(html, /data-mssr-nav="identity"/, "MSSR must expose Identidad y host navigation");
assert.match(html, /data-mssr-nav="outcomes"/, "MSSR must expose Outcomes navigation");
assert.match(html, /function setupMssrControls\(\)/, "MSSR families must be grouped client-side without backend changes");
assert.match(html, /className = 'mssr-family-group'/, "MSSR diagnostic families must use progressive disclosure");
assert.match(html, /details\.dataset\.uxLayer = 'detail'/, "MSSR family groups must expose the detail UX layer");
assert.match(html, /function syncMssrFamilySummaries\(mssr\)/, "MSSR family summaries must remain data-driven");
assert.match(html, /data-ux-contract="human-v2-b"/, "V2-B shell must declare the human-v2-b contract");
assert.equal((html.match(/data-v2-tab="(?:home|work|health|explore)"/g) || []).length, 4, "V2-B primary navigation must expose exactly four human-intent tabs");
for (const id of ['panel-home-v2', 'panel-work-v2', 'panel-health-v2', 'panel-explore-v2']) {
  assert.match(html, new RegExp(`id="${id}"[^>]*data-ux-contract="human-v2-b"`), `${id} must participate in the V2-B shell contract`);
}
for (const id of ['home-status-sentence', 'home-continue-title', 'home-attention-list', 'home-pulse-activity', 'home-pulse-errors', 'home-pulse-sessions', 'home-pulse-persistence', 'home-changes']) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} must preserve the V2-A Inicio surface inside V2-B`);
}
for (const id of ['work-status-sentence', 'work-active-list', 'work-project-list', 'work-timeline', 'work-range-note']) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} must exist on the V2-B Trabajo surface`);
}
assert.equal((html.match(/data-work-range="(?:now|24h|7d|30d)"/g) || []).length, 4, "V2-B Trabajo must expose one global Now/24h/7d/30d selector");
assert.match(html, /data-work-project-filter="current"[^>]*aria-pressed="true"/, "V2-B Project Map must default to active/review projects");
assert.match(html, /function updateWork\(snapshot\)/, "V2-B Trabajo must render from the bounded dashboard snapshot");
assert.match(html, /function workProjectsForRange\(cockpit, range\)/, "V2-B must project current and historical project maps client-side");
assert.match(html, /function workSemanticEvents\(cockpit, range\)/, "V2-B must render semantic human activity instead of raw tool calls");
assert.match(html, /function setupWorkControls\(\)/, "V2-B range and project filters must be wired without a backend scope change");
assert.match(html, /workRange !== 'now'/, "V2-B active/review project filter must not masquerade as historical classification");
assert.match(html, /data-open-v2-tab="work"/, "Inicio must link directly to the V2-B Trabajo surface");
assert.match(html, /id="legacy-dashboard"[^>]*class="legacy-dashboard"[^>]*data-legacy-dashboard/, "V1 must remain reachable as an explicit comparison disclosure");
assert.doesNotMatch(html, /id="legacy-dashboard"[^>]*\sopen(?:\s|>)/, "Legacy V1 comparison must stay collapsed by default");
assert.match(html, /id="v2-inspector"[^>]*class="v2-inspector"/, "V2-B must preserve the technical Inspector drawer");
assert.match(html, /function updateHome\(snapshot\)/, "V2-B must preserve Inicio rendering from the bounded dashboard snapshot");
assert.doesNotMatch(html, /replace\(\/s\+\/g/, "Workflow-key humanization must not regress to a cooked literal /s+/ regex");
assert.match(html, /function renderHomeAttention\(snapshot\)/, "V2-B must preserve explicit Inicio attention semantics");
assert.match(html, /requiredSkillLoadsExpected/, "Required-load attention must use the explicit required denominator");
assert.match(html, /const requiredMissing = Math\.max\(0, requiredExpected - requiredSatisfied\)/, "Required-load debt must derive from the contract, not a presentation threshold");
assert.match(html, /function renderHomePulse\(snapshot\)/, "V2-B must preserve the compact system pulse");
assert.match(html, /function renderHomeChanges\(cockpit, status\)/, "V2-B must preserve semantic recent changes instead of raw tool calls");
assert.match(html, /function setupV2Tabs\(\)/, "V2-B human-intent navigation must remain wired");
assert.match(html, /function setupLegacyControls\(\)/, "V2-B must preserve one-action access to V1 evidence");
assert.match(html, /function setupInspector\(\)/, "V2-B Inspector interactions must remain wired");
assert.match(html, /\.topbar\.topbar-v2/, "V2-B mobile shell must explicitly override the legacy stacked topbar");
assert.match(html, /\.work-secondary-grid/, "V2-B must ship dedicated responsive Work layout styles");

assert.match(html, /id="panel-summary"[^>]*data-ux-contract="human-v1"/, "Summary must declare the human UX contract");
assert.match(html, /class="summary-forensic span-12"[^>]*data-ux-layer="raw"/, "Summary forensic evidence must stay behind an explicit Raw disclosure");
assert.doesNotMatch(html, /class="summary-forensic span-12"[^>]*\sopen(?:\s|>)/, "Summary forensic evidence must be collapsed by default");
assert.match(html, /id="summary-forensic-status"/, "Summary forensic disclosure must expose a bounded live summary");
assert.ok((html.match(/data-ux-contract="human-v1"/g) || []).length >= 7, "All seven top-level dashboard surfaces must share the human-v1 contract");
assert.ok((html.match(/class="context-help"/g) || []).length >= 10, "Cross-dashboard technical definitions must use keyboard-accessible contextual help");
assert.match(html, /id="panel-errors"[^>]*data-ux-contract="human-v1"/, "Errors must formally declare the human UX contract");
assert.match(html, /class="error-item" data-ux-layer="detail"/, "Errors must expose each expandable item as detail");
assert.match(html, /class="error-detail" data-ux-layer="raw"/, "Full error messages must remain reachable as Raw evidence");
assert.match(html, /Ayuda sobre errores recientes/, "Errors must explain its progressive disclosure with contextual help");
assert.match(html, /id="panel-system"[^>]*data-ux-contract="human-v1"/, "System must declare the human UX contract");
assert.match(html, /Ayuda sobre epoch, baseline, contrato y scope/, "System observability definitions must use contextual help instead of repeated inline methodology");
assert.match(html, /rail\.scrollTo\(/, "Overflowing top-level tabs must keep the selected tab visible on narrow viewports");

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "Rendered dashboard must contain its browser script");
assert.doesNotThrow(() => new Function(scriptMatch[1]), "Rendered dashboard browser script must parse as JavaScript");

console.log("dashboard human UX contract tests passed");
