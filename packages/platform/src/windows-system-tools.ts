import { win32 } from "node:path";

/**
 * Absolute path of a Windows system tool under `%SystemRoot%\System32`. A bare name such as
 * `reg.exe` is resolved by the child-process search, which on Windows consults the current
 * directory before PATH, so a same-named file in a project folder could run instead of the OS tool.
 * Falls back to `C:\Windows` when the environment does not name the system root.
 * @complexity O(1).
 */
export function windowsSystemTool(
  { relativePath }: { relativePath: readonly string[] },
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {},
): string {
  return win32.join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", ...relativePath);
}

/** Windows PowerShell 5.1, which ships with every supported Windows release. */
export function windowsPowerShell(): string {
  return windowsSystemTool({ relativePath: ["WindowsPowerShell", "v1.0", "powershell.exe"] });
}
