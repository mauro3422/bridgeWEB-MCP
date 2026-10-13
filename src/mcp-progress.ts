import type { BridgeToolCallContext } from "./tools/types.js";

type ProgressToken = string | number;
type ProgressNotification = {
  method: "notifications/progress";
  params: {
    progressToken: ProgressToken;
    progress: number;
    total: number;
    message: string;
  };
};

type RequestHandlerNotificationSender = {
  sendNotification?: (notification: ProgressNotification) => Promise<void>;
};

export function createBridgeToolCallContext(
  requestMeta: unknown,
  extra?: RequestHandlerNotificationSender,
): BridgeToolCallContext | undefined {
  if (!requestMeta || typeof requestMeta !== "object" || Array.isArray(requestMeta)) return undefined;
  const progressToken = (requestMeta as Record<string, unknown>).progressToken;
  if ((typeof progressToken !== "string" && typeof progressToken !== "number") || typeof extra?.sendNotification !== "function") {
    return undefined;
  }

  return {
    sendProgress: async (message) => {
      await extra.sendNotification!({
        method: "notifications/progress",
        params: { progressToken, progress: 0, total: 1, message },
      });
    },
  };
}
