import type { DiagnosticsFilesystemPort } from "../ports.js";

type DirectoryEntries = Awaited<ReturnType<DiagnosticsFilesystemPort["readDirectory"]>>;
type FileInfo = Awaited<ReturnType<DiagnosticsFilesystemPort["stat"]>>;

export function discoveryFilesystem(
  { directories, stats }: {
    directories: Record<string, DirectoryEntries | Error>;
    stats: Record<string, FileInfo | Error>;
  },
  { directoryReads = [], statReads = [] }: { directoryReads?: string[]; statReads?: string[] } = {},
): DiagnosticsFilesystemPort {
  return {
    async readFile() { throw new Error("Discovery must not read file contents"); },
    async readDirectory({ absolutePath }) {
      directoryReads.push(absolutePath);
      const entries = directories[absolutePath];
      if (entries === undefined) throw new Error(`Missing directory: ${absolutePath}`);
      if (entries instanceof Error) throw entries;
      return entries;
    },
    async stat({ absolutePath }) {
      statReads.push(absolutePath);
      const info = stats[absolutePath];
      if (info === undefined) throw new Error(`Missing file: ${absolutePath}`);
      if (info instanceof Error) throw info;
      return info;
    },
  };
}
