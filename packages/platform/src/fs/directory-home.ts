import path from "node:path";

/** Resolve an operator-visible data home without I/O. Environment wins over settings.
 * Empty overrides are errors; tilde expansion uses the supplied home, never a shell.
 * @complexity O(n) in the chosen path length.
 */
export function resolveDirectoryHome(
  { homeDir, defaultFolder, envName, env, setting }: {
    homeDir: string; defaultFolder: string; envName: string;
    env: Record<string, string | undefined>; setting?: string | undefined;
  }, { cwd = homeDir, platform = process.platform }: { cwd?: string; platform?: NodeJS.Platform } = {},
): string {
  const paths = platform === "win32" ? path.win32 : path;
  const selected = env[envName] ?? setting ?? paths.join(homeDir, defaultFolder);
  if (!selected.trim()) throw new Error(`${envName} must name a directory`);
  return resolveSelected({ selected, homeDir, cwd, paths });
}

/** Expand a leading `~`, `~/` or `~\` against the supplied home; anything else resolves from cwd.
 * `~user` forms are deliberately not expanded (no shell, no user database lookup).
 */
function resolveSelected({ selected, homeDir, cwd, paths }: {
  selected: string; homeDir: string; cwd: string; paths: path.PlatformPath;
}): string {
  if (selected === "~") return paths.resolve(homeDir);
  if (selected.startsWith("~/") || selected.startsWith("~\\")) return paths.resolve(homeDir, selected.slice(2));
  return paths.resolve(cwd, selected);
}
