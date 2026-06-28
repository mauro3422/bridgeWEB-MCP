import { bridgeOpsToolModule } from "./tools/bridge-ops.js";
import { bridgeWorkflowToolModule } from "./tools/bridge-workflow.js";
import { codeIntelligenceToolModule } from "./tools/code-intelligence.js";
import { coreToolModule } from "./tools/core-tools.js";
import { fileNavigationToolModule } from "./tools/file-navigation.js";
import { fileWritingToolModule } from "./tools/file-writing.js";
import { gitToolModule } from "./tools/git-tools.js";
import { metricsToolModule } from "./tools/metrics-tools.js";
import { processToolModule } from "./tools/process-tools.js";
import type { BridgeToolModule, BridgeToolRegistry, BridgeToolSchema } from "./tools/types.js";

export function createToolRegistry(modules: readonly BridgeToolModule[]): BridgeToolRegistry {
  const tools: BridgeToolSchema[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>();
  const moduleNames: string[] = [];

  for (const module of modules) {
    moduleNames.push(module.name);
    for (const tool of module.tools) {
      if (handlers.has(tool.name)) {
        throw new Error(`Duplicate bridge tool registered: ${tool.name}`);
      }
      const handler = module.handlers[tool.name];
      if (!handler) {
        throw new Error(`Tool module '${module.name}' declares '${tool.name}' without a handler.`);
      }
      tools.push({ ...tool });
      handlers.set(tool.name, handler);
    }
  }

  return {
    tools,
    modules: moduleNames,
    has(name: string) {
      return handlers.has(name);
    },
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
    processToolModule,
    gitToolModule,
    bridgeOpsToolModule,
    metricsToolModule,
    codeIntelligenceToolModule,
    bridgeWorkflowToolModule,
  ]);
}
