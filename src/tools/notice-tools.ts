import { z } from "zod";
import { drainBridgeNotices, getBridgeNoticeStatus } from "../notices.js";
import type { BridgeToolModule } from "./types.js";

export const noticeToolModule: BridgeToolModule = {
  name: "notices",
  tools: [
    {
      name: "bridge_notice_status",
      description: "Inspect pending ephemeral Bridge anomaly notices without consuming them. Normal tool responses drain these notices automatically after delivery.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "bridge_notice_drain",
      description: "Explicitly drain pending ephemeral Bridge anomaly notices. Use only when manual inspection is needed; normal tool responses already deliver and clear them automatically.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", default: 100, minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    bridge_notice_status: () => getBridgeNoticeStatus(),
    bridge_notice_drain: (args) => {
      const parsed = z.object({ limit: z.number().int().min(1).max(100).default(100) }).parse(args);
      const items = drainBridgeNotices(parsed.limit);
      return {
        delivery: "manual-drain",
        count: items.length,
        items,
      };
    },
  },
};
