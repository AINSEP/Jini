import type { ArchiveReaderPort, AsarHeaderNode } from './ports.js';
/** Bind @electron/asar in the host rather than depending on the packaging SDK in core. */
export function createAsarArchiveReader({ asar }: { asar: {
  getRawHeader(archivePath: string): { header: { files?: Record<string, AsarHeaderNode> } };
  extractFile(archivePath: string, entryPath: string): Uint8Array;
} }): ArchiveReaderPort {
  return { header: ({ archivePath }) => asar.getRawHeader(archivePath).header, read: ({ archivePath, entryPath }) => asar.extractFile(archivePath, entryPath) };
}
