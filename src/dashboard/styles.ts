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

.mssr-list { display: grid; gap: 0.78rem; padding: 0.75rem 1rem 1rem; }
.mssr-row { display: grid; grid-template-columns: minmax(12rem, 1.3fr) minmax(10rem, 2fr) 5rem; align-items: center; gap: 0.9rem; }
.mssr-label strong { display: block; font-size: 0.82rem; }
.mssr-label span { display: block; margin-top: 0.14rem; color: var(--muted); font-size: 0.69rem; }
.mssr-value { text-align: right; font-size: 0.8rem; font-weight: 720; font-variant-numeric: tabular-nums; }

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

.inline-note { color: var(--muted); font-size: 0.72rem; }
.muted { color: var(--muted); }
.small { font-size: 0.72rem; }
.no-margin { margin: 0; }

@media (max-width: 1100px) {
  .health-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
  .attention-head { flex-wrap: wrap; }
  .mssr-row { grid-template-columns: 1fr 4rem; }
  .mssr-row .progress-track { grid-column: 1 / -1; grid-row: 2; }
  .tool-row { grid-template-columns: minmax(8rem, 1fr) 3.5rem; }
  .tool-row .progress-track { grid-column: 1 / -1; }
  .error-summary { grid-template-columns: 4.5rem minmax(7rem, 1fr) auto; }
  .error-message { grid-column: 1 / -1; grid-row: 2; }
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
`;
