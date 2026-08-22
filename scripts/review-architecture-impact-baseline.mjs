import path from "node:path";
import { reviewBridgeArchitectureImpactBaseline } from "../dist/architecture-impact-host-adapter.js";

const args = process.argv.slice(2);
const architectureId = args.find((arg) => !arg.startsWith("--"));
const reviewed = args.includes("--reviewed");
const rootArg = args.find((arg) => arg.startsWith("--project-root="));
const projectRoot = path.resolve(rootArg ? rootArg.slice("--project-root=".length) : process.cwd());

if (!architectureId || !reviewed) {
  process.stderr.write("Usage: node scripts/review-architecture-impact-baseline.mjs <architectureId> --reviewed [--project-root=<path>]\n");
  process.exitCode = 2;
} else {
  const result = await reviewBridgeArchitectureImpactBaseline({ projectRoot, architectureId, reviewed: true });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    architectureId: result.architectureId,
    receiptRef: path.relative(projectRoot, result.receiptPath).split(path.sep).join("/"),
    structural: result.structural,
  }, null, 2)}\n`);
}
