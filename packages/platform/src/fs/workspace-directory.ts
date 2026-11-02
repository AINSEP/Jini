import path from "node:path";
import type { DirectoryRecord } from "./directory-registry.js";

/** Shared selection policy for CLI/dev hosts. A registry ID disambiguates adopted paths;
 * a basename selects the home first. No initialized home site preserves the supplied fallback.
 * Hosts may probe availability to resolve an ambiguous name to its sole available directory.
 * Two live directories with one name never stop a boot: the one inside a configured root wins,
 * then the most recently opened, then path order, and `report` names every path and ID.
 * Offline records and explicit ID selection are preserved; probe failures propagate.
 * @complexity O(n log n) registered/child directories and validation probes.
 */
export function selectWorkspaceDirectory(
  { home, entries, fallback, selected, roots = [home], listDirectories, isInitialized }: {
    home: string; entries: readonly DirectoryRecord[]; fallback: string; selected?: string | undefined; roots?: readonly string[];
    listDirectories: (required: { root: string }) => readonly string[];
    isInitialized: (required: { path: string }) => boolean;
  }, { isAvailable, report = ({ message }) => console.warn(message) }: {
    isAvailable?: (required: { path: string }) => boolean; report?: (required: { message: string }) => void;
  } = {},
): string {
  if (selected !== undefined) {
    const byId = entries.find((entry) => entry.id === selected);
    if (byId) return byId.path;
    const inHome = path.join(home, selected);
    if (isInitialized({ path: inHome })) return inHome;
    const matches = [...new Set([...entries.filter((entry) => path.basename(entry.path) === selected).map((entry) => entry.path),
      ...roots.filter((root) => root !== home).map((root) => path.join(root, selected)).filter((dir) => isInitialized({ path: dir }))])];
    if (matches.length > 1) return pickDuplicate({ matches, entries, roots, isAvailable, report });
    return matches[0] ?? path.join(path.dirname(fallback), selected);
  }
  const candidates = [...entries.filter((entry) => path.dirname(entry.path) === home).sort((a, b) => (b.lastOpened ? Date.parse(b.lastOpened) : 0) - (a.lastOpened ? Date.parse(a.lastOpened) : 0)).map((entry) => entry.path), ...roots.flatMap((root) => listDirectories({ root }))];
  return candidates.find((dir) => isInitialized({ path: dir })) ?? fallback;
}

/** One name, several directories. A stale scratch catalog row must not block the sole live site or
 * choose by row order; a live scratch copy (another tool's sandbox) must not stop the boot either.
 * Throws only when none is available, because then there is nothing to serve.
 * @complexity O(n log n) matches.
 */
function pickDuplicate({ matches, entries, roots, isAvailable, report }: {
  matches: readonly string[]; entries: readonly DirectoryRecord[]; roots: readonly string[];
  isAvailable: ((required: { path: string }) => boolean) | undefined; report: (required: { message: string }) => void;
}): string {
  const label = (dir: string) => `${dir} (${entries.find((entry) => entry.path === dir)?.id ?? "not registered"})`;
  const available = matches.filter((dir) => isAvailable?.({ path: dir }) ?? true);
  if (available.length === 0) throw new Error(`No registered directory with this name is available: ${matches.map(label).join(", ")}. Select its registry ID.`);
  const inRoot = (dir: string) => (roots.includes(path.dirname(dir)) ? 1 : 0);
  const opened = (dir: string) => Date.parse(entries.find((entry) => entry.path === dir)?.lastOpened ?? "") || 0;
  const [chosen, ...others] = [...available].sort((a, b) => inRoot(b) - inRoot(a) || opened(b) - opened(a) || a.localeCompare(b));
  if (others.length > 0) report({ message: `More than one directory has this name. Using ${label(chosen!)}; also found ${others.map(label).join(", ")}. Select a registry ID to choose another.` });
  return chosen!;
}
