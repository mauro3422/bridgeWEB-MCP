export const dashboardStyles = `
:root {
  --bg: #080d1b;
  --bg-soft: #0d1426;
  --panel: rgba(18, 26, 47, 0.92);
  --panel-strong: #151f38;
  --panel-soft: rgba(255, 255, 255, 0.035);
  --text: #edf3ff;
  --muted: #93a5c7;
  --faint: #6d7d9c;
  --line: rgba(255, 255, 255, 0.09);
  --line-strong: rgba(255, 255, 255, 0.15);
  --accent: #7ba8ff;
  --accent-strong: #9bc9ff;
  --ok: #42d786;
  --warn: #ffc965;
  --bad: #ff6f7f;
  --info: #69c6ff;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
  --radius: 16px;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  min-height: 100vh;
  overflow-x: hidden;
  color: var(--text);
  background:
    radial-gradient(circle at 8% 0%, rgba(53, 93, 166, 0.28), transparent 34rem),
    linear-gradient(180deg, #0a1020 0%, var(--bg) 55%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
}

button, input, select { font: inherit; }
button { color: inherit; }
a { color: var(--accent-strong); }
code { font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 72px;
  padding: 0.95rem 1.35rem;
  border-bottom: 1px solid var(--line);
  background: rgba(8, 13, 27, 0.83);
  backdrop-filter: blur(16px);
}

.brand { min-width: 0; }
.brand-row { display: flex; align-items: center; gap: 0.65rem; }
.brand h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.015em; }
.brand-version {
  display: inline-flex;
  align-items: center;
  min-height: 1.55rem;
  padding: 0 0.52rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(255,255,255,0.035);
  font-size: 0.73rem;
}
.brand-subtitle { margin-top: 0.2rem; color: var(--muted); font-size: 0.8rem; }

.topbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.updated-at { color: var(--muted); font-size: 0.76rem; white-space: nowrap; }

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  min-height: 1.9rem;
  padding: 0.25rem 0.68rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(255,255,255,0.025);
  font-size: 0.77rem;
  white-space: nowrap;
}
.status-pill[data-tone="ok"] { color: #b8f5d1; border-color: rgba(66,215,134,0.28); background: rgba(66,215,134,0.08); }
.status-pill[data-tone="warn"] { color: #ffe0a0; border-color: rgba(255,201,101,0.28); background: rgba(255,201,101,0.08); }
.status-pill[data-tone="bad"] { color: #ffb6bf; border-color: rgba(255,111,127,0.3); background: rgba(255,111,127,0.09); }
.status-pill[data-tone="info"] { color: #bde7ff; border-color: rgba(105,198,255,0.28); background: rgba(105,198,255,0.08); }

.dot {
  width: 0.56rem;
  height: 0.56rem;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--faint);
  box-shadow: 0 0 0 3px rgba(255,255,255,0.025);
}
.dot.ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(66,215,134,0.1); }
.dot.warn { background: var(--warn); box-shadow: 0 0 0 3px rgba(255,201,101,0.1); }
.dot.bad { background: var(--bad); box-shadow: 0 0 0 3px rgba(255,111,127,0.1); }
.dot.info { background: var(--info); box-shadow: 0 0 0 3px rgba(105,198,255,0.1); }

.shell {
  width: min(1420px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 1rem 0 2.5rem;
}

.health-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.9rem;
}

.health-item {
  display: flex;
  align-items: center;
  gap: 0.58rem;
  min-width: 0;
  padding: 0.66rem 0.78rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255,255,255,0.022);
}
.health-copy { min-width: 0; }
.health-label { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; }
.health-value { margin-top: 0.1rem; overflow: hidden; color: var(--text); font-size: 0.82rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }

.tabs {
  position: sticky;
  top: 72px;
  z-index: 15;
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.9rem;
  padding: 0.35rem;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: rgba(12, 19, 35, 0.88);
  backdrop-filter: blur(14px);
}
.tab-button {
  min-height: 2.35rem;
  padding: 0.4rem 0.78rem;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
}
.tab-button:hover { color: var(--text); background: rgba(255,255,255,0.045); }
.tab-button:active { transform: translateY(1px); }
.tab-button[aria-selected="true"] { color: #f7faff; background: rgba(123,168,255,0.15); box-shadow: inset 0 0 0 1px rgba(123,168,255,0.2); }

.tab-panel[hidden] { display: none; }
.tab-panel { animation: panel-in 150ms ease-out; }
@keyframes panel-in { from { opacity: 0.45; transform: translateY(3px); } to { opacity: 1; transform: none; } }

.grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0.85rem; }
.span-3 { grid-column: span 3; }
.span-4 { grid-column: span 4; }
.span-5 { grid-column: span 5; }
.span-6 { grid-column: span 6; }
.span-7 { grid-column: span 7; }
.span-8 { grid-column: span 8; }
.span-12 { grid-column: span 12; }

.card {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(255,255,255,0.043), rgba(255,255,255,0.022));
  box-shadow: var(--shadow);
}
.card-body { padding: 1rem; }
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
  padding: 0.95rem 1rem 0;
}
.card-title { margin: 0; color: var(--text); font-size: 0.92rem; font-weight: 720; }
.card-kicker { margin-bottom: 0.22rem; color: var(--muted); font-size: 0.69rem; text-transform: uppercase; letter-spacing: 0.09em; }
.card-description { margin: 0.22rem 0 0; color: var(--muted); font-size: 0.77rem; line-height: 1.45; }
.card-actions { display: flex; gap: 0.4rem; }
.card-header-actions, .activity-recent-actions { display: flex; align-items: center; gap: 0.45rem; flex: 0 0 auto; }
.activity-recent-actions { align-items: flex-start; }
.context-help[open] > .info-button { background: rgba(123,168,255,0.16); }

.attention-card { overflow: hidden; border-color: rgba(255,201,101,0.23); }
.attention-card[data-state="ok"] { border-color: rgba(66,215,134,0.21); }
.attention-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--line);
  background: rgba(255,201,101,0.045);
}
.attention-card[data-state="ok"] .attention-head { background: rgba(66,215,134,0.04); }
.attention-list { display: grid; gap: 0; }
.attention-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  padding: 0.82rem 1rem;
  border-top: 1px solid var(--line);
}
.attention-item:first-child { border-top: 0; }
.attention-main { min-width: 0; }
.attention-title { color: var(--text); font-size: 0.84rem; font-weight: 680; }
.attention-detail { margin-top: 0.12rem; color: var(--muted); font-size: 0.75rem; }
.attention-value { color: var(--warn); font-size: 0.9rem; font-weight: 760; white-space: nowrap; }
.attention-item[data-tone="bad"] .attention-value { color: var(--bad); }
.attention-empty { padding: 1rem; color: var(--muted); font-size: 0.82rem; }

.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.72rem; }
.metric-card {
  min-width: 0;
  padding: 0.9rem;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--panel-soft);
}
.metric-label { color: var(--muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; }
.metric-value { margin-top: 0.28rem; color: var(--text); font-size: clamp(1.35rem, 2vw, 1.85rem); font-weight: 770; letter-spacing: -0.025em; }
.metric-note { margin-top: 0.16rem; color: var(--muted); font-size: 0.72rem; }
.metric-card[data-tone="warn"] { border-color: rgba(255,201,101,0.22); }
.metric-card[data-tone="warn"] .metric-value { color: #ffda8d; }
.metric-card[data-tone="bad"] { border-color: rgba(255,111,127,0.25); }
.metric-card[data-tone="bad"] .metric-value { color: #ffa1ac; }
.metric-card[data-tone="ok"] { border-color: rgba(66,215,134,0.2); }

.timeline-wrap { padding: 0.6rem 1rem 1rem; }
.timeline {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 0.2rem;
  min-height: 160px;
  padding-top: 0.7rem;
  border-bottom: 1px solid var(--line-strong);
}
.timeline::before,
.timeline::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed rgba(255,255,255,0.055);
}
.timeline::before { top: 34%; }
.timeline::after { top: 67%; }
.timeline-bar {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  min-width: 6px;
  max-width: 30px;
  height: var(--height, 8px);
  border-radius: 5px 5px 1px 1px;
  background: linear-gradient(180deg, #91bdff, #527bd6);
  transition: filter 120ms ease, transform 120ms ease;
}
.timeline-bar:hover { filter: brightness(1.16); transform: translateY(-2px); }
.timeline-bar[data-errors="true"] { background: linear-gradient(180deg, #ff8d99, #b94152); }
.timeline-axis { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.42rem; color: var(--faint); font-size: 0.68rem; }

.timeline-bar-button {
  appearance: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.timeline-bar-button:focus-visible,
.activity-mode-button:focus-visible,
.activity-call-summary:focus-visible {
  outline: 2px solid var(--focus, #8fc4ff);
  outline-offset: 3px;
}
.timeline-bar-button[aria-pressed="true"] {
  box-shadow: 0 0 0 2px #0b1020, 0 0 0 4px #8fc4ff;
  filter: brightness(1.12);
}
.activity-timeline-detail {
  margin-top: 0.7rem;
  min-height: 3.1rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255,255,255,0.018);
  color: var(--muted);
  font-size: 0.74rem;
}
.activity-timeline-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.7rem;
}
.activity-timeline-detail-grid > div,
.activity-call-detail > div { display: grid; gap: 0.18rem; min-width: 0; }
.activity-detail-label {
  color: var(--faint);
  font-size: 0.63rem;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}
.activity-timeline-detail strong,
.activity-call-detail strong { color: var(--text); }
.activity-detail-note { margin-top: 0.55rem; color: var(--faint); line-height: 1.45; }
.activity-recent-header { align-items: flex-start; gap: 1rem; }
.activity-mode-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 0.18rem;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: rgba(5,10,22,0.48);
}
.activity-mode-button {
  border: 0;
  border-radius: 7px;
  padding: 0.4rem 0.65rem;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.7rem;
  cursor: pointer;
}
.activity-mode-button[aria-pressed="true"] { background: rgba(118,168,255,0.17); color: var(--text); }
.activity-call-list { display: grid; gap: 0.45rem; padding: 0.65rem 1rem 1rem; }
.activity-call-group {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255,255,255,0.015);
  overflow: clip;
}
.activity-call-group[data-tone="warn"] { border-color: rgba(255,201,101,0.25); }
.activity-call-group[data-tone="bad"] { border-color: rgba(255,111,127,0.3); }
.activity-call-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: center;
  padding: 0.62rem 0.75rem;
  cursor: pointer;
  list-style: none;
}
.activity-call-summary::-webkit-details-marker { display: none; }
.activity-call-summary::after { content: '›'; color: var(--faint); margin-left: 0.15rem; }
.activity-call-group[open] .activity-call-summary::after { content: '⌄'; }
.activity-call-main { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
.activity-call-last { color: var(--faint); font-size: 0.66rem; white-space: nowrap; }
.activity-call-metrics { color: var(--muted); font-size: 0.7rem; text-align: right; white-space: nowrap; }
.activity-call-metrics strong { color: var(--text); }
.activity-call-detail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 0.75rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.45;
}
.activity-call-subjects { grid-column: 1 / -1; }
.activity-raw-table[hidden],
.activity-call-list[hidden] { display: none; }
.activity-raw-table { border-top: 1px solid var(--line); }

.empty-state {
  display: grid;
  place-items: center;
  min-height: 150px;
  padding: 1.2rem;
  color: var(--muted);
  text-align: center;
  font-size: 0.8rem;
  line-height: 1.5;
}

.status-list { display: grid; gap: 0.1rem; padding: 0.5rem 1rem 1rem; }
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.58rem 0;
  border-bottom: 1px solid var(--line);
}
.status-row:last-child { border-bottom: 0; }
.status-key { color: var(--muted); font-size: 0.77rem; }
.status-value { min-width: 0; color: var(--text); font-size: 0.79rem; font-weight: 660; text-align: right; overflow-wrap: anywhere; }

.tool-list { display: grid; gap: 0.58rem; padding: 0.65rem 1rem 1rem; }
.tool-row { display: grid; grid-template-columns: minmax(9rem, 1.2fr) 4rem minmax(6rem, 1fr); align-items: center; gap: 0.75rem; }
.tool-name { min-width: 0; }
.tool-name strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem; }
.tool-meta { margin-top: 0.12rem; color: var(--muted); font-size: 0.68rem; }
.tool-count { text-align: right; font-variant-numeric: tabular-nums; font-size: 0.78rem; }
.progress-track { height: 0.58rem; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,0.075); }
.progress-fill { display: block; height: 100%; width: var(--width, 0%); border-radius: inherit; background: linear-gradient(90deg, #76a6ff, #9edfff); }
.progress-fill.warn { background: linear-gradient(90deg, #d79a39, #ffd785); }
.progress-fill.bad { background: linear-gradient(90deg, #bc4251, #ff8794); }
.progress-fill.ok { background: linear-gradient(90deg, #2ba968, #6be0a0); }

.table-wrap { width: 100%; overflow-x: auto; padding: 0.45rem 1rem 1rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
th, td { padding: 0.62rem 0.42rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--muted); font-weight: 650; white-space: nowrap; }
td { color: #dbe6fa; }
tr:last-child td { border-bottom: 0; }
td code { display: inline-block; max-width: 22rem; padding: 0.1rem 0.28rem; overflow: hidden; border-radius: 5px; background: rgba(255,255,255,0.06); text-overflow: ellipsis; white-space: nowrap; }

.recent-detail { max-width: 28rem; color: var(--muted); font-size: 0.7rem; overflow-wrap: anywhere; }
.recent-subject { max-width: 14rem; margin-top: 0.2rem; color: var(--muted); font-size: 0.66rem; overflow-wrap: anywhere; }

.mssr-list { display: grid; gap: 0.78rem; padding: 0.75rem 1rem 1rem; }
.mssr-row { display: grid; grid-template-columns: minmax(12rem, 1.3fr) minmax(10rem, 2fr) 5rem; align-items: center; gap: 0.9rem; }
.mssr-label strong { display: block; font-size: 0.82rem; }
.mssr-label span { display: block; margin-top: 0.14rem; color: var(--muted); font-size: 0.69rem; }
.mssr-value { text-align: right; font-size: 0.8rem; font-weight: 720; font-variant-numeric: tabular-nums; }

.mssr-local-nav { position: sticky; top: 122px; z-index: 12; display: flex; gap: 0.4rem; padding: 0.48rem; overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: rgba(12,19,35,0.92); box-shadow: var(--shadow); backdrop-filter: blur(14px); }
.mssr-local-nav button { min-height: 2rem; padding: 0.34rem 0.66rem; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted); font-size: 0.72rem; white-space: nowrap; cursor: pointer; }
.mssr-local-nav button:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.mssr-local-nav button[aria-current="true"] { color: #f7faff; border-color: rgba(123,168,255,0.22); background: rgba(123,168,255,0.13); }
.mssr-local-nav button:focus-visible, .mssr-family-summary:focus-visible { outline: 2px solid var(--focus, #8fc4ff); outline-offset: 2px; }
.mssr-family-group { grid-column: 1 / -1; min-width: 0; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018)); box-shadow: var(--shadow); overflow: clip; scroll-margin-top: 176px; }
.mssr-family-summary { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 4.7rem; padding: 0.82rem 1rem; list-style: none; cursor: pointer; }
.mssr-family-summary::-webkit-details-marker { display: none; }
.mssr-family-summary > div { min-width: 0; display: grid; gap: 0.13rem; }
.mssr-family-kicker { color: var(--faint); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.mssr-family-summary strong { color: var(--text); font-size: 0.91rem; }
.mssr-family-summary small { max-width: 55rem; color: var(--muted); font-size: 0.69rem; line-height: 1.4; }
.mssr-family-summary::after { content: '›'; flex: 0 0 auto; color: var(--faint); font-size: 1.1rem; }
.mssr-family-group[open] > .mssr-family-summary::after { content: '⌄'; }
.mssr-family-status { margin-left: auto; color: var(--muted); font-size: 0.68rem; text-align: right; white-space: nowrap; }
.mssr-family-group[open] > .mssr-family-summary { border-bottom: 1px solid var(--line); background: rgba(123,168,255,0.025); }
.mssr-family-grid { padding: 0.85rem; }
.mssr-family-grid > .card { box-shadow: none; }

.error-list { display: grid; gap: 0.62rem; padding: 0.65rem 1rem 1rem; }
.error-item {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255,255,255,0.022);
}
.error-item[open] { border-color: rgba(255,111,127,0.22); }
.error-summary {
  display: grid;
  grid-template-columns: 5.3rem minmax(9rem, 0.8fr) minmax(0, 2.5fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.72rem 0.82rem;
  cursor: pointer;
  list-style: none;
}
.error-summary::-webkit-details-marker { display: none; }
.error-time { color: var(--muted); font-size: 0.7rem; }
.error-tool { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.76rem; font-weight: 690; }
.error-message { min-width: 0; overflow: hidden; color: #ffc0c7; font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
.error-duration { color: var(--muted); font-size: 0.7rem; white-space: nowrap; }
.error-detail { padding: 0 0.82rem 0.82rem; }
.error-detail pre {
  margin: 0;
  max-height: 18rem;
  padding: 0.75rem;
  overflow: auto;
  border-radius: 9px;
  background: rgba(0,0,0,0.24);
  color: #dbe6fa;
  font: 0.7rem/1.48 "Cascadia Code", Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.system-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; padding: 0.65rem 1rem 1rem; }
.system-field { min-width: 0; padding: 0.72rem; border: 1px solid var(--line); border-radius: 11px; background: rgba(255,255,255,0.022); }
.system-label { color: var(--muted); font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.075em; }
.system-value { margin-top: 0.27rem; color: var(--text); font-size: 0.78rem; font-weight: 620; overflow-wrap: anywhere; }

.secondary-button {
  min-height: 2.25rem;
  padding: 0.42rem 0.72rem;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: rgba(255,255,255,0.035);
  color: var(--muted);
  cursor: pointer;
}
.secondary-button:hover { color: var(--text); background: rgba(255,255,255,0.065); }

.portfolio-filters {
  display: grid;
  grid-template-columns: minmax(14rem, 2fr) repeat(4, minmax(9rem, 1fr));
  gap: 0.7rem;
  padding: 0.8rem 1rem 1rem;
}
.portfolio-field { display: grid; gap: 0.32rem; min-width: 0; }
.portfolio-field > span { color: var(--muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.075em; }
.portfolio-field input,
.portfolio-field select {
  width: 100%;
  min-height: 2.35rem;
  padding: 0.48rem 0.62rem;
  border: 1px solid var(--line);
  border-radius: 9px;
  outline: none;
  background: rgba(7, 12, 24, 0.72);
  color: var(--text);
}
.portfolio-field input:focus,
.portfolio-field select:focus { border-color: rgba(123,168,255,0.55); box-shadow: 0 0 0 3px rgba(123,168,255,0.1); }
.portfolio-field input::placeholder { color: var(--faint); }

.portfolio-list { display: grid; gap: 0.65rem; padding: 0.65rem 1rem 1rem; }
.portfolio-loading, .portfolio-empty { margin: 0.15rem 0; }
.portfolio-group {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255,255,255,0.018);
}
.portfolio-group[data-tone="warn"] { border-color: rgba(255,201,101,0.22); }
.portfolio-group[data-tone="ok"] { border-color: rgba(66,215,134,0.16); }
.portfolio-group-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  padding: 0.72rem 0.82rem;
  cursor: pointer;
  list-style: none;
}
.portfolio-group-summary:focus-visible,
.portfolio-item-summary:focus-visible,
.notice-group-summary:focus-visible,
.notice-raw > summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.portfolio-group-summary,
.portfolio-item-summary,
.notice-group-summary { position: relative; padding-right: 2rem; }
.portfolio-group-summary::after,
.portfolio-item-summary::after,
.notice-group-summary::after {
  content: '›';
  position: absolute;
  top: 50%;
  right: 0.72rem;
  color: var(--faint);
  font-size: 1rem;
  line-height: 1;
  transform: translateY(-50%);
  transition: transform 120ms ease, color 120ms ease;
}
.portfolio-group[open] > .portfolio-group-summary::after,
.portfolio-item[open] > .portfolio-item-summary::after,
.notice-group[open] > .notice-group-summary::after { color: var(--accent-strong); transform: translateY(-50%) rotate(90deg); }
.portfolio-group-summary > span:first-child { min-width: 0; }
.portfolio-group-summary strong { display: block; color: var(--text); font-size: 0.78rem; }
.portfolio-group-summary small { display: block; margin-top: 0.12rem; color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
.portfolio-group-count {
  min-width: 2.1rem;
  padding: 0.18rem 0.48rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--text);
  text-align: center;
  font-size: 0.7rem;
  font-weight: 720;
}
.portfolio-group[open] > .portfolio-group-summary { border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.018); }
.portfolio-group-items { display: grid; }
.portfolio-item { border-top: 1px solid var(--line); }
.portfolio-item:first-child { border-top: 0; }
.portfolio-item-summary {
  display: grid;
  grid-template-columns: minmax(13rem, 1.5fr) minmax(15rem, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  min-height: 3.25rem;
  padding: 0.58rem 0.72rem;
  cursor: pointer;
  list-style: none;
}
.portfolio-item-summary:hover { background: rgba(255,255,255,0.022); }
.portfolio-item[open] > .portfolio-item-summary { background: rgba(123,168,255,0.04); }
.portfolio-item-identity { min-width: 0; display: flex; align-items: baseline; gap: 0.5rem; }
.portfolio-item-identity code { max-width: min(28rem, 100%); overflow: hidden; text-overflow: ellipsis; font-weight: 720; white-space: nowrap; }
.portfolio-item-identity > span { color: var(--faint); font-size: 0.64rem; white-space: nowrap; }
.portfolio-item-metrics { display: flex; align-items: baseline; justify-content: flex-end; gap: 0.28rem; min-width: 0; color: var(--muted); font-size: 0.65rem; white-space: nowrap; }
.portfolio-item-metrics strong { color: var(--text); font-size: 0.73rem; }
.portfolio-item-metrics strong[data-tone="warn"] { color: #ffe0a0; }
.portfolio-item-metrics strong[data-tone="ok"] { color: #b8f5d1; }
.portfolio-item-latency { margin-left: 0.35rem; color: var(--faint); }
.portfolio-item-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(12rem, 0.9fr) minmax(13rem, 1fr) minmax(0, 1.15fr);
  gap: 0.65rem;
  padding: 0.72rem;
  border-top: 1px solid var(--line);
  background: rgba(7,12,24,0.34);
}
.portfolio-detail-block { min-width: 0; padding: 0.58rem; border: 1px solid rgba(255,255,255,0.055); border-radius: 9px; background: rgba(255,255,255,0.015); }
.portfolio-detail-label { margin-bottom: 0.35rem; color: var(--faint); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.075em; }
.portfolio-description { color: var(--muted); font-size: 0.71rem; line-height: 1.42; }
.portfolio-subline { margin-top: 0.28rem; color: var(--muted); font-size: 0.68rem; line-height: 1.4; overflow-wrap: anywhere; }
.portfolio-subline code { max-width: 13rem; }
.portfolio-badges { display: flex; flex-wrap: wrap; gap: 0.32rem; }
.portfolio-badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.55rem;
  padding: 0.15rem 0.48rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(255,255,255,0.025);
  font-size: 0.65rem;
  white-space: nowrap;
}
.portfolio-badge[data-tone="ok"] { color: #b8f5d1; border-color: rgba(66,215,134,0.25); background: rgba(66,215,134,0.07); }
.portfolio-badge[data-tone="warn"] { color: #ffe0a0; border-color: rgba(255,201,101,0.26); background: rgba(255,201,101,0.07); }
.portfolio-badge[data-tone="bad"] { color: #ffb6bf; border-color: rgba(255,111,127,0.28); background: rgba(255,111,127,0.08); }
.portfolio-badge[data-tone="info"] { color: #bde7ff; border-color: rgba(105,198,255,0.24); background: rgba(105,198,255,0.07); }
.portfolio-errors { margin-top: 0.3rem; color: #ffc0c7; font-size: 0.67rem; overflow-wrap: anywhere; }
.portfolio-recommendation { color: var(--text); font-size: 0.74rem; line-height: 1.42; }
.portfolio-reason { margin-top: 0.32rem; color: var(--muted); font-size: 0.68rem; line-height: 1.42; }

.notice-list { display: grid; gap: 0.55rem; padding: 0 1rem 1rem; }
.notice-empty { padding: 0.85rem; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); font-size: 0.74rem; }
.notice-group { overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.018); }
.notice-group[data-tone="warning"] { border-color: rgba(255,201,101,0.24); }
.notice-group[data-tone="error"] { border-color: rgba(255,111,127,0.28); }
.notice-group-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: center;
  padding: 0.7rem 0.78rem;
  cursor: pointer;
  list-style: none;
}
.notice-group[open] > .notice-group-summary { border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.018); }
.notice-group-main { min-width: 0; display: flex; align-items: center; gap: 0.55rem; }
.notice-group-main code { max-width: 20rem; flex: 0 0 auto; }
.notice-group-message { min-width: 0; overflow: hidden; color: var(--muted); font-size: 0.7rem; text-overflow: ellipsis; white-space: nowrap; }
.notice-group-meta { display: flex; align-items: baseline; gap: 0.32rem; color: var(--muted); font-size: 0.64rem; white-space: nowrap; }
.notice-group-meta strong { color: var(--text); font-size: 0.76rem; }
.notice-group-meta time { margin-left: 0.35rem; color: var(--faint); }
.notice-group-detail { padding: 0.72rem 0.78rem; }
.notice-group-source { margin-bottom: 0.4rem; color: var(--faint); font-size: 0.65rem; }
.notice-item { padding: 0.72rem 0.78rem; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.018); }
.notice-item[data-tone="warning"] { border-color: rgba(255,201,101,0.24); }
.notice-item[data-tone="error"] { border-color: rgba(255,111,127,0.28); }
.notice-item-head { display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
.notice-item-head > div { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; }
.notice-item-head code { max-width: 18rem; }
.notice-item-head span, .notice-item-head time { color: var(--muted); font-size: 0.66rem; }
.notice-message { margin-top: 0.48rem; font-size: 0.74rem; line-height: 1.42; }
.notice-occurrences { margin-top: 0.3rem; color: var(--muted); font-size: 0.66rem; }
.notice-actions { display: grid; gap: 0.38rem; margin-top: 0.55rem; }
.notice-action { display: grid; grid-template-columns: auto auto 1fr; gap: 0.45rem; align-items: start; padding: 0.45rem 0.55rem; border-radius: 8px; background: rgba(105,198,255,0.055); }
.notice-action strong { font-size: 0.68rem; color: #bde7ff; }
.notice-action code { max-width: 14rem; }
.notice-action span { color: var(--muted); font-size: 0.67rem; line-height: 1.38; }
.notice-raw { margin-top: 0.65rem; border-top: 1px solid var(--line); padding-top: 0.55rem; }
.notice-raw > summary { width: fit-content; cursor: pointer; color: var(--accent-strong); font-size: 0.68rem; }
.notice-raw-list { display: grid; gap: 0.5rem; margin-top: 0.55rem; }
.notice-raw-item { background: rgba(0,0,0,0.12); }

.cockpit-focus-card { border-color: rgba(123,168,255,0.24); }
.cockpit-orientation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.7rem; padding: 0.2rem 1rem 0.9rem; }
.cockpit-orientation-card { min-width: 0; min-height: 8.2rem; display: grid; align-content: start; gap: 0.38rem; padding: 0.82rem 0.88rem; border: 1px solid var(--line); border-radius: 13px; background: rgba(255,255,255,0.018); }
.cockpit-orientation-card[data-tone="ok"] { border-color: rgba(66,215,134,0.22); background: rgba(66,215,134,0.04); }
.cockpit-orientation-card[data-tone="warn"] { border-color: rgba(255,201,101,0.3); background: rgba(255,201,101,0.045); }
.cockpit-orientation-card[data-tone="info"] { border-color: rgba(123,168,255,0.24); background: rgba(123,168,255,0.04); }
.cockpit-orientation-card > span { color: var(--faint); font-size: 0.63rem; font-weight: 700; letter-spacing: 0.075em; text-transform: uppercase; }
.cockpit-orientation-card > strong { color: #edf4ff; font-size: 0.9rem; line-height: 1.35; overflow-wrap: anywhere; }
.cockpit-orientation-card > small { color: var(--muted); font-size: 0.68rem; line-height: 1.45; }
.cockpit-focus-detail { margin: 0 1rem 1rem; border: 1px solid var(--line); border-radius: 11px; background: rgba(255,255,255,0.012); overflow: clip; }
.cockpit-focus-detail > summary, .cockpit-return-disclosure > summary, .cockpit-technical-disclosure > summary, .cockpit-human-task > summary, .cockpit-task-evidence > summary { cursor: pointer; list-style: none; }
.cockpit-focus-detail > summary::-webkit-details-marker, .cockpit-return-disclosure > summary::-webkit-details-marker, .cockpit-technical-disclosure > summary::-webkit-details-marker, .cockpit-human-task > summary::-webkit-details-marker, .cockpit-task-evidence > summary::-webkit-details-marker { display: none; }
.cockpit-focus-detail > summary { padding: 0.68rem 0.82rem; color: var(--muted); font-size: 0.7rem; font-weight: 700; }
.cockpit-focus-detail > summary::after, .cockpit-return-disclosure > summary::after, .cockpit-task-evidence > summary::after { content: '›'; float: right; color: var(--faint); }
.cockpit-focus-detail[open] > summary::after, .cockpit-return-disclosure[open] > summary::after, .cockpit-task-evidence[open] > summary::after { content: '⌄'; }
.cockpit-focus-detail .cockpit-focus { padding: 0 0.8rem 0.8rem; }
.cockpit-return-grid { grid-template-columns: minmax(0, 2fr) minmax(15rem, 0.9fr); align-items: start; }
.cockpit-return-pane-active { grid-row: span 2; }
.cockpit-return-disclosure { padding: 0; overflow: clip; }
.cockpit-return-disclosure > summary { margin: 0; padding: 0.78rem; }
.cockpit-return-disclosure > div { padding: 0 0.78rem 0.78rem; }
.cockpit-human-task { margin-top: 0.48rem; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.016); overflow: clip; }
.cockpit-human-task:first-child { margin-top: 0; }
.cockpit-human-task[data-needs-closure="true"] { border-color: rgba(255,190,92,0.3); }
.cockpit-human-task-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem; padding: 0.68rem 0.72rem; }
.cockpit-human-task-summary > div { min-width: 0; display: grid; gap: 0.12rem; }
.cockpit-human-task-summary strong { color: #edf3ff; font-size: 0.73rem; overflow-wrap: anywhere; }
.cockpit-human-task-summary > div > span { color: var(--faint); font-size: 0.62rem; overflow-wrap: anywhere; }
.cockpit-human-task-detail { padding: 0 0.72rem 0.72rem; border-top: 1px solid rgba(255,255,255,0.05); }
.cockpit-task-evidence { margin-top: 0.6rem; border: 1px dashed var(--line); border-radius: 9px; }
.cockpit-task-evidence > summary { padding: 0.55rem 0.62rem; color: var(--faint); font-size: 0.64rem; }
.cockpit-task-evidence-list { display: grid; gap: 0.45rem; padding: 0 0.58rem 0.58rem; }
.cockpit-trace-compact { padding: 0.58rem; background: rgba(5,10,22,0.26); }
.cockpit-trace-compact .cockpit-trace-summary { margin-top: 0.4rem; font-size: 0.68rem; }
.cockpit-technical-card { padding: 0; overflow: clip; }
.cockpit-technical-disclosure > summary { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem 1rem; }
.cockpit-technical-disclosure > summary > div { min-width: 0; }
.cockpit-technical-disclosure > summary strong { display: block; margin-top: 0.12rem; color: #edf3ff; font-size: 0.86rem; }
.cockpit-technical-disclosure > summary > div > span { display: block; margin-top: 0.18rem; color: var(--muted); font-size: 0.66rem; line-height: 1.4; }
.cockpit-technical-disclosure > summary::after { content: '›'; color: var(--faint); }
.cockpit-technical-disclosure[open] > summary::after { content: '⌄'; }
.cockpit-technical-disclosure[open] > summary { border-bottom: 1px solid var(--line); }
.cockpit-focus-detail > summary:focus-visible, .cockpit-return-disclosure > summary:focus-visible, .cockpit-technical-disclosure > summary:focus-visible, .cockpit-human-task > summary:focus-visible, .cockpit-task-evidence > summary:focus-visible { outline: 2px solid var(--focus, #8fc4ff); outline-offset: -2px; }
.cockpit-secondary-stack { grid-column: span 12; border: 1px solid rgba(123,168,255,0.2); border-radius: 13px; background: rgba(18,28,48,0.46); overflow: clip; }
.cockpit-secondary-stack > summary { display: flex; align-items: center; justify-content: space-between; gap: 0.9rem; padding: 0.9rem 1rem; cursor: pointer; list-style: none; }
.cockpit-secondary-stack > summary::-webkit-details-marker { display: none; }
.cockpit-secondary-stack > summary strong { display: block; margin-top: 0.12rem; color: #edf3ff; font-size: 0.86rem; }
.cockpit-secondary-stack > summary > div > span { display: block; margin-top: 0.18rem; color: var(--muted); font-size: 0.66rem; line-height: 1.4; }
.cockpit-secondary-stack > summary::after { content: '›'; flex: 0 0 auto; color: var(--faint); font-size: 1rem; }
.cockpit-secondary-stack[open] > summary::after { content: '⌄'; }
.cockpit-secondary-stack[open] > summary { border-bottom: 1px solid var(--line); }
.cockpit-secondary-stack > summary:focus-visible { outline: 2px solid var(--focus, #8fc4ff); outline-offset: -2px; }
.cockpit-secondary-grid { padding: 1rem; }
.cockpit-secondary-disclosure { margin: 0 1rem 1rem; border: 1px solid var(--line); border-radius: 11px; background: rgba(255,255,255,0.012); overflow: clip; }
.cockpit-secondary-disclosure > summary { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding: 0.66rem 0.78rem; color: #dce8ff; font-size: 0.7rem; font-weight: 700; cursor: pointer; list-style: none; }
.cockpit-secondary-disclosure > summary::-webkit-details-marker { display: none; }
.cockpit-secondary-disclosure > summary::after { content: '›'; flex: 0 0 auto; color: var(--faint); font-size: 0.95rem; }
.cockpit-secondary-disclosure[open] > summary::after { content: '⌄'; }
.cockpit-secondary-disclosure[open] > summary { border-bottom: 1px solid var(--line); }
.cockpit-secondary-disclosure > summary:focus-visible { outline: 2px solid var(--focus, #8fc4ff); outline-offset: -2px; }
.cockpit-secondary-disclosure .table-wrap, .cockpit-secondary-disclosure .cockpit-capability-families { margin: 0; padding: 0.72rem; }
.disclosure-hint { margin-left: auto; color: var(--faint); font-size: 0.62rem; font-weight: 600; }
.cockpit-weekly-card { border-color: rgba(123,168,255,0.16); }
.cockpit-capabilities-card { border-color: rgba(123,168,255,0.13); }
.cockpit-weekly-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.55rem; padding: 0.2rem 1rem 0.9rem; }
.cockpit-capability-families { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.5rem; padding: 0 1rem 1rem; }
.cockpit-capability-family { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; padding: 0.65rem 0.72rem; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.018); }
.cockpit-capability-family > div { min-width: 0; }
.cockpit-capability-family strong { display: block; color: #e8f0ff; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cockpit-capability-family span:not(.status-pill):not(.dot) { display: block; margin-top: 0.16rem; color: var(--faint); font-size: 0.6rem; line-height: 1.3; }
.cockpit-weekly-stat { min-width: 0; padding: 0.72rem 0.78rem; border: 1px solid var(--line); border-radius: 11px; background: rgba(123,168,255,0.035); }
.cockpit-weekly-stat > span { display: block; color: var(--muted); font-size: 0.65rem; line-height: 1.3; }
.cockpit-weekly-stat > strong { display: block; margin-top: 0.24rem; color: #e8f0ff; font-size: 1.05rem; }
.cockpit-weekly-stat > small { display: block; margin-top: 0.2rem; color: var(--faint); font-size: 0.62rem; line-height: 1.35; }
.cockpit-return-card { border-color: rgba(109,224,184,0.18); }
.cockpit-return-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.55rem; padding: 0.2rem 1rem 0.75rem; }
.cockpit-return-stat { min-width: 0; padding: 0.72rem 0.78rem; border: 1px solid var(--line); border-radius: 11px; background: rgba(109,224,184,0.035); }
.cockpit-return-stat > span { display: block; color: var(--muted); font-size: 0.65rem; line-height: 1.3; }
.cockpit-return-stat > strong { display: block; margin-top: 0.24rem; color: #e7fff6; font-size: 1rem; overflow-wrap: anywhere; }
.cockpit-return-stat > small { display: block; margin-top: 0.2rem; color: var(--faint); font-size: 0.62rem; line-height: 1.35; }
.cockpit-return-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.65rem; padding: 0 1rem 1rem; }
.cockpit-return-pane { min-width: 0; padding: 0.78rem; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,0.018); }
.cockpit-return-heading { margin-bottom: 0.58rem; color: #dce8ff; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em; }
.cockpit-return-meta { display: flex; justify-content: space-between; gap: 0.6rem; color: var(--muted); font-size: 0.66rem; }
.cockpit-return-meta strong { color: #e8f0ff; }
.cockpit-return-chips { display: flex; flex-wrap: wrap; gap: 0.34rem; margin-top: 0.58rem; }
.cockpit-chip { padding: 0.25rem 0.44rem; border: 1px solid var(--line); border-radius: 999px; color: #c9d8f1; font-size: 0.62rem; background: rgba(123,168,255,0.04); }
.cockpit-return-list { display: grid; gap: 0.42rem; margin-top: 0.66rem; }
.cockpit-return-item { display: grid; gap: 0.16rem; padding-top: 0.44rem; border-top: 1px solid rgba(255,255,255,0.06); }
.cockpit-return-item strong { color: #dfeaff; font-size: 0.66rem; }
.cockpit-return-item span { color: var(--muted); font-size: 0.65rem; line-height: 1.42; }
.cockpit-open-task { padding: 0.62rem 0; border-top: 1px solid rgba(255,255,255,0.06); }
.cockpit-open-task:first-child { padding-top: 0; border-top: 0; }
.cockpit-open-task[data-needs-closure="true"] { padding-left: 0.58rem; border-left: 2px solid rgba(255,190,92,0.5); }
.cockpit-open-task-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.58rem; }
.cockpit-open-task-head > div { min-width: 0; display: grid; gap: 0.1rem; }
.cockpit-open-task-head strong { color: #edf3ff; font-size: 0.7rem; }
.cockpit-open-task-head > div > span { color: var(--faint); font-size: 0.61rem; overflow-wrap: anywhere; }
.cockpit-open-task-summary { margin-top: 0.32rem; color: var(--muted); font-size: 0.66rem; line-height: 1.42; }
.cockpit-focus { padding: 0.8rem 1rem 1rem; }
.cockpit-focus-main { padding: 0.9rem; border: 1px solid var(--line); border-radius: 13px; background: rgba(123,168,255,0.045); }
.cockpit-focus-heading, .cockpit-trace-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.8rem; }
.cockpit-focus-heading > strong { min-width: 0; font-size: 1rem; overflow-wrap: anywhere; }
.cockpit-focus-summary, .cockpit-trace-summary { margin-top: 0.62rem; color: #dbe6fa; font-size: 0.8rem; line-height: 1.5; }
.cockpit-meta { margin-top: 0.25rem; color: var(--muted); font-size: 0.68rem; line-height: 1.4; overflow-wrap: anywhere; }
.cockpit-phase-row { display: flex; flex-wrap: wrap; gap: 0.36rem; margin-top: 0.72rem; }
.cockpit-phase { display: inline-flex; align-items: center; gap: 0.32rem; min-height: 1.65rem; padding: 0.16rem 0.46rem; border: 1px solid var(--line); border-radius: 999px; color: var(--faint); background: rgba(255,255,255,0.02); font-size: 0.66rem; }
.cockpit-phase[data-state="done"] { color: #b8f5d1; border-color: rgba(66,215,134,0.22); background: rgba(66,215,134,0.06); }
.cockpit-phase[data-state="current"] { color: #ffe0a0; border-color: rgba(255,201,101,0.28); background: rgba(255,201,101,0.07); }
.cockpit-traces { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.68rem; padding: 0.72rem 1rem 1rem; }
.cockpit-trace { min-width: 0; padding: 0.78rem; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,0.022); }
.cockpit-trace[data-status="active"] { border-color: rgba(66,215,134,0.18); }
.cockpit-trace[data-status="idle"] { border-color: rgba(255,201,101,0.2); }
.cockpit-trace-head strong { display: block; min-width: 0; font-size: 0.8rem; overflow-wrap: anywhere; }
.cockpit-maintenance { display: grid; gap: 0; padding: 0.55rem 1rem 1rem; }
.cockpit-maintenance-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.58rem 0; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.76rem; }
.cockpit-maintenance-note { margin-top: 0.7rem; padding: 0.7rem; border: 1px dashed var(--line); border-radius: 9px; color: var(--muted); font-size: 0.69rem; line-height: 1.45; }

.inline-note { color: var(--muted); font-size: 0.72rem; }
.muted { color: var(--muted); }
.small { font-size: 0.72rem; }
.no-margin { margin: 0; }

.context-help { position: relative; flex: 0 0 auto; }
.context-help > summary { list-style: none; }
.context-help > summary::-webkit-details-marker { display: none; }
.info-button { display: grid; place-items: center; width: 1.8rem; height: 1.8rem; padding: 0; border: 1px solid rgba(123,168,255,0.28); border-radius: 999px; color: var(--accent-strong); background: rgba(123,168,255,0.07); font-size: 0.78rem; font-weight: 800; cursor: pointer; }
.info-button:hover { background: rgba(123,168,255,0.13); }
.info-button:focus-visible { outline: 2px solid var(--focus, #8fc4ff); outline-offset: 2px; }
.context-help-popover { position: absolute; z-index: 40; top: calc(100% + 0.45rem); right: 0; width: min(22rem, calc(100vw - 2rem)); padding: 0.72rem 0.78rem; border: 1px solid var(--line-strong); border-radius: 11px; background: #111a30; box-shadow: 0 18px 45px rgba(0,0,0,0.38); }
.context-help-popover strong { display: block; color: var(--text); font-size: 0.75rem; }
.context-help-popover span { display: block; margin-top: 0.25rem; color: var(--muted); font-size: 0.69rem; line-height: 1.48; }

.summary-forensic { grid-column: 1 / -1; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018)); box-shadow: var(--shadow); overflow: clip; }
.summary-forensic > summary { list-style: none; cursor: pointer; }
.summary-forensic > summary::-webkit-details-marker { display: none; }
.summary-forensic-summary { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.85rem 1rem; }
.summary-forensic-summary > div { min-width: 0; }
.summary-forensic-summary strong { display: block; color: var(--text); font-size: 0.86rem; }
.summary-forensic-summary > div > span { display: block; margin-top: 0.18rem; color: var(--muted); font-size: 0.69rem; line-height: 1.42; }
.summary-forensic-summary::after { content: '›'; flex: 0 0 auto; color: var(--faint); font-size: 1.1rem; }
.summary-forensic[open] > .summary-forensic-summary::after { content: '⌄'; }
.summary-forensic[open] > .summary-forensic-summary { border-bottom: 1px solid var(--line); }
.summary-forensic-summary:focus-visible { outline: 2px solid var(--focus, #8fc4ff); outline-offset: -2px; }
.summary-forensic-grid { padding: 0.85rem; }
.summary-forensic-grid > .card { box-shadow: none; }

.tabs { scrollbar-width: none; scroll-snap-type: x proximity; }
.tabs::-webkit-scrollbar { display: none; }
.tab-button { scroll-snap-align: center; }

@media (max-width: 1100px) {
  .health-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .portfolio-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .portfolio-field:first-child { grid-column: 1 / -1; }
  .portfolio-item-detail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .portfolio-item-summary { grid-template-columns: minmax(12rem, 1fr) auto auto; }
  .cockpit-weekly-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cockpit-capability-families { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cockpit-return-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cockpit-return-grid { grid-template-columns: 1fr; }
  .cockpit-return-pane-active { grid-row: auto; }
  .cockpit-orientation { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cockpit-orientation-card[data-orientation="attention"] { grid-column: 1 / -1; min-height: 0; }
  .cockpit-traces { grid-template-columns: 1fr; }
  .span-3, .span-4, .span-5, .span-6, .span-7, .span-8 { grid-column: span 12; }
}

@media (max-width: 720px) {
  .topbar { position: static; align-items: stretch; flex-direction: column; padding: 0.85rem 1rem; }
  .topbar-actions { width: 100%; align-items: flex-start; justify-content: flex-start; flex-direction: column-reverse; }
  .brand-subtitle { max-width: 100%; overflow-wrap: anywhere; }
  .shell { width: min(100% - 1rem, 1420px); padding-top: 0.55rem; }
  .tabs { top: 0; max-width: 100%; }
  .card-header, .attention-head { align-items: flex-start; flex-direction: column; }
  .health-strip { grid-template-columns: 1fr; gap: 0.5rem; }
  .health-item:last-child { grid-column: auto; }
  .metric-grid { grid-template-columns: 1fr; }
  .mssr-local-nav { position: static; }
  .mssr-family-summary { align-items: flex-start; flex-direction: column; }
  .mssr-family-status { margin-left: 0; text-align: left; white-space: normal; }
  .cockpit-orientation { grid-template-columns: 1fr; }
  .cockpit-orientation-card[data-orientation="attention"] { grid-column: auto; }
  .cockpit-human-task-summary, .cockpit-technical-disclosure > summary { align-items: stretch; flex-direction: column; }
  .portfolio-filters { grid-template-columns: 1fr; }
  .portfolio-field:first-child { grid-column: auto; }
  .portfolio-item-summary { grid-template-columns: 1fr auto; align-items: start; }
  .portfolio-item-metrics { grid-column: 1 / -1; justify-content: flex-start; }
  .portfolio-item-detail { grid-template-columns: 1fr; }
  .notice-group-summary { grid-template-columns: 1fr; }
  .notice-group-meta { justify-content: flex-start; }
  .notice-group-main { align-items: flex-start; flex-direction: column; }
  .notice-group-message { max-width: 100%; white-space: normal; }
  .notice-action { grid-template-columns: 1fr; }
  .cockpit-weekly-summary { grid-template-columns: 1fr; }
  .cockpit-capability-families { grid-template-columns: 1fr; }
  .cockpit-return-summary { grid-template-columns: 1fr; }
  .cockpit-return-meta, .cockpit-open-task-head { flex-direction: column; }
  .attention-head { flex-wrap: wrap; }
  .mssr-row { grid-template-columns: 1fr 4rem; }
  .mssr-row .progress-track { grid-column: 1 / -1; grid-row: 2; }
  .tool-row { grid-template-columns: minmax(8rem, 1fr) 3.5rem; }
  .tool-row .progress-track { grid-column: 1 / -1; }
  .error-summary { grid-template-columns: 4.5rem minmax(7rem, 1fr) auto; }
  .error-message { grid-column: 1 / -1; grid-row: 2; }
  .activity-timeline-detail-grid, .activity-call-detail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .activity-recent-header { align-items: stretch; }
  .activity-recent-actions, .card-header-actions { width: 100%; justify-content: space-between; }
  .cockpit-secondary-disclosure > summary { align-items: flex-start; }
  .activity-mode-toggle { align-self: stretch; }
  .activity-mode-button { flex: 1 1 0; }
  .activity-call-summary { grid-template-columns: 1fr; }
  .activity-call-metrics { text-align: left; white-space: normal; }
  .activity-call-main { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
  .system-grid { grid-template-columns: 1fr; }
}

@media (max-width: 480px) {
  .brand-row { align-items: flex-start; flex-direction: column; gap: 0.25rem; }
  .brand h1 { font-size: 1.08rem; }
  .brand-subtitle { max-width: 15rem; }
  .updated-at { display: none; }
  .health-strip { grid-template-columns: 1fr; }
  .health-item:last-child { grid-column: auto; }
  .metric-grid { grid-template-columns: 1fr; }
  .attention-item { grid-template-columns: auto minmax(0, 1fr); }
  .attention-value { grid-column: 2; }
}

/* Human UX v2-A: shell + Inicio. Legacy v1 stays intact inside its comparison disclosure. */
[hidden] { display: none !important; }

.topbar-v2 {
  min-height: 58px;
  padding: 0.62rem 1rem;
}
.topbar-v2 .brand h1 { font-size: 1.08rem; }
.topbar-v2 .brand-subtitle { margin-top: 0.08rem; font-size: 0.74rem; }
.topbar-actions-v2 { flex-wrap: nowrap; gap: 0.5rem; }
.shell-work-status { max-width: 13rem; overflow: hidden; }
.shell-work-status > span:last-child { overflow: hidden; text-overflow: ellipsis; }
.shell-scope { color: var(--muted); font-size: 0.73rem; white-space: nowrap; }
.shell-action,
.home-action,
.home-row-action,
.inspector-close {
  border: 1px solid rgba(123,168,255,0.25);
  background: rgba(123,168,255,0.08);
  color: #d9e8ff;
  cursor: pointer;
}
.shell-action {
  min-height: 1.9rem;
  padding: 0.25rem 0.68rem;
  border-radius: 999px;
  font-size: 0.77rem;
}
.shell-action:hover,
.home-action:hover,
.home-row-action:hover { border-color: rgba(123,168,255,0.5); background: rgba(123,168,255,0.14); }
.shell-action:focus-visible,
.home-action:focus-visible,
.home-row-action:focus-visible,
.v2-tab-button:focus-visible,
.inspector-close:focus-visible,
.legacy-dashboard-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.shell-v2 {
  width: min(1260px, calc(100% - 2rem));
  padding-top: 0.65rem;
}
.v2-tabs {
  position: sticky;
  top: 58px;
  z-index: 16;
  display: flex;
  gap: 0.2rem;
  margin: 0 0 1.05rem;
  padding: 0.28rem;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: rgba(8,13,27,0.86);
  backdrop-filter: blur(14px);
}
.v2-tab-button {
  min-height: 2.25rem;
  padding: 0.35rem 0.88rem;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.84rem;
  font-weight: 620;
}
.v2-tab-button:hover { color: var(--text); background: rgba(255,255,255,0.035); }
.v2-tab-button[aria-selected="true"] {
  color: #f4f8ff;
  border-color: rgba(123,168,255,0.28);
  background: rgba(123,168,255,0.12);
}
.v2-panel { min-width: 0; }
.home-stack { display: grid; gap: 1.15rem; }
.v2-eyebrow {
  display: block;
  color: #8eb7ff;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.105em;
  text-transform: uppercase;
}
.home-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 0.4rem 0.1rem 1.15rem;
  border-bottom: 1px solid var(--line);
}
.home-hero h2,
.home-section-head h3,
.home-section-title h3,
.v2-migration-surface h2,
.v2-inspector h2 { margin: 0.22rem 0 0; }
.home-hero h2 { font-size: clamp(1.25rem, 2vw, 1.65rem); }
.home-status-sentence {
  max-width: 56rem;
  margin: 0.38rem 0 0;
  color: #cbd9f2;
  font-size: 1rem;
  line-height: 1.5;
}
.home-hero-meta { display: flex; gap: 0.45rem; flex: 0 0 auto; }
.home-chip {
  display: inline-flex;
  align-items: center;
  min-height: 1.8rem;
  padding: 0.25rem 0.64rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(255,255,255,0.025);
  font-size: 0.76rem;
  white-space: nowrap;
}
.home-primary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(290px, 0.9fr);
  align-items: start;
  gap: 0.9rem;
}
.home-surface,
.v2-migration-surface {
  min-width: 0;
  padding: 1rem 1.05rem;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: rgba(18,26,47,0.58);
}
.home-continue-surface { background: linear-gradient(145deg, rgba(25,40,68,0.72), rgba(15,23,42,0.58)); }
.home-attention-surface { background: rgba(18,24,41,0.62); }
.home-section-head,
.home-section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.home-section-head h3,
.home-section-title h3 { font-size: 1rem; }
.home-project-label { margin-top: 0.55rem; color: var(--accent-strong); font-size: 0.78rem; font-weight: 650; }
.home-continue-summary { max-width: 54rem; margin: 0.45rem 0 0.85rem; color: #c3d0e7; line-height: 1.48; }
.home-continue-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: 0.7rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
}
.home-continue-footer > div { display: grid; gap: 0.18rem; min-width: 0; }
.home-continue-footer strong { overflow: hidden; color: #e8effd; font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }
.home-meta-label { color: var(--faint); font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; }
.home-action {
  min-height: 2.05rem;
  padding: 0.35rem 0.72rem;
  border-radius: 9px;
  font-size: 0.78rem;
  font-weight: 650;
}
.home-action.secondary { border-color: var(--line-strong); background: rgba(255,255,255,0.035); color: var(--muted); }
.home-attention-list { display: grid; gap: 0; margin-top: 0.65rem; }
.home-attention-row,
.home-attention-clear {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.6rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--line);
}
.home-attention-list > :first-child { border-top: 0; }
.home-attention-row > div,
.home-attention-clear > div { display: grid; gap: 0.18rem; min-width: 0; }
.home-attention-row strong,
.home-attention-clear strong { font-size: 0.82rem; }
.home-attention-row span:not(.dot),
.home-attention-clear span:not(.dot) { color: var(--muted); font-size: 0.74rem; line-height: 1.4; }
.home-row-action {
  min-height: 1.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 8px;
  font-size: 0.7rem;
}
.home-empty { padding: 0.75rem 0; color: var(--muted); font-size: 0.78rem; }
.home-pulse-section,
.home-changes-section { padding: 0.15rem 0.1rem 0; }
.home-section-note { color: var(--faint); font-size: 0.72rem; }
.home-pulse-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-top: 0.7rem;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.home-pulse-card {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
  padding: 0.85rem 0.9rem;
  border-left: 1px solid var(--line);
}
.home-pulse-card:first-child { border-left: 0; }
.home-pulse-card[data-tone="ok"] strong { color: #b8f5d1; }
.home-pulse-card[data-tone="warn"] strong { color: #ffe0a0; }
.home-pulse-card[data-tone="bad"] strong { color: #ffb6bf; }
.home-pulse-card[data-tone="info"] strong { color: #e9f1ff; }
.home-pulse-label { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; }
.home-pulse-card strong { overflow: hidden; font-size: 1.18rem; text-overflow: ellipsis; white-space: nowrap; }
.home-pulse-note { color: var(--faint); font-size: 0.7rem; line-height: 1.35; }
.home-changes { display: grid; margin-top: 0.55rem; }
.home-change-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.65rem;
  padding: 0.66rem 0;
  border-top: 1px solid var(--line);
}
.home-change-row:first-child { border-top: 0; }
.home-change-main { display: grid; gap: 0.1rem; min-width: 0; }
.home-change-label { color: var(--accent-strong); font-size: 0.68rem; font-weight: 650; }
.home-change-main strong { font-size: 0.82rem; }
.home-change-main > span:last-child { overflow: hidden; color: var(--muted); font-size: 0.73rem; text-overflow: ellipsis; white-space: nowrap; }
.home-change-row time { color: var(--faint); font-size: 0.7rem; white-space: nowrap; }
.v2-migration-surface { max-width: 760px; margin: 0.5rem auto 1.4rem; padding: 1.25rem; }
.v2-migration-surface p { color: var(--muted); line-height: 1.55; }
.v2-migration-actions { display: flex; gap: 0.55rem; flex-wrap: wrap; }

.work-stack { display: grid; gap: 1.15rem; }
.work-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0.1rem 1rem;
  border-bottom: 1px solid var(--line);
}
.work-hero h2, .work-section-title h3 { margin: 0.2rem 0 0; }
.work-hero h2 { font-size: clamp(1.25rem, 2vw, 1.65rem); }
.work-status-sentence { max-width: 58rem; margin: 0.38rem 0 0; color: #cbd9f2; font-size: 0.94rem; line-height: 1.5; }
.work-range-group, .work-filter-group {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.16rem;
  padding: 0.2rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255,255,255,0.025);
}
.work-range-button, .work-filter-button {
  min-height: 1.9rem;
  padding: 0.28rem 0.62rem;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 650;
  cursor: pointer;
}
.work-range-button:hover, .work-filter-button:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.work-range-button[aria-pressed="true"], .work-filter-button[aria-pressed="true"] {
  border-color: rgba(123,168,255,0.24);
  background: rgba(123,168,255,0.12);
  color: #f0f5ff;
}
.work-active-section, .work-projects-section, .work-timeline-section { min-width: 0; }
.work-section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}
.work-section-title h3 { font-size: 1rem; }
.work-section-title-wrap { align-items: flex-end; }
.work-section-note { display: block; margin-top: 0.16rem; color: var(--faint); font-size: 0.7rem; }
.work-active-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }
.work-task-card {
  min-width: 0;
  padding: 0.9rem 0.95rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(18,26,47,0.5);
}
.work-task-card.work-task-primary { background: linear-gradient(145deg, rgba(25,40,68,0.72), rgba(15,23,42,0.56)); }
.work-task-card[data-tone="warn"] { border-color: rgba(255,190,83,0.26); }
.work-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.work-task-head > div { display: grid; gap: 0.15rem; min-width: 0; }
.work-task-project { color: var(--accent-strong); font-size: 0.7rem; font-weight: 650; }
.work-task-head strong { overflow: hidden; font-size: 0.92rem; text-overflow: ellipsis; white-space: nowrap; }
.work-task-card > p { display: -webkit-box; margin: 0.55rem 0 0.7rem; overflow: hidden; color: #c3d0e7; font-size: 0.78rem; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.work-task-signals { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.7rem; }
.work-task-attention, .work-task-git, .work-project-git, .work-project-blocker {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  width: fit-content;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: rgba(255,190,83,0.08);
  color: #f2d9a1;
  font-size: 0.68rem;
}
.work-task-attention-info, .work-task-git[data-tone="info"], .work-project-git[data-tone="info"] { background: rgba(123,168,255,0.08); color: #bdd4ff; }
.work-task-footer { display: flex; align-items: end; justify-content: space-between; gap: 0.75rem; padding-top: 0.65rem; border-top: 1px solid var(--line); }
.work-task-footer > div { display: grid; gap: 0.12rem; min-width: 0; }
.work-task-footer span, .work-project-next > span { color: var(--faint); font-size: 0.65rem; letter-spacing: 0.06em; text-transform: uppercase; }
.work-task-footer strong { color: #edf3ff; font-size: 0.76rem; }
.work-task-footer time { color: var(--faint); font-size: 0.68rem; white-space: nowrap; }
.work-empty-current { display: grid; gap: 0.2rem; grid-column: 1 / -1; }
.work-empty-current strong { color: var(--text); }
.work-secondary-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(310px, 0.75fr); align-items: start; gap: 1rem; }
.work-projects-section, .work-timeline-section { padding-top: 0.95rem; border-top: 1px solid var(--line); }
.work-project-list, .work-timeline { display: grid; gap: 0; }
.work-project-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 0.28fr);
  gap: 0.9rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--line);
}
.work-project-row:first-child, .work-event-row:first-child { border-top: 0; }
.work-project-main { min-width: 0; }
.work-project-head { display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; }
.work-project-head strong { min-width: 0; overflow: hidden; font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }
.work-project-main > p { display: -webkit-box; margin: 0.28rem 0 0; overflow: hidden; color: var(--muted); font-size: 0.73rem; line-height: 1.42; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.work-project-blocker { margin-top: 0.38rem; }
.work-project-next { display: grid; align-content: start; gap: 0.18rem; min-width: 0; text-align: right; }
.work-project-next strong { color: #e8effd; font-size: 0.73rem; overflow-wrap: anywhere; }
.work-project-next small, .work-project-next > span:not(:first-child) { color: var(--faint); font-size: 0.66rem; }
.work-project-next .work-project-git { justify-self: end; margin-top: 0.16rem; }
.work-event-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.58rem;
  padding: 0.64rem 0;
  border-top: 1px solid var(--line);
}
.work-event-main { display: grid; gap: 0.1rem; min-width: 0; }
.work-event-main > span { color: var(--accent-strong); font-size: 0.66rem; font-weight: 650; }
.work-event-main strong { font-size: 0.76rem; overflow-wrap: anywhere; }
.work-event-main small { color: var(--muted); font-size: 0.7rem; line-height: 1.38; }
.work-event-row time { color: var(--faint); font-size: 0.66rem; white-space: nowrap; }
.work-evidence-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding: 0.7rem 0.1rem 0; border-top: 1px dashed var(--line); color: var(--faint); font-size: 0.7rem; }
.legacy-dashboard { margin-top: 1.3rem; scroll-margin-top: 7rem; }
.legacy-dashboard-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0.85rem;
  border: 1px dashed rgba(147,165,199,0.27);
  border-radius: 11px;
  color: var(--muted);
  background: rgba(255,255,255,0.018);
  cursor: pointer;
  list-style: none;
}
.legacy-dashboard-summary::-webkit-details-marker { display: none; }
.legacy-dashboard-summary > span:first-child { display: grid; gap: 0.14rem; }
.legacy-dashboard-summary strong { color: #bcc9de; font-size: 0.8rem; }
.legacy-summary-hint { color: var(--faint); font-size: 0.7rem; }
.legacy-dashboard[open] > .legacy-dashboard-summary { margin-bottom: 0.8rem; }
.legacy-dashboard-body { padding-top: 0.15rem; }
.legacy-dashboard .tabs { top: 58px; }

.v2-inspector-backdrop {
  position: fixed;
  inset: 0;
  z-index: 59;
  background: rgba(3,7,18,0.56);
  backdrop-filter: blur(2px);
}
.v2-inspector {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  width: min(430px, calc(100vw - 24px));
  padding: 1rem;
  overflow: auto;
  border-left: 1px solid var(--line-strong);
  background: #0c1324;
  box-shadow: -24px 0 70px rgba(0,0,0,0.38);
}
.v2-inspector-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.inspector-close {
  width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 9px;
  font-size: 1.25rem;
  line-height: 1;
}
.v2-inspector-intro { color: var(--muted); font-size: 0.8rem; line-height: 1.5; }
.v2-inspector-grid { display: grid; gap: 0; margin-top: 1rem; border-top: 1px solid var(--line); }
.v2-inspector-grid > div { display: grid; gap: 0.24rem; padding: 0.75rem 0; border-bottom: 1px solid var(--line); }
.v2-inspector-grid span { color: var(--faint); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em; }
.v2-inspector-grid strong,
.v2-inspector-grid code { overflow-wrap: anywhere; color: #dce7fa; font-size: 0.78rem; }
body.inspector-open { overflow: hidden; }

@media (max-width: 900px) {
  .topbar-actions-v2 .shell-scope,
  .topbar-actions-v2 .updated-at { display: none; }
  .home-primary-grid { grid-template-columns: 1fr; }
  .home-pulse-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .home-pulse-card:nth-child(3) { border-left: 0; border-top: 1px solid var(--line); }
  .home-pulse-card:nth-child(4) { border-top: 1px solid var(--line); }
  .work-secondary-grid { grid-template-columns: 1fr; }
  .work-active-list { grid-template-columns: 1fr; }
}

@media (max-width: 720px) {
  .topbar.topbar-v2 {
    position: sticky;
    top: 0;
    min-height: 52px;
    padding: 0.5rem 0.65rem;
    align-items: center;
    flex-direction: row;
    gap: 0.45rem;
  }
  .topbar-v2 .brand { flex: 1 1 auto; }
  .topbar-v2 .brand-row { gap: 0.4rem; }
  .topbar-v2 .brand h1 { font-size: 1rem; }
  .topbar-v2 .brand-subtitle { display: none; }
  .topbar-v2 .topbar-actions {
    width: auto;
    margin-left: auto;
    align-items: center;
    justify-content: flex-end;
    flex-direction: row;
    gap: 0.35rem;
  }
  .topbar-v2 .shell-work-status,
  .topbar-v2 .shell-scope,
  .topbar-v2 .updated-at { display: none; }
  .topbar-v2 #overall-status { min-height: 1.7rem; padding: 0.2rem 0.5rem; font-size: 0.7rem; }
  .topbar-v2 .shell-action { min-height: 1.7rem; padding: 0.2rem 0.5rem; font-size: 0.7rem; }
  .shell.shell-v2 { width: calc(100% - 0.8rem); padding-top: 0.35rem; }
  .v2-tabs {
    top: 52px;
    margin-bottom: 0.72rem;
    padding: 0.2rem;
    gap: 0.08rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .v2-tabs::-webkit-scrollbar { display: none; }
  .v2-tab-button { flex: 1 1 0; min-width: 0; min-height: 2.15rem; padding: 0.3rem 0.38rem; font-size: 0.75rem; }
  .home-stack { gap: 0.85rem; }
  .home-hero { align-items: flex-start; flex-direction: column; gap: 0.65rem; padding: 0.2rem 0.15rem 0.82rem; }
  .home-hero h2 { font-size: 1.22rem; }
  .home-status-sentence { margin-top: 0.28rem; font-size: 0.9rem; }
  .home-hero-meta { width: 100%; }
  .home-chip { flex: 1 1 0; justify-content: center; }
  .home-surface { padding: 0.85rem; border-radius: 13px; }
  .home-section-head { align-items: flex-start; }
  .home-continue-footer { grid-template-columns: 1fr 1fr; }
  .home-continue-footer .home-action { grid-column: 1 / -1; width: 100%; }
  .home-pulse-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .home-pulse-card { padding: 0.72rem 0.65rem; }
  .home-pulse-card strong { font-size: 1.02rem; }
  .home-section-title { align-items: flex-end; }
  .home-section-note { max-width: 8rem; text-align: right; }
  .home-change-main > span:last-child { white-space: normal; }
  .work-stack { gap: 0.85rem; }
  .work-hero { align-items: flex-start; flex-direction: column; gap: 0.65rem; padding: 0.2rem 0.1rem 0.82rem; }
  .work-hero h2 { font-size: 1.22rem; }
  .work-status-sentence { margin-top: 0.28rem; font-size: 0.88rem; }
  .work-range-group { width: 100%; }
  .work-range-button { flex: 1 1 0; padding-inline: 0.3rem; }
  .work-section-title-wrap { align-items: flex-start; flex-direction: column; }
  .work-filter-group { width: 100%; }
  .work-filter-button { flex: 1 1 0; }
  .work-task-head { gap: 0.5rem; }
  .work-project-row { grid-template-columns: 1fr; gap: 0.45rem; }
  .work-project-next { text-align: left; }
  .work-project-next .work-project-git { justify-self: start; }
  .work-evidence-footer { align-items: flex-start; flex-direction: column; }
  .work-evidence-footer .home-action { width: 100%; }
  .legacy-dashboard { margin-top: 0.9rem; }
  .legacy-dashboard-summary { align-items: flex-start; padding: 0.65rem 0.7rem; }
  .legacy-summary-hint { max-width: 7rem; text-align: right; }
  .legacy-dashboard .tabs { top: 100px; }
}

@media (max-width: 480px) {
  .topbar-v2 .brand-row { flex-direction: row; align-items: center; }
  .topbar-v2 .brand-version { display: none; }
  .topbar-v2 #overall-status .dot { width: 0.48rem; height: 0.48rem; }
  .topbar-v2 #overall-status { max-width: 7rem; }
  .topbar-v2 #overall-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .home-primary-grid { gap: 0.65rem; }
  .home-continue-footer { grid-template-columns: 1fr; }
  .home-continue-footer .home-action { grid-column: auto; }
  .home-attention-row { grid-template-columns: auto minmax(0, 1fr); }
  .home-row-action { grid-column: 2; justify-self: start; }
  .home-change-row { grid-template-columns: auto minmax(0, 1fr); }
  .home-change-row time { grid-column: 2; }
  .home-section-note { display: none; }
  .v2-inspector { width: calc(100vw - 12px); padding: 0.85rem; }
}
`;
