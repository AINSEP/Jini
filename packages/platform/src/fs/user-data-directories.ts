import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

export interface UserDirectoryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  readText?: (file: string) => string | undefined;
  windowsDocuments?: () => string | undefined;
  windowsOneDriveRoots?: () => readonly string[];
}

/** Electron-free OS directory rules. Windows uses roaming app-data and the redirected Personal
 * known folder; Linux honors XDG user-dirs. No directories are created by this resolver.
 * env-paths is intentionally not used: its Windows data directory is LocalAppData/<app>/Data.
 * @complexity O(1) bounded configuration reads.
 */
export function resolveUserDataDirectories(
  { homeDir, appName }: { homeDir: string; appName: string },
  { platform = process.platform, env = process.env, readText = (file) => readOptionalText({ file }), windowsDocuments = readWindowsDocuments }: UserDirectoryOptions = {},
): { appData: string; documents: string } {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    const personal = windowsDocuments();
    const documents = personal?.replace(/%([^%]+)%/g, (match, key: string) => env[key] ?? match);
    return { appData: paths.join(env.APPDATA ?? paths.join(homeDir, "AppData", "Roaming"), appName),
      documents: documents ?? paths.join(homeDir, "Documents") };
  }
  if (platform === "darwin") return { appData: paths.join(homeDir, "Library", "Application Support", appName), documents: paths.join(homeDir, "Documents") };
  const userDirs = readText(paths.join(env.XDG_CONFIG_HOME ?? paths.join(homeDir, ".config"), "user-dirs.dirs"));
  const configured = /^XDG_DOCUMENTS_DIR="([^"\n]*)"/m.exec(userDirs ?? "")?.[1]?.replace(/\$HOME/g, homeDir);
  return { appData: paths.join(env.XDG_DATA_HOME ?? paths.join(homeDir, ".local", "share"), appName),
    documents: configured && paths.isAbsolute(configured) ? configured : paths.join(homeDir, "Documents") };
}

/** Native reads are isolated so cross-platform fixtures never execute registry commands. */
export function readOptionalText({ file }: { file: string }, _options = {}): string | undefined {
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
function readWindowsDocuments(): string | undefined {
  const output = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"], { encoding: "utf8", timeout: 3000, windowsHide: true });
  return /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(output)?.[1]?.trim();
}

/** OneDrive publishes account mount paths in HKCU; absent accounts are a normal empty result. */
export function readWindowsOneDriveRoots(_required: Record<string, never>, _options = {}): readonly string[] {
  try {
    const output = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\OneDrive\\Accounts", "/s", "/v", "UserFolder"], { encoding: "utf8", timeout: 3000, windowsHide: true });
    return [...output.matchAll(/UserFolder\s+REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/g)].map((match) => match[1]!.trim());
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}
