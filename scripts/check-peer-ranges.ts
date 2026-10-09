/** Local workspace preflight. Usage: pnpm exec tsx scripts/check-peer-ranges.ts */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverJiniPackages } from './lib/pack-jini-packages.js';
import { assertCompatiblePeerRanges } from './lib/peer-range-compatibility.js';

/** Scan the canonical workspace inventory; private fixtures are filtered by the shared helper. */
export function checkPeerRanges(
  { repoRoot }: { repoRoot: string },
  _options: Record<string, never> = {},
): void {
  const registry = discoverJiniPackages(repoRoot);
  assertCompatiblePeerRanges({ packages: [...registry.values()].map(entry => entry.pkg) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPeerRanges({ repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
  console.log('Public package peer ranges are compatible.');
}
