import type { DiagnosticsFilesystemPort } from "./ports.js";

/** Discovery is best-effort: an unreadable directory contributes no candidates. */
export async function readDirectorySafe(
  { path, filesystem }: { path: string; filesystem: DiagnosticsFilesystemPort },
  _options: Record<string, never> = {},
): ReturnType<DiagnosticsFilesystemPort["readDirectory"]> {
  try {
    return await filesystem.readDirectory({ absolutePath: path });
  } catch {
    return [];
  }
}

export async function statSafe(
  { path, filesystem }: { path: string; filesystem: DiagnosticsFilesystemPort },
  _options: Record<string, never> = {},
): Promise<{ mtimeMs: number; isFile: boolean } | null> {
  try {
    const info = await filesystem.stat({ absolutePath: path });
    return { mtimeMs: info.mtimeMs, isFile: info.isFile };
  } catch {
    return null;
  }
}

