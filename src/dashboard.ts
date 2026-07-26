import { renderDashboardDocument } from "./dashboard/document.js";
import { dashboardMarkup } from "./dashboard/markup.js";
import { dashboardScript } from "./dashboard/script.js";
import { dashboardStyles } from "./dashboard/styles.js";

export function renderDashboardHtml(): string {
  return renderDashboardDocument({
    title: "Bridge MCP Dashboard",
    body: dashboardMarkup,
    styles: dashboardStyles,
    script: dashboardScript,
  });
}
