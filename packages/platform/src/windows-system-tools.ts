import { win32 } from "node:path";

/**
 * Absolute path of a Windows system tool under `%SystemRoot%\System32`. A bare name such as
 * `reg.exe` is resolved by the child-process search, which on Windows consults the current
 * directory before PATH, so a same-named file in a project folder could run instead of the OS tool.
 * Falls back to `C:\Windows` when the environment does not name the system root.
 * @complexity O(e) for e environment keys.
 */
export function windowsSystemTool(
  { relativePath, env }: { relativePath: readonly string[]; env: NodeJS.ProcessEnv },
): string {
  const windowsEnv = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]));
  return win32.join(windowsEnv.systemroot ?? windowsEnv.windir ?? "C:\\Windows", "System32", ...relativePath);
}

/** Windows PowerShell 5.1, which ships with every supported Windows release. */
export function windowsPowerShell({ env }: { env: NodeJS.ProcessEnv }): string {
  return windowsSystemTool({ relativePath: ["WindowsPowerShell", "v1.0", "powershell.exe"], env });
}
