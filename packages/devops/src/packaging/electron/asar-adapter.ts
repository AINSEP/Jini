import type { ArchiveReaderPort } from './ports.js';
import type { AsarHeaderNode } from "@jini-ai/core/contracts/site/packaging-electron";
/** Bind @electron/asar in the host rather than depending on the packaging SDK in core. */
export function createAsarArchiveReader({ asar }: { asar: {
  getRawHeader(archivePath: string): { header: { files?: Record<string, AsarHeaderNode> } };
  extractFile(archivePath: string, entryPath: string): Uint8Array;
} }, _optional: Record<string, never> = {}): ArchiveReaderPort {
  return { header: ({ archivePath }) => asar.getRawHeader(archivePath).header, read: ({ archivePath, entryPath }) => asar.extractFile(archivePath, entryPath) };
}
