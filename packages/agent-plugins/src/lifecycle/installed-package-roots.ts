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
  const effects: RevisionEffects = {
    readdir: ports.filesystem.readdir.bind(ports.filesystem),
    assertOwnedPath: createPersistentStateModule(ports).assertOwnedPath,
    assertContainedOnDisk: createPackagePathsModule(ports).assertContainedOnDisk,
  };
  let folders;
  try { folders = await effects.readdir(workspaceRoot, { withFileTypes: true }); }
  catch (error) { if (isEnoent(error)) return []; throw error; }
  const roots: InstalledPackageRoot[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(folder.name) || folder.name.length > 64) continue;
    roots.push(...await listFolderRevisions({ effects, workspaceRoot, localId: folder.name }));
  }
  return roots;
}

interface RevisionEffects {
  readonly readdir: AgentPluginLifecyclePorts['filesystem']['readdir'];
  readonly assertOwnedPath: ReturnType<typeof createPersistentStateModule>['assertOwnedPath'];
  readonly assertContainedOnDisk: ReturnType<typeof createPackagePathsModule>['assertContainedOnDisk'];
}

/** One plugin folder's contained digest revisions; a folder with no owned package store has none. */
async function listFolderRevisions(
  { effects, workspaceRoot, localId }: { readonly effects: RevisionEffects; readonly workspaceRoot: string; readonly localId: string },
): Promise<InstalledPackageRoot[]> {
  const packagesDir = path.join(workspaceRoot, localId, 'package', 'sha256');
  let entries;
  try {
    await effects.assertOwnedPath({ workspaceRoot, entryPath: path.relative(workspaceRoot, packagesDir) });
    entries = await effects.readdir(packagesDir, { withFileTypes: true });
  } catch { return []; }
  const roots: InstalledPackageRoot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !INSTALLED_PLUGIN_DIGEST_PATTERN.test(entry.name)) continue;
    try {
      const packageRoot = await effects.assertContainedOnDisk(workspaceRoot, path.relative(workspaceRoot, path.join(packagesDir, entry.name)));
      roots.push({ localId, archiveDigest: entry.name, packageRoot });
    } catch {
      // One corrupt package never hides another plugin. Memory-only folders are not installs.
    }
  }
  return roots;
}

/** Only a genuinely missing store is empty; other filesystem faults propagate unchanged. */
function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
