export type BridgeToolInputSchema = Record<string, unknown>;

export type BridgeToolSchema = {
  name: string;
  description: string;
  inputSchema: BridgeToolInputSchema;
  annotations?: Record<string, boolean>;
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



