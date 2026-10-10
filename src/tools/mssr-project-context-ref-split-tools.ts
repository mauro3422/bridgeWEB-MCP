import {
  MssrJevSemanticCuratorProvider,
  mssrProjectContextRefSplitPlanInputSchema,
  mssrSemanticTraceProjectionSchema,
  planMssrProjectContextReferenceSplit,
  type MssrSemanticCuratorProvider,
} from "@mauroprime/mssr";
import { z } from "zod";
import { createMssrJevBridgeDecisionProvider } from "./mssr-semantic-evidence-tools.js";
import { resolveToolPath } from "./shared/path.js";
import type { BridgeToolModule } from "./types.js";

const projectRootSchema = z.string().trim().min(1).max(4_096);
const moduleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/);
const modelSchema = z.string().trim().min(1).max(120);
const traceIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{6,128}$/);
const workflowKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/);

export type MssrProjectContextRefSplitToolOptions = {
  /** Test seam for deterministic local regressions; production uses the Windows credential-backed Jev provider. */
  provider?: MssrSemanticCuratorProvider;
  /** Test seam so persisted plans and shadow observations remain inside the fixture root. */
  stateRoot?: string;
};

export function createMssrProjectContextRefSplitToolModule(options: MssrProjectContextRefSplitToolOptions = {}): BridgeToolModule {
  return {
    name: "mssr-project-context-ref-split",
    tools: [{
      name: "mssr_project_context_ref_split_plan",
      description: "Ask Jev to classify exact existing Project Context sections for selective reference placement, then run MSSR's deterministic safety policy. Persists only the advisory plan and observe-only semantic evidence in MSSR runtime state; it never changes canonical project files. This external Jev request may incur account usage. Applying a plan is a separate operation and is not exposed by this Bridge tool.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", minLength: 1, maxLength: 4_096, description: "Canonical initialized MSSR project root, resolved through Bridge path policy." },
          moduleId: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$", description: "Exact module id from the project's .mssr/project-context.json." },
          model: { type: "string", minLength: 1, maxLength: 120, description: "Optional Jev model override; defaults to the Bridge Jev model." },
          traceId: { type: "string", pattern: "^[A-Za-z0-9._:-]{6,128}$", description: "Optional explicit MSSR trace id for restart, cross-process, or ambiguous-trace cases." },
          workflowKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$", description: "Optional bounded workflow key paired with traceId." },
        },
        required: ["projectRoot", "moduleId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      metadata: {
        role: "dedicated",
        family: "mssr-semantic-curation",
        lifecycle: "stable",
        usage: {
          prerequisites: ["Use only for an exact module in an initialized project. Jev is called externally and an advisory plan is persisted under MSSR runtime state; canonical Markdown and manifests are read-only."],
        },
      },
    }],
    handlers: {
      mssr_project_context_ref_split_plan: async (raw) => {
        const parsed = mssrProjectContextRefSplitPlanInputSchema.parse(raw);
        const projectRoot = resolveToolPath(projectRootSchema.parse(parsed.projectRoot), { access: "read" });
        const model = parsed.model ?? process.env.BRIDGE_MSSR_JEV_MODEL ?? "jev-latest";
        const provider = options.provider ?? new MssrJevSemanticCuratorProvider({
          decisionProvider: createMssrJevBridgeDecisionProvider({ model }),
          model,
        });
        const trace = parsed.traceId
          ? mssrSemanticTraceProjectionSchema.parse({ traceId: parsed.traceId, ...(parsed.workflowKey ? { workflowKey: parsed.workflowKey } : {}) })
          : undefined;
        return await planMssrProjectContextReferenceSplit({
          projectRoot,
          moduleId: moduleIdSchema.parse(parsed.moduleId),
          provider,
          ...(trace ? { trace } : {}),
          ...(options.stateRoot ? { stateRoot: resolveToolPath(options.stateRoot, { access: "write" }) } : {}),
          persist: true,
        });
      },
    },
  };
}

export const mssrProjectContextRefSplitToolModule = createMssrProjectContextRefSplitToolModule();
