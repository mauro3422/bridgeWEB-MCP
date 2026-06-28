import path from "node:path";

export function resolveToolPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string") throw new Error("Path must be a non-empty string.");
  return path.resolve(inputPath);
}
