import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { persistentCacheStatus, prunePersistentCache } from "./shared/persistent-cache.js";

export const cacheToolModule: BridgeToolModule = {
  name: "cache",
  tools: [
    { name: "cache_status", description: "Return persistent analysis-cache location, entry count, size, age, and active limits.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "cache_prune", description: "Prune persistent analysis-cache entries by TTL, total bytes, and entry count; supports dry-run.", inputSchema: { type: "object", properties: { ttlMs: { type: "number", minimum: 0 }, maxBytes: { type: "number", minimum: 0 }, maxEntries: { type: "number", minimum: 0 }, dryRun: { type: "boolean", default: true } }, additionalProperties: false } },
  ],
  handlers: {
    cache_status: () => persistentCacheStatus(),
    cache_prune: (args) => {
      const parsed = z.object({
        ttlMs: z.number().int().min(0).optional(),
        maxBytes: z.number().int().min(0).optional(),
        maxEntries: z.number().int().min(0).optional(),
        dryRun: z.boolean().default(true),
      }).parse(args);
      return prunePersistentCache(parsed);
    },
  },
};
