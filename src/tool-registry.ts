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
import { imageToolModule } from "./tools/image-tools.js";
import { metricsToolModule } from "./tools/metrics-tools.js";
import { processToolModule } from "./tools/process-tools.js";
import { projectToolModule } from "./tools/project-tools.js";
import { pythonToolModule } from "./tools/python-tools.js";
import { robloxStudioToolModule } from "./tools/roblox-studio-tools.js";
import { skillCatalogToolModule } from "./tools/skill-catalog-tools.js";
import { workspaceToolModule } from "./tools/workspace-tools.js";
import { workflowGuideToolModule } from "./tools/workflow-guide-tools.js";
import type { BridgeToolModule, BridgeToolRegistry, BridgeToolSchema } from "./tools/types.js";

const readOnlyToolNames = new Set([
  "system_info", "list_dir", "read_text_file", "list_files_smart", "read_file_lines", "read_many_files", "search_files",
  "terminal_read", "terminal_list", "work_peek", "work_show",
  "git_status", "git_diff", "git_log", "git_show_commit", "git_compare_branches",
  "tunnel_health", "bridge_health", "bridge_self_check", "bridge_restart_status",
  "bridge_metrics_status", "bridge_metrics_summary", "bridge_metrics_recent", "bridge_metrics_query", "bridge_visualization_catalog", "bridge_visualize_metrics",
  "path_policy_status", "project_profile", "workspace_diff", "workspace_snapshot_list", "cache_status",
  "analyze_code", "impact_analysis", "find_duplicate_symbols", "import_graph", "dependency_graph", "call_graph", "find_dead_code",
  "project_context_load", "workflow_guide_recommend", "workflow_guide_load", "bridge_tool_query",
  "skill_catalog", "skill_recommend", "skill_route_audit", "skill_route_plan", "skill_bootstrap", "skill_load", "roblox_mcp_status", "roblox_mcp_tool_list", "roblox_mcp_query",
  "binary_file_info", "binary_file_read_chunk", "binary_upload_status",
  "blender_status", "blender_scene_info", "blender_character_loop_status",
  "python_validate", "python_symbols", "python_impact_analysis", "python_import_graph", "python_call_graph", "python_dead_code", "python_test_plan", "pytest_testmon",
]);

const destructiveToolNames = new Set([
  "write_text_file", "apply_patch", "edit_lines", "run_command", "terminal_start", "terminal_write", "terminal_stop",
  "work_once", "work_begin", "work_feed", "work_finish",
  "git_create_branch", "git_restore_file", "git_set_remote", "git_commit_all", "git_push_current_branch",
  "project_profile_save", "workspace_snapshot", "workspace_rollback", "cache_prune",
  "bridge_request_restart", "bridge_verify_all", "workflow_guide_create", "bridge_tool_action", "roblox_mcp_action", "roblox_place_save",
  "image_asset_save", "image_character_views_prepare",
  "binary_file_write", "binary_upload_begin", "binary_upload_append", "binary_upload_finish", "binary_upload_abort",
  "blender_open", "blender_viewport_screenshot", "blender_review_bundle", "blender_execute_code", "blender_batch_script", "blender_store_reference_image", "blender_setup_character_references",
]);

function annotateTool(tool: BridgeToolSchema): BridgeToolSchema {
  if (readOnlyToolNames.has(tool.name)) return { ...tool, annotations: { readOnlyHint: true, destructiveHint: false, ...(tool.annotations ?? {}) } };
  if (destructiveToolNames.has(tool.name)) return { ...tool, annotations: { readOnlyHint: false, destructiveHint: true, ...(tool.annotations ?? {}) } };
  return { ...tool, annotations: { readOnlyHint: false, destructiveHint: false, ...(tool.annotations ?? {}) } };
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
      tools.push(annotateTool(tool));
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
  const queryTool: BridgeToolSchema = {
    name: "bridge_tool_query",
    description: "Use this read-only fallback when a runtime Bridge tool exists but its dedicated schema is missing from the current connector catalog. Delegates only to tools classified read-only.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact runtime tool name to invoke." },
        arguments: { type: "object", description: "Arguments for the delegated tool.", additionalProperties: true, default: {} },
      },
      required: ["toolName"],
      additionalProperties: false,
    },
  };
  const actionTool: BridgeToolSchema = {
    name: "bridge_tool_action",
    description: "Use this explicit destructive fallback when a runtime Bridge tool exists but its dedicated schema is missing from the current connector catalog. Delegates only to tools classified destructive and requires exact target-name confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact runtime tool name to invoke." },
        confirmToolName: { type: "string", description: "Must exactly match toolName to confirm the delegated destructive action." },
        arguments: { type: "object", description: "Arguments for the delegated tool.", additionalProperties: true, default: {} },
      },
      required: ["toolName", "confirmToolName"],
      additionalProperties: false,
    },
  };
  tools.push(annotateTool(queryTool), annotateTool(actionTool));
  handlers.set("bridge_tool_query", async (args) => {
    const name = delegatedToolName(args.toolName);
    if (!readOnlyToolNames.has(name)) throw new Error(`Tool '${name}' is not classified read-only; use its direct schema or bridge_tool_action.`);
    const handler = handlers.get(name)!;
    return { delegatedTool: name, classification: "read-only", result: await handler(delegatedArguments(args.arguments)) };
  });
  handlers.set("bridge_tool_action", async (args) => {
    const name = delegatedToolName(args.toolName);
    if (!destructiveToolNames.has(name)) throw new Error(`Tool '${name}' is not classified destructive; use its direct schema or bridge_tool_query.`);
    if (args.confirmToolName !== name) throw new Error(`confirmToolName must exactly match '${name}'.`);
    const handler = handlers.get(name)!;
    return { delegatedTool: name, classification: "destructive", result: await handler(delegatedArguments(args.arguments)) };
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

export function createDefaultToolRegistry(): BridgeToolRegistry {
  return createToolRegistry([
    coreToolModule,
    fileNavigationToolModule,
    fileWritingToolModule,
    workflowGuideToolModule,
    skillCatalogToolModule,
    robloxStudioToolModule,
    binaryFileToolModule,
    imageToolModule,
    processToolModule,
    gitToolModule,
    projectToolModule,
    workspaceToolModule,
    cacheToolModule,
    bridgeOpsToolModule,
    metricsToolModule,
    codeIntelligenceToolModule,
    codeGraphToolModule,
    pythonToolModule,
    blenderToolModule,
    bridgeWorkflowToolModule,
  ]);
}
