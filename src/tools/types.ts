export type BridgeToolInputSchema = Record<string, unknown>;

export type BridgeToolRole = "dedicated" | "alias" | "fallback" | "aggregator" | "provider-proxy" | "experimental";
export type BridgeToolLifecycle = "protected" | "stable" | "experimental" | "deprecated";

export type BridgeToolRecoveryRule = {
  code: string;
  instruction: string;
  toolName?: string;
};

export type BridgeToolUsageGuidance = {
  prerequisites?: string[];
  preflightTools?: string[];
  recovery?: BridgeToolRecoveryRule[];
};

export type BridgeToolMetadata = {
  role: BridgeToolRole;
  family: string;
  lifecycle: BridgeToolLifecycle;
  aliasOf?: string;
  preferredTool?: string;
  usage?: BridgeToolUsageGuidance;
};

export type BridgeToolSchema = {
  name: string;
  description: string;
  inputSchema: BridgeToolInputSchema;
  annotations?: Record<string, boolean>;
  metadata?: BridgeToolMetadata;
};

export type BridgeToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export type BridgeToolModule = {
  name: string;
  tools: readonly BridgeToolSchema[];
  handlers: Readonly<Record<string, BridgeToolHandler>>;
};

export type BridgeToolRegistry = {
  tools: BridgeToolSchema[];
  has(name: string): boolean;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  modules: string[];
  riskSummary: { readOnly: string[]; destructive: string[]; neutral: string[] };
};
