import { initializeMetricsStorage } from "./metrics.js";
import { initializeMssrObservatoryStorage } from "./mssr-observatory.js";

type BootstrapResult = {
  type: "observability-storage-initialized";
  ok: boolean;
  error?: string;
};

async function main() {
  const requestedTestDelayMs = Number(process.env.BRIDGE_MCP_TEST_OBSERVABILITY_STORAGE_INIT_DELAY_MS ?? 0);
  const testDelayMs = Number.isFinite(requestedTestDelayMs)
    ? Math.max(0, Math.min(10_000, Math.floor(requestedTestDelayMs)))
    : 0;
  if (testDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, testDelayMs));

  const failures: string[] = [];
  try {
    initializeMetricsStorage();
  } catch (error) {
    failures.push(`metrics: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    initializeMssrObservatoryStorage();
  } catch (error) {
    failures.push(`MSSR observatory: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result: BootstrapResult = {
    type: "observability-storage-initialized",
    ok: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join("; ").slice(0, 1_000) } : {}),
  };

  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  process.send(result, (error) => {
    if (error) process.exitCode = 1;
    process.disconnect();
  });
}

void main().catch((error) => {
  const result: BootstrapResult = {
    type: "observability-storage-initialized",
    ok: false,
    error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  };
  if (typeof process.send === "function") {
    process.send(result, () => process.disconnect());
  } else {
    process.exitCode = 1;
  }
});
