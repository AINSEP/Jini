/** Exact installed-file comparison for exports; names and package digests alone prove nothing. */
export type BundledPluginFileDisposition = 'scan' | 'skip';

/** Host-owned read from the installed bundled package, never from the user's plugin tree. */
export type ReadBundledPluginFile = (required: { pluginId: string; relativePath: string }) => Promise<Uint8Array | null>;

/**
 * Compare export bytes to one installed bundled file. Identical bytes skip scanning; all files
 * stay in the archive. Missing/unreadable/changed/custom files receive full scanning.
 * @param required Candidate bytes and a reader restricted to the host's bundled package selection.
 * @returns A per-file export decision; grants no execution trust and never changes content.
 * @complexity O(path length + file bytes) time and one installed-file read; O(file bytes) memory.
 * @example classifyBundledPluginFile({ pluginId, relativePath, bytes, readFile });
 */
export async function classifyBundledPluginFile(required: {
  pluginId: string; relativePath: string; bytes: Uint8Array; readFile: ReadBundledPluginFile;
}, _optional: Record<string, never> = {}): Promise<BundledPluginFileDisposition> {
  const parts = required.relativePath.split('/');
  if (/[:\\\x00]/.test(required.relativePath) || parts.some(part => part === '' || part === '.' || part === '..')) return 'scan';
  const installed = await required.readFile({ pluginId: required.pluginId, relativePath: required.relativePath }).catch(() => null);
  const candidate = Buffer.from(required.bytes.buffer, required.bytes.byteOffset, required.bytes.byteLength);
  if (installed === null || !candidate.equals(installed)) return 'scan';
  return 'skip';
}
