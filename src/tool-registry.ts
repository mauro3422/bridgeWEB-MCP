import { binaryFileToolModule } from "./tools/binary-file-tools.js";
import { blenderToolModule } from "./tools/blender-tools.js";
import { bridgeOpsToolModule } from "./tools/bridge-ops.js";
import { bridgeWorkflowToolModule } from "./tools/bridge-workflow.js";
import { cacheToolModule } from "./tools/cache-tools.js";
import { codeGraphToolModule } from "./tools/code-graph.js";
import { codeIntelligenceToolModule } from "./tools/code-intelligence.js";
import { coreToolModule } from "./tools/core-tools.js";
import { fileNavigationToolModule } from "./tools/file-navigation.js";
import { fileWritingToolModule } from "./tools/file-writing.js";
import { gitToolModule } from "./tools/git-tools.js";
import { godotToolModule } from "./tools/godot-tools.js";
import { imageToolModule } from "./tools/image-tools.js";
import { metricsToolModule } from "./tools/metrics-tools.js";
import { mssrObservatoryToolModule } from "./tools/mssr-observatory-tools.js";
import { noticeToolModule } from "./tools/notice-tools.js";
import { processToolModule } from "./tools/process-tools.js";
import { projectToolModule } from "./tools/project-tools.js";
import { pythonToolModule } from "./tools/python-tools.js";
import { robloxPhotoCaptureToolModule } from "./tools/roblox-photo-capture-tools.js";
import { robloxAssetToolModule } from "./tools/roblox-asset-tools.js";
import { robloxStudioToolModule } from "./tools/roblox-studio-tools.js";
import { skillCatalogToolModule } from "./tools/skill-catalog-tools.js";
import { workspaceToolModule } from "./tools/workspace-tools.js";
import { workflowGuideToolModule } from "./tools/workflow-guide-tools.js";
import { whiteboardToolModule } from "./tools/whiteboard-tools.js";
import { buildToolAudit, TOOL_AUDIT_VIEWS, type ToolAuditArgs, type ToolAuditView } from "./tool-audit.js";
import { getToolAuditMetrics, type BridgeMetricsScope } from "./metrics.js";
import type { BridgeToolMetadata, BridgeToolModule, BridgeToolRegistry, BridgeToolSchema, BridgeToolUsageGuidance } from "./tools/types.js";

const readOnlyToolNames = new Set([
  "system_info", "list_dir", "read_text_file", "list_files_smart", "read_file_lines", "read_many_files", "search_files",
  "terminal_read", "terminal_list", "work_peek", "work_show",
  "git_status", "git_diff", "git_log", "git_show_commit", "git_compare_branches",
  "tunnel_health", "bridge_health", "bridge_connector_catalog_compare", "bridge_self_check", "bridge_restart_status",
  "bridge_metrics_status", "bridge_metrics_summary", "bridge_metrics_recent", "bridge_metrics_query", "mssr_observatory_query", "mssr_trace_evidence", "bridge_visualization_catalog", "bridge_visualize_metrics", "bridge_notice_status", "bridge_notice_drain",
  "path_policy_status", "project_profile", "workspace_diff", "workspace_snapshot_list", "cache_status",
  "analyze_code", "impact_analysis", "find_duplicate_symbols", "import_graph", "dependency_graph", "call_graph", "find_dead_code",
  "project_context_load", "workflow_guide_recommend", "workflow_guide_load", "bridge_tool_schema", "bridge_tool_audit", "bridge_tool_query",
  "skill_catalog", "skill_recommend", "skill_route_audit", "skill_route_vocabulary", "skill_route_plan", "skill_bootstrap", "skill_load", "roblox_mcp_status", "roblox_mcp_tool_list", "roblox_mcp_studio_list", "roblox_mcp_query",
  "binary_file_info", "binary_file_read_chunk", "binary_upload_status", "image_file_attach",
  "blender_status", "blender_scene_info", "blender_character_loop_status",
  "godot_mcp_status", "godot_mcp_tool_list", "godot_mcp_instance_list", "godot_mcp_query",
  "whiteboard_latest_capture", "whiteboard_capture_list",
  "python_validate", "python_symbols", "python_impact_analysis", "python_import_graph", "python_call_graph", "python_dead_code", "python_test_plan", "pytest_testmon",
]);

const destructiveToolNames = new Set([
  "write_text_file", "apply_patch", "edit_lines", "run_command", "terminal_start", "terminal_write", "terminal_stop",
  "work_once", "work_begin", "work_feed", "work_finish",
  "git_create_branch", "git_restore_file", "git_set_remote", "git_commit_all", "git_push_current_branch",
  "project_profile_save", "workspace_snapshot", "workspace_rollback", "cache_prune",
  "bridge_request_restart", "bridge_verify_all", "workflow_guide_create", "bridge_tool_action", "roblox_mcp_action", "roblox_studio_window_capture_save", "roblox_screen_capture_save", "roblox_photo_capture_job", "roblox_place_save",
  "roblox_asset_upload",
  "image_asset_save", "image_character_views_prepare",
  "binary_file_write", "binary_upload_begin", "binary_upload_append", "binary_upload_finish", "binary_upload_abort",
  "blender_open", "blender_viewport_screenshot", "blender_review_bundle", "blender_execute_code", "blender_batch_script", "blender_store_reference_image", "blender_setup_character_references",
  "godot_mcp_action", "godot_screen_capture_save",
]);

const aliasTargets = new Map<string, string>([
  ["work_once", "run_command"],
  ["work_begin", "terminal_start"],
  ["work_feed", "terminal_write"],
  ["work_peek", "terminal_read"],
  ["work_show", "terminal_list"],
  ["work_finish", "terminal_stop"],
]);

const fallbackToolNames = new Set(["bridge_tool_query", "bridge_tool_action"]);
const aggregatorToolNames = new Set(["bridge_metrics_query", "bridge_verify_all", "bridge_health", "bridge_self_check", "skill_bootstrap"]);
const providerProxyToolNames = new Set([
  "roblox_mcp_status", "roblox_mcp_tool_list", "roblox_mcp_studio_list", "roblox_mcp_query", "roblox_mcp_action",
  "godot_mcp_status", "godot_mcp_tool_list", "godot_mcp_instance_list", "godot_mcp_query", "godot_mcp_action",
]);
const protectedToolNames = new Set([
  "bridge_tool_schema", "bridge_tool_audit", "bridge_tool_query", "bridge_tool_action", "bridge_connector_catalog_compare", "project_context_load",
  "skill_route_plan", "skill_bootstrap", "skill_load", "mssr_trace_record", "mssr_trace_evidence", "bridge_verify_all", "roblox_place_save",
]);

const toolUsageGuidance = new Map<string, BridgeToolUsageGuidance>([
  ["project_context_load", {
    prerequisites: ["Use once at the start of substantial work in a known repository."],
    preflightTools: ["skill_bootstrap"],
    recovery: [{ code: "mssr-unrouted-tool-call", toolName: "skill_bootstrap", instruction: "Bootstrap the current MSSR phase with structured intent so required skills are loaded automatically." }],
  }],
  ["skill_route_plan", {
    prerequisites: ["Provide structured intent with at least one non-nominal signal when friction or uncertainty exists."],
    preflightTools: ["skill_bootstrap"],
    recovery: [{ code: "mssr-required-skill-not-loaded", toolName: "skill_bootstrap", instruction: "Call skill_bootstrap with the returned traceId to load the full current phase automatically." }],
  }],
  ["skill_load", {
    prerequisites: ["Pass the traceId returned by skill_route_plan or skill_bootstrap whenever one exists."],
    preflightTools: ["skill_bootstrap"],
    recovery: [
      { code: "mssr-orphan-skill-load", toolName: "skill_bootstrap", instruction: "Bootstrap the active phase instead of loading an unscoped skill, or retry skill_load with an explicit traceId." },
      { code: "mssr-trace-ambiguous", toolName: "mssr_observatory_query", instruction: "Inspect open traces and retry with one explicit traceId; never guess between concurrent tasks." },
    ],
  }],
  ["terminal_read", {
    prerequisites: ["Use a sessionId returned by terminal_start or terminal_list."],
    preflightTools: ["terminal_list"],
    recovery: [{ code: "target-not-found", toolName: "terminal_list", instruction: "List active terminal sessions and retry with a returned sessionId." }],
  }],
  ["terminal_write", {
    prerequisites: ["Use a live sessionId returned by terminal_start or terminal_list."],
    preflightTools: ["terminal_list"],
    recovery: [{ code: "target-not-found", toolName: "terminal_list", instruction: "List active terminal sessions before sending input." }],
  }],
  ["terminal_stop", {
    prerequisites: ["Use a live sessionId returned by terminal_start or terminal_list."],
    preflightTools: ["terminal_list"],
    recovery: [{ code: "target-not-found", toolName: "terminal_list", instruction: "List active terminal sessions; an expired session does not mean terminal_stop is broken." }],
  }],
  ["workspace_diff", {
    prerequisites: ["Use a snapshotId returned by workspace_snapshot or workspace_snapshot_list."],
    preflightTools: ["workspace_snapshot_list"],
    recovery: [{ code: "target-not-found", toolName: "workspace_snapshot_list", instruction: "List snapshots and retry with an existing snapshotId." }],
  }],
  ["workspace_rollback", {
    prerequisites: ["Use an exact snapshotId returned by workspace_snapshot or workspace_snapshot_list and repeat it in confirmSnapshotId."],
    preflightTools: ["workspace_snapshot_list", "workspace_diff"],
    recovery: [{ code: "target-not-found", toolName: "workspace_snapshot_list", instruction: "Resolve an existing snapshot before rollback; do not invent IDs." }],
  }],
  ["binary_upload_append", {
    prerequisites: ["Use an uploadId returned by binary_upload_begin."],
    preflightTools: ["binary_upload_status"],
    recovery: [{ code: "target-not-found", toolName: "binary_upload_status", instruction: "Inspect the resumable upload state and retry with its uploadId." }],
  }],
  ["binary_upload_finish", {
    prerequisites: ["Use an uploadId returned by binary_upload_begin and verify all expected chunks are present."],
    preflightTools: ["binary_upload_status"],
    recovery: [{ code: "target-not-found", toolName: "binary_upload_status", instruction: "Inspect the upload state before finishing it." }],
  }],
  ["bridge_tool_query", {
    prerequisites: ["Use only when the dedicated connector schema is absent. When MSSR routing already supplied an exact delegated fallback, invoke it immediately; inspect bridge_tool_schema only after validation failure or when arguments are unknown. Pass the active traceId at wrapper level when stateless or concurrent caller metadata cannot identify one open MSSR trace."],
    preflightTools: ["bridge_tool_schema"],
    recovery: [{ code: "schema-validation", toolName: "bridge_tool_schema", instruction: "Read the exact runtime schema and rebuild arguments without inventing fields or enums." }],
  }],
  ["bridge_tool_action", {
    prerequisites: ["Use only when the dedicated connector schema is absent and confirmToolName exactly matches toolName. When MSSR routing already supplied an exact delegated fallback, invoke it immediately; inspect bridge_tool_schema only after validation failure or when arguments are unknown. Pass the active traceId at wrapper level when stateless or concurrent caller metadata cannot identify one open MSSR trace."],
    preflightTools: ["bridge_tool_schema"],
    recovery: [
      { code: "schema-validation", toolName: "bridge_tool_schema", instruction: "Read the exact runtime schema before retrying the delegated action." },
      { code: "permission-or-risk-mismatch", toolName: "bridge_tool_schema", instruction: "Inspect the target annotations and choose bridge_tool_query for read-only tools or bridge_tool_action for mutable tools." },
    ],
  }],
  ["roblox_mcp_query", {
    prerequisites: ["Inspect the live Roblox tool schema and active Studio before invoking a remote query."],
    preflightTools: ["roblox_mcp_status", "roblox_mcp_tool_list", "roblox_mcp_studio_list"],
    recovery: [{ code: "provider-unavailable", toolName: "roblox_mcp_status", instruction: "Refresh Roblox MCP health and live Studio state before retrying." }],
  }],
  ["roblox_mcp_action", {
    prerequisites: ["Inspect the live schema, verify the active Studio and repeat the exact remote tool name in confirmToolName."],
    preflightTools: ["roblox_mcp_status", "roblox_mcp_tool_list", "roblox_mcp_studio_list"],
    recovery: [{ code: "provider-unavailable", toolName: "roblox_mcp_status", instruction: "Recover the live Roblox MCP connection and re-inspect the schema before mutating." }],
  }],
  ["godot_mcp_query", {
    prerequisites: ["Inspect the live localhost Godot provider catalog and connected project identity before dispatch."],
    preflightTools: ["godot_mcp_status", "godot_mcp_tool_list", "godot_mcp_instance_list"],
    recovery: [{ code: "provider-unavailable", toolName: "godot_mcp_status", instruction: "Start or recover the local Godot provider and verify the editor connection before retrying." }],
  }],
  ["godot_mcp_action", {
    prerequisites: ["Inspect the live tool schema and connected project identity. This dedicated action does not require a separate user confirmation for each Godot operation."],
    preflightTools: ["godot_mcp_status", "godot_mcp_tool_list", "godot_mcp_instance_list"],
    recovery: [{ code: "provider-unavailable", toolName: "godot_mcp_status", instruction: "Start the full local Godot provider, connect the intended project, and retry the exact action." }],
  }],
  ["godot_screen_capture_save", {
    prerequisites: ["Verify a runtime instance is connected before requesting a capture."],
    preflightTools: ["godot_mcp_status", "godot_mcp_instance_list"],
    recovery: [{ code: "provider-unavailable", toolName: "godot_mcp_status", instruction: "Run the Godot project with the MCPRuntime autoload and verify the local runtime connection." }],
  }],
  ["roblox_asset_upload", {
    prerequisites: ["Configure ROBLOX_OPEN_CLOUD_API_KEY with Assets Read/Write permission for the exact creator.", "Verify local file hashes and repeat the exact creator id before upload."],
    preflightTools: ["binary_file_info", "roblox_mcp_status"],
    recovery: [{ code: "missing-capability", instruction: "Create or configure a Roblox Open Cloud API key with Assets Read/Write permission; never pass the secret as a tool argument." }],
  }],
  ["blender_execute_code", {
    prerequisites: ["Verify the interactive Blender bridge is connected before executing code."],
    preflightTools: ["blender_status", "blender_scene_info"],
    recovery: [{ code: "provider-unavailable", toolName: "blender_status", instruction: "Check or restore the Blender bridge before retrying." }],
  }],
  ["git_push_current_branch", {
    prerequisites: ["Verify the working tree, commit content, tracking branch and remote before push."],
    preflightTools: ["git_status", "git_show_commit", "git_compare_branches"],
    recovery: [{ code: "target-not-found", toolName: "git_status", instruction: "Verify repository root, branch and remote configuration before retrying push." }],
  }],
]);

for (const [alias, canonical] of aliasTargets) {
  const canonicalUsage = toolUsageGuidance.get(canonical);
  if (canonicalUsage && !toolUsageGuidance.has(alias)) toolUsageGuidance.set(alias, canonicalUsage);
}

function toolMetadata(tool: BridgeToolSchema, moduleName: string): BridgeToolMetadata {
  const aliasOf = aliasTargets.get(tool.name);
  const role = aliasOf
    ? "alias"
    : fallbackToolNames.has(tool.name)
      ? "fallback"
      : providerProxyToolNames.has(tool.name)
        ? "provider-proxy"
        : aggregatorToolNames.has(tool.name)
          ? "aggregator"
          : "dedicated";
  return {
    role,
    family: moduleName,
    lifecycle: protectedToolNames.has(tool.name) ? "protected" : "stable",
    ...(aliasOf ? { aliasOf, preferredTool: aliasOf } : {}),
    ...(toolUsageGuidance.has(tool.name) ? { usage: toolUsageGuidance.get(tool.name) } : {}),
    ...(tool.metadata ?? {}),
  };
}

function annotateTool(tool: BridgeToolSchema, moduleName: string): BridgeToolSchema {
  const annotations = readOnlyToolNames.has(tool.name)
    ? { readOnlyHint: true, destructiveHint: false, ...(tool.annotations ?? {}) }
    : destructiveToolNames.has(tool.name)
      ? { readOnlyHint: false, destructiveHint: true, ...(tool.annotations ?? {}) }
      : { readOnlyHint: false, destructiveHint: false, ...(tool.annotations ?? {}) };
  return { ...tool, annotations, metadata: toolMetadata(tool, moduleName) };
}

function riskSummary(tools: BridgeToolSchema[]) {
  return {
    readOnly: tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name),
    destructive: tools.filter((tool) => tool.annotations?.destructiveHint).map((tool) => tool.name),
    neutral: tools.filter((tool) => !tool.annotations?.readOnlyHint && !tool.annotations?.destructiveHint).map((tool) => tool.name),
  };
}

export function createToolRegistry(modules: readonly BridgeToolModule[]): BridgeToolRegistry {
  const tools: BridgeToolSchema[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>();
  const moduleNames: string[] = [];

  for (const module of modules) {
    moduleNames.push(module.name);
    for (const tool of module.tools) {
      if (handlers.has(tool.name)) throw new Error(`Duplicate bridge tool registered: ${tool.name}`);
      const handler = module.handlers[tool.name];
      if (!handler) throw new Error(`Tool module '${module.name}' declares '${tool.name}' without a handler.`);
      tools.push(annotateTool(tool, module.name));
      handlers.set(tool.name, handler);
    }
  }

  const proxyToolNames = new Set(["bridge_tool_query", "bridge_tool_action"]);
  const delegatedArguments = (value: unknown): Record<string, unknown> => {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be a JSON object.");
    return value as Record<string, unknown>;
  };
  const delegatedToolName = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim()) throw new Error("toolName must be a non-empty string.");
    const name = value.trim();
    if (proxyToolNames.has(name)) throw new Error(`Recursive delegation to '${name}' is not allowed.`);
    if (!handlers.has(name)) throw new Error(`Unknown modular tool: ${name}`);
    return name;
  };

  moduleNames.push("tool-dispatch");
  const schemaTool: BridgeToolSchema = {
    name: "bridge_tool_schema",
    description: "Inspect the exact runtime description, input schema, and safety annotations for one Bridge tool before using a delegated fallback. Use this first when the dedicated connector schema is missing.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact runtime tool name to inspect." },
      },
      required: ["toolName"],
      additionalProperties: false,
    },
  };
  const auditTool: BridgeToolSchema = {
    name: "bridge_tool_audit",
    description: "Audit registered Bridge tools against privacy-safe operational metrics and return evidence-backed maintenance recommendations. Use views for one tool, aliases, fallback overuse, unused tools, all tools, or only items needing attention. This tool never changes lifecycle or visibility automatically.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: TOOL_AUDIT_VIEWS, default: "needs-attention" },
        toolName: { type: "string", description: "Exact registered tool name; required when view=tool." },
        scope: { type: "string", enum: ["active", "all"], default: "active" },
        days: { type: "number", default: 30, minimum: 1, maximum: 365 },
        limit: { type: "number", default: 50, minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  };
  const queryTool: BridgeToolSchema = {
    name: "bridge_tool_query",
    description: "Use this read-only fallback immediately when a runtime Bridge tool exists but its dedicated schema is missing from the current connector catalog. When routing or another Bridge response supplied exact fallback arguments, use them without another discovery call; otherwise inspect bridge_tool_schema first. Delegates only to tools classified read-only. Stateless or concurrent callers may pass the active MSSR traceId as wrapper control without changing the delegated target schema.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact runtime tool name to invoke." },
        traceId: { type: "string", description: "Optional active MSSR trace control for stateless or concurrent callers. The wrapper uses it for attribution and does not forward it to targets that do not declare traceId." },
        arguments: { type: "object", description: "Arguments for the delegated tool.", additionalProperties: true, default: {} },
      },
      required: ["toolName"],
      additionalProperties: false,
    },
  };
  const actionTool: BridgeToolSchema = {
    name: "bridge_tool_action",
    description: "Use this explicit non-read-only fallback immediately when a runtime Bridge tool exists but its dedicated schema is missing from the current connector catalog. When routing or another Bridge response supplied exact fallback arguments, use them without another discovery call; otherwise inspect bridge_tool_schema first. Delegates to neutral or destructive tools and requires exact target-name confirmation. Stateless or concurrent callers may pass the active MSSR traceId as wrapper control without changing the delegated target schema.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact runtime tool name to invoke." },
        confirmToolName: { type: "string", description: "Must exactly match toolName to confirm the delegated destructive action." },
        traceId: { type: "string", description: "Optional active MSSR trace control for stateless or concurrent callers. The wrapper uses it for attribution and does not forward it to targets that do not declare traceId." },
        arguments: { type: "object", description: "Arguments for the delegated tool.", additionalProperties: true, default: {} },
      },
      required: ["toolName", "confirmToolName"],
      additionalProperties: false,
    },
  };
  tools.push(
    annotateTool(schemaTool, "tool-dispatch"),
    annotateTool(auditTool, "tool-dispatch"),
    annotateTool(queryTool, "tool-dispatch"),
    annotateTool(actionTool, "tool-dispatch"),
  );
  handlers.set("bridge_tool_schema", async (args) => {
    const name = delegatedToolName(args.toolName);
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Unknown modular tool: ${name}`);
    return {
      tool: {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations ?? {},
        metadata: tool.metadata ?? {},
      },
    };
  });
  handlers.set("bridge_tool_audit", async (args) => {
    const rawView = args.view === undefined ? "needs-attention" : args.view;
    if (typeof rawView !== "string" || !TOOL_AUDIT_VIEWS.includes(rawView as ToolAuditView)) {
      throw new Error(`view must be one of: ${TOOL_AUDIT_VIEWS.join(", ")}.`);
    }
    const rawScope = args.scope === undefined ? "active" : args.scope;
    if (rawScope !== "active" && rawScope !== "all") throw new Error("scope must be active or all.");
    const parseBoundedInteger = (value: unknown, fallback: number, min: number, max: number, name: string) => {
      const numeric = value === undefined ? fallback : value;
      if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < min || numeric > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}.`);
      }
      return numeric;
    };
    const days = parseBoundedInteger(args.days, 30, 1, 365, "days");
    const limit = parseBoundedInteger(args.limit, 50, 1, 200, "limit");
    const toolName = args.toolName === undefined
      ? undefined
      : typeof args.toolName === "string" && args.toolName.trim()
        ? args.toolName.trim()
        : (() => { throw new Error("toolName must be a non-empty string when provided."); })();
    return buildRegisteredToolAudit(tools, {
      view: rawView as ToolAuditView,
      toolName,
      limit,
      days,
      scope: rawScope as BridgeMetricsScope,
    });
  });
  handlers.set("bridge_tool_query", async (args) => {
    const name = delegatedToolName(args.toolName);
    if (!readOnlyToolNames.has(name)) throw new Error(`Tool '${name}' is not classified read-only; use its direct schema or bridge_tool_action.`);
    const handler = handlers.get(name)!;
    const delegatedResult = await handler(delegatedArguments(args.arguments));
    if (delegatedResult && typeof delegatedResult === "object" && !Array.isArray(delegatedResult)) {
      const record = delegatedResult as Record<string, unknown>;
      const { __bridgeImages, __bridgeNotices, ...publicResult } = record;
      return {
        delegatedTool: name,
        classification: "read-only",
        result: publicResult,
        ...(Array.isArray(__bridgeImages) ? { __bridgeImages } : {}),
        ...(Array.isArray(__bridgeNotices) ? { __bridgeNotices } : {}),
      };
    }
    return { delegatedTool: name, classification: "read-only", result: delegatedResult };
  });
  handlers.set("bridge_tool_action", async (args) => {
    const name = delegatedToolName(args.toolName);
    if (readOnlyToolNames.has(name)) throw new Error(`Tool '${name}' is classified read-only; use its direct schema or bridge_tool_query.`);
    if (args.confirmToolName !== name) throw new Error(`confirmToolName must exactly match '${name}'.`);
    const classification = destructiveToolNames.has(name) ? "destructive" : "neutral";
    const handler = handlers.get(name)!;
    const delegatedResult = await handler(delegatedArguments(args.arguments));
    if (delegatedResult && typeof delegatedResult === "object" && !Array.isArray(delegatedResult)) {
      const record = delegatedResult as Record<string, unknown>;
      const { __bridgeImages, __bridgeNotices, ...publicResult } = record;
      return {
        delegatedTool: name,
        classification,
        result: publicResult,
        ...(Array.isArray(__bridgeImages) ? { __bridgeImages } : {}),
        ...(Array.isArray(__bridgeNotices) ? { __bridgeNotices } : {}),
      };
    }
    return { delegatedTool: name, classification, result: delegatedResult };
  });

  return {
    tools,
    modules: moduleNames,
    riskSummary: riskSummary(tools),
    has(name: string) { return handlers.has(name); },
    async call(name: string, args: Record<string, unknown>) {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Unknown modular tool: ${name}`);
      return await handler(args);
    },
  };
}

const defaultToolModules: readonly BridgeToolModule[] = [
  coreToolModule,
  fileNavigationToolModule,
  fileWritingToolModule,
  workflowGuideToolModule,
  skillCatalogToolModule,
  robloxStudioToolModule,
  robloxAssetToolModule,
  robloxPhotoCaptureToolModule,
  binaryFileToolModule,
  imageToolModule,
  processToolModule,
  gitToolModule,
  projectToolModule,
  workspaceToolModule,
  cacheToolModule,
  bridgeOpsToolModule,
  metricsToolModule,
  mssrObservatoryToolModule,
  noticeToolModule,
  codeIntelligenceToolModule,
  codeGraphToolModule,
  pythonToolModule,
  blenderToolModule,
  godotToolModule,
  whiteboardToolModule,
  bridgeWorkflowToolModule,
];

let defaultToolCatalog: readonly BridgeToolSchema[] | undefined;

export type RegisteredToolAuditArgs = ToolAuditArgs & {
  days: number;
  scope: BridgeMetricsScope;
};

export function buildRegisteredToolAudit(tools: readonly BridgeToolSchema[], args: RegisteredToolAuditArgs) {
  return buildToolAudit(tools, getToolAuditMetrics(args.days, args.scope), {
    view: args.view,
    toolName: args.toolName,
    limit: args.limit,
  });
}

export function getDefaultToolCatalog(): readonly BridgeToolSchema[] {
  defaultToolCatalog ??= createToolRegistry(defaultToolModules).tools;
  return defaultToolCatalog;
}

export function getDefaultToolAudit(args: RegisteredToolAuditArgs) {
  return buildRegisteredToolAudit(getDefaultToolCatalog(), args);
}

export function createDefaultToolRegistry(): BridgeToolRegistry {
  return createToolRegistry(defaultToolModules);
}
