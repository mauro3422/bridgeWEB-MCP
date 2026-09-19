export type BridgeToolInputSchema = Record<string, unknown>;

export type BridgeToolRole = "dedicated" | "alias" | "fallback" | "aggregator" | "provider-proxy" | "experimental";
export type BridgeToolLifecycle = "protected" | "stable" | "experimental" | "deprecated";
export type BridgeMssrLifecycleEffect = "control-plane" | "read" | "inspect" | "verify" | "execute" | "mutate" | "persist" | "publish" | "external-side-effect" | "unknown";
export type BridgeMssrLifecycleScale = "trivial" | "substantial" | "unknown";
export type BridgeMssrLifecycleMetadata = {
  effect: BridgeMssrLifecycleEffect;
  scale: BridgeMssrLifecycleScale;
};
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
  mssrLifecycle?: BridgeMssrLifecycleMetadata;
};

export type BridgeToolSchema = {
  name: string;
  description: string;
  inputSchema: BridgeToolInputSchema;
  annotations?: Record<string, boolean>;
  _meta?: Record<string, unknown>;
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
