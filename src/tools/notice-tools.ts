import { z } from "zod";
import {
  drainBridgeNotices,
  getBridgeNoticeStatus,
  queryBridgeNoticeHistory,
} from "../notices.js";
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
      name: "bridge_notice_history",
      description: "Recover recent Bridge notices even after automatic delivery/drain so an agent can inspect alerts it may have missed. Read-only; does not re-deliver notices. History is retained for up to 24 hours and is persisted across Bridge restarts when notice persistence is enabled.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", default: 50, minimum: 1, maximum: 200 },
          severity: { type: "string", enum: ["info", "warning", "error"] },
          source: { type: "string" },
          code: { type: "string" },
          since: { type: "string", description: "Optional ISO timestamp; return notices updated at or after this time." },
          deliveryState: { type: "string", enum: ["all", "pending", "delivered", "not-delivered"], default: "all" },
        },
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
    bridge_notice_history: (args) => {
      const parsed = z.object({
        limit: z.number().int().min(1).max(200).default(50),
        severity: z.enum(["info", "warning", "error"]).optional(),
        source: z.string().min(1).max(160).optional(),
        code: z.string().min(1).max(120).optional(),
        since: z.string().datetime({ offset: true }).optional(),
        deliveryState: z.enum(["all", "pending", "delivered", "not-delivered"]).default("all"),
      }).parse(args);
      const items = queryBridgeNoticeHistory(parsed);
      return {
        delivery: "recent-history",
        retention: "disk-backed-24h",
        count: items.length,
        items,
      };
    },
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
