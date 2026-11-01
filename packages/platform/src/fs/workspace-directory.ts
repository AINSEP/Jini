import path from "node:path";
import type { DirectoryRecord } from "./directory-registry.js";

/** Shared selection policy for CLI/dev hosts. A registry ID disambiguates adopted paths;
 * a basename selects the home first. No initialized home site preserves the supplied fallback.
 * Hosts may probe availability to resolve an ambiguous name to its sole available directory.
 * Offline records and explicit ID selection are preserved; probe failures propagate.
 * @complexity O(n) registered/child directories and validation probes.
 */
export function selectWorkspaceDirectory(
  { home, entries, fallback, selected, roots = [home], listDirectories, isInitialized }: {
    home: string; entries: readonly DirectoryRecord[]; fallback: string; selected?: string | undefined; roots?: readonly string[];
    listDirectories: (required: { root: string }) => readonly string[];
    isInitialized: (required: { path: string }) => boolean;
  }, { isAvailable }: { isAvailable?: (required: { path: string }) => boolean } = {},
): string {
  if (selected !== undefined) {
    const byId = entries.find((entry) => entry.id === selected);
    if (byId) return byId.path;
    const inHome = path.join(home, selected);
    if (isInitialized({ path: inHome })) return inHome;
    const matches = [...new Set([...entries.filter((entry) => path.basename(entry.path) === selected).map((entry) => entry.path),
      ...roots.filter((root) => root !== home).map((root) => path.join(root, selected)).filter((dir) => isInitialized({ path: dir }))])];
    if (matches.length > 1) {
      // A stale scratch catalog row must not block the sole live site or choose by row order.
      const available = matches.filter(dir => isAvailable?.({ path: dir }) ?? true);
      if (available.length === 1) return available[0]!;
      throw new Error("More than one registered directory has this name. Select its registry ID.");
    }
    return matches[0] ?? path.join(path.dirname(fallback), selected);
  }
  const candidates = [...entries.filter((entry) => path.dirname(entry.path) === home).sort((a, b) => (b.lastOpened ? Date.parse(b.lastOpened) : 0) - (a.lastOpened ? Date.parse(a.lastOpened) : 0)).map((entry) => entry.path), ...roots.flatMap((root) => listDirectories({ root }))];
  return candidates.find((dir) => isInitialized({ path: dir })) ?? fallback;
}
