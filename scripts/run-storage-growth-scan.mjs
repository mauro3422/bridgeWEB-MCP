import { createDefaultToolRegistry } from '../dist/tool-registry.js';
import { closeStorageGrowthWatchersForTests } from '../dist/tools/storage-growth-tools.js';

const target = process.argv[2];
const mode = process.argv[3] ?? 'auto';
const maxEntries = Number(process.argv[4] ?? 500000);
if (!target) {
  console.error('usage: node scripts/run-storage-growth-scan.mjs <path> [auto|baseline|status] [maxEntries]');
  process.exit(2);
}

const registry = createDefaultToolRegistry();
try {
  const result = await registry.call('storage_growth_scan', {
    path: target,
    mode,
    top: 25,
    groupDepth: 3,
    maxEntries,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeStorageGrowthWatchersForTests();
}
