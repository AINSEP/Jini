/** The installed-package walk shared by full indexing and identity admission. Reusing this
 * traversal preserves the same digest grammar, memory-folder exclusion and containment checks. */
import path from 'node:path';
import { createPersistentStateModule } from './persistent-state.js';
import { createPackagePathsModule } from './package-paths.js';
import type { AgentPluginLifecyclePorts } from './ports.js';

export const INSTALLED_PLUGIN_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface InstalledPackageRoot {
  readonly localId: string;
  readonly archiveDigest: string;
  readonly packageRoot: string;
}

/** Enumerates contained installed revisions; missing stores are empty. A corrupt slot is
 * isolated, matching the full installed-plugin index's existing recovery contract.
 * @complexity O(d) directory/containment operations for d revisions; no executable imports.
 */
export async function listInstalledPackageRoots(
  { ports, workspaceRoot }: { ports: AgentPluginLifecyclePorts; workspaceRoot: string },
  _optional: Record<string, never> = {},
): Promise<readonly InstalledPackageRoot[]> {
  const persistentState = createPersistentStateModule(ports);
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  let folders;
  try { folders = await readdir(workspaceRoot, { withFileTypes: true }); }
  catch (error) { if (isEnoent(error)) return []; throw error; }
  const roots: InstalledPackageRoot[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(folder.name) || folder.name.length > 64) continue;
    const packagesDir = path.join(workspaceRoot, folder.name, 'package', 'sha256');
    let entries;
    try {
      await persistentState.assertOwnedPath({ workspaceRoot, entryPath: path.relative(workspaceRoot, packagesDir) });
      entries = await readdir(packagesDir, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !INSTALLED_PLUGIN_DIGEST_PATTERN.test(entry.name)) continue;
      try {
        const packageRoot = await assertContainedOnDisk(workspaceRoot, path.relative(workspaceRoot, path.join(packagesDir, entry.name)));
        roots.push({ localId: folder.name, archiveDigest: entry.name, packageRoot });
      } catch {
        // One corrupt package never hides another plugin. Memory-only folders are not installs.
      }
    }
  }
  return roots;
}


/** Only a genuinely missing store is empty; other filesystem faults propagate unchanged. */
function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
