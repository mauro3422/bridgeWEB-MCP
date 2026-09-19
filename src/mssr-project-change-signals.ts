function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function isMssrRoutingSemanticOwnerPath(value: string): boolean {
  const file = normalizeProjectPath(value);
  return file.startsWith("config/skill-routing/")
    || file === "src/tools/skill-routing.ts"
    || file === "src/host-adapter-contract.ts"
    || file === "src/mssr-adapter.ts";
}
