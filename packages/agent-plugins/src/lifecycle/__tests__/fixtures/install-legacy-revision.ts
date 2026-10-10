import { cp, mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forceRemove } from './force-remove.js';

/** Builds the retained-revision store left by older installers. Installation itself stays real;
 * restore its prior frozen bytes afterwards so legacy ambiguity/rollback tests keep that state.
 * Current upgrade tests must call the installer directly, including its pruning policy. */
export async function installLegacyRevision<T>(
  { packagesDir, install }: { packagesDir: string; install: () => Promise<T> },
  _optional: Record<string, never> = {},
): Promise<T> {
  const entries = await readdir(packagesDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const backup = await mkdtemp(path.join(tmpdir(), 'legacy-plugin-revisions-'));
  try {
    for (const entry of entries) await cp(path.join(packagesDir, entry), path.join(backup, entry), { recursive: true });
    const result = await install();
    for (const entry of entries) {
      const live = path.join(packagesDir, entry);
      const present = await stat(live).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!present) await cp(path.join(backup, entry), live, { recursive: true });
    }
    return result;
  } finally { await forceRemove(backup); }
}
