#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const command = process.argv[2] || "summary";
const limit = Math.max(1, Math.min(Number.parseInt(process.argv[3] || "25", 10) || 25, 200));
const dbPath = path.resolve(process.env.BRIDGE_MCP_METRICS_SQLITE || "data/bridge-metrics.sqlite");

if (!fs.existsSync(dbPath)) {
  console.error(`Metrics database not found: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

if (command === "status") {
  const row = db.prepare("SELECT COUNT(*) AS calls, MIN(started_at) AS first_started_at, MAX(started_at) AS last_started_at FROM tool_calls").get();
  console.log(JSON.stringify({ dbPath, ...row }, null, 2));
} else if (command === "recent") {
  const rows = db.prepare(`
    SELECT started_at, duration_ms, tool, ok, error, input_keys, output_chars, pid
    FROM tool_calls
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);
  console.table(rows);
} else if (command === "errors") {
  const rows = db.prepare(`
    SELECT started_at, duration_ms, tool, error, input_keys, pid
    FROM tool_calls
    WHERE ok = 0
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);
  console.table(rows);
} else {
  const rows = db.prepare(`
    SELECT tool, calls, ok_calls, error_calls, avg_duration_ms, max_duration_ms, last_started_at
    FROM tool_call_summary
    ORDER BY calls DESC, tool ASC
    LIMIT ?
  `).all(limit);
  console.table(rows);
}
