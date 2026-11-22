import path from "node:path";

type AppDataRoot = (required: { env: NodeJS.ProcessEnv; homeDir: string }) => string;

const APP_DATA_ROOTS: Readonly<Partial<Record<NodeJS.Platform, AppDataRoot>>> = Object.freeze({
  darwin: ({ homeDir }: { env: NodeJS.ProcessEnv; homeDir: string }) => path.posix.join(homeDir, "Library", "Application Support"),
  win32: ({ env, homeDir }: { env: NodeJS.ProcessEnv; homeDir: string }) => env.APPDATA?.trim() || path.win32.join(homeDir, "AppData", "Roaming"),
  linux: ({ env, homeDir }: { env: NodeJS.ProcessEnv; homeDir: string }) => env.XDG_CONFIG_HOME?.trim() || path.posix.join(homeDir, ".config"),
});

/**
 * Electron's per-user application-data root (`app.getPath('appData')`), without Electron.
 * The table keeps each platform's rule independently correctable. Linux honors XDG_CONFIG_HOME
 * and Windows uses APPDATA because Electron does, with conventional fallbacks for stripped envs.
 * Returns undefined when the platform has no known convention; reads no host state or files.
 * @complexity O(1) — a fixed platform table.
 */
export function resolveElectronAppDataRoot(
  required: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homeDir: string },
  _optional: Record<string, never> = {},
): string | undefined {
  return APP_DATA_ROOTS[required.platform]?.(required);
}

/**
 * `<appDataRoot>/<appName>`: Electron's default userData for a packaged-name-less dev app.
 * This mirrors Electron rather than deriving the answer from it, a risk: if its convention or
 * the app name changes, callers can silently target a directory the application does not use.
 * Windows paths use win32 syntax even on another host; all other paths use POSIX syntax.
 * Returns undefined for an unknown platform; creates and checks no directories.
 * @throws {Error} If appName is empty.
 * @complexity O(1) — a fixed platform lookup and path join.
 */
export function resolveElectronUserDataDir(
  required: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homeDir: string; appName: string },
  _optional: Record<string, never> = {},
): string | undefined {
  if (required.appName.length === 0) throw new Error("appName must be a non-empty string.");
  const root = resolveElectronAppDataRoot(required);
  if (root === undefined) return undefined;
  const paths = required.platform === "win32" ? path.win32 : path.posix;
  return paths.join(root, required.appName);
}
