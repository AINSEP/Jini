import { createRequire } from 'node:module';
import type { PackageJson } from './pack-jini-packages.js';

// Reuse the workspace's declared semver dependency without relying on pnpm hoisting it to root.
const semver = createRequire(new URL('../../packages/plugins/package.json', import.meta.url))('semver') as {
  validRange(range: string): string | null;
  intersects(left: string, right: string): boolean;
};

export interface PeerPackageJson extends PackageJson {
  readonly private?: boolean;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Reject disjoint peer ranges across public packages, even when both peers are optional.
 * Throws with package names and ranges; never consults the registry or mutates manifests.
 * @complexity O(P + sum(n_peer²)) range comparisons over P peer declarations.
 */
export function assertCompatiblePeerRanges(
  { packages }: { packages: Iterable<PeerPackageJson> },
  _options: Record<string, never> = {},
): void {
  const byPeer = new Map<string, Array<{ name: string; range: string }>>();
  for (const pkg of packages) {
    if (pkg.private === true) continue;
    for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (semver.validRange(range) === null) throw new Error(`${pkg.name}: invalid peer range for ${peer}: ${range}`);
      const declarations = byPeer.get(peer) ?? [];
      declarations.push({ name: pkg.name ?? '(unnamed package)', range });
      byPeer.set(peer, declarations);
    }
  }
  const conflicts: string[] = [];
  for (const [peer, declarations] of byPeer) {
    for (let left = 0; left < declarations.length; left++) {
      for (let right = left + 1; right < declarations.length; right++) {
        const a = declarations[left]!;
        const b = declarations[right]!;
        if (!semver.intersects(a.range, b.range)) conflicts.push(`${peer}: ${a.name} (${a.range}) and ${b.name} (${b.range}) have no common version`);
      }
    }
  }
  if (conflicts.length) throw new Error(`Incompatible public package peers:\n${conflicts.join('\n')}`);
}
