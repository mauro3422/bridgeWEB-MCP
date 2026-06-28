import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

function tailText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function runVerifyAll(projectRoot: string, expectedServerVersion: string, strictGit: boolean, timeoutMs: number) {
  const resolvedRoot = path.resolve(projectRoot);
  const args = [
    "-NoProfile",
    "-File",
    ".\\scripts\\verify-all.ps1",
    "-ProjectRoot",
    resolvedRoot,
    "-ExpectedServerVersion",
    expectedServerVersion,
  ];
  if (strictGit) args.push("-StrictGit");

  return new Promise<Record<string, unknown>>((resolve) => {
    const startedAt = Date.now();
    const child = spawn("powershell", args, { cwd: resolvedRoot, shell: false, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      finish({ ok: false, error: error.message, timedOut, durationMs: Date.now() - startedAt, stdout: tailText(stdout, 20000), stderr: tailText(stderr, 20000) });
    });
    child.on("close", (code, signal) => {
      finish({ ok: code === 0 && !timedOut, code, signal, timedOut, durationMs: Date.now() - startedAt, stdout: tailText(stdout, 30000), stderr: tailText(stderr, 20000) });
    });
  });
}

export const bridgeWorkflowToolModule: BridgeToolModule = {
  name: "bridge-workflow",
  tools: [
    {
      name: "bridge_verify_all",
      description: "Run the full bridge verification workflow: doctor, check, build, HTTP smoke, regressions, tools/list sanity, and Git status.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          expectedServerVersion: { type: "string", default: "0.5.0" },
          strictGit: { type: "boolean", default: false },
          timeoutMs: { type: "number", default: 180000, minimum: 30000, maximum: 600000 },
        },
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    bridge_verify_all: async (args) => {
      const parsed = z.object({
        cwd: z.string().optional(),
        expectedServerVersion: z.string().default("0.5.0"),
        strictGit: z.boolean().default(false),
        timeoutMs: z.number().int().min(30000).max(600000).default(180000),
      }).parse(args);
      return await runVerifyAll(parsed.cwd ?? process.cwd(), parsed.expectedServerVersion, parsed.strictGit, parsed.timeoutMs);
    },
  },
};
