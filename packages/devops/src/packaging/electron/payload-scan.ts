import path from 'node:path';
import type { PackagingFilesystemPort } from './ports.js';

/**
 * Every file under `root` except directories the host prunes. Pruning is the host's policy (for
 * example material an agent reads that the server never imports, so its imports are not runtime
 * edges); the walk itself is generic. The root is never pruned.
 * @example walkPayloadFiles({ root: dist, fs }, { skipDirectory: ({ relative }) => isSkillFolder(relative) });
 * @complexity O(entries) under `root`; one stat per entry.
 */
export function walkPayloadFiles(
  { root, fs }: { root: string; fs: Pick<PackagingFilesystemPort, 'entries' | 'stat'> },
  { skipDirectory = () => false }: { skipDirectory?: (required: { relative: string }) => boolean } = {},
): string[] {
  const walk = ({ relative }: { relative: string }): string[] => {
    const absolute = path.join(root, relative);
    if (fs.stat({ path: absolute }).kind !== 'directory') return [absolute];
    if (relative !== '' && skipDirectory({ relative })) return [];
    return fs.entries({ path: absolute }).flatMap(name => walk({ relative: path.join(relative, name) }));
  };
  return walk({ relative: '' });
}
