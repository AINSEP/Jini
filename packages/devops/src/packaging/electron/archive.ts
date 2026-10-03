import path from 'node:path';
import type { AsarHeaderNode, ArchiveReaderPort, PackagingFilesystemPort } from './ports.js';
export interface AsarMismatch { relPath: string; reason: string }
export interface AsarVerification { checkedCount: number; mismatches: AsarMismatch[] }

function safeEntry(value: string): void {
  if (!value || value.includes('\\') || value.includes('\0') || value.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error(`Unsafe archive entry: ${value}`);
}
/** Enumerate files only; symlinks carry no content. Missing prefixes are checked by verification. */
export function filesUnderPrefixes({ headerFiles, prefixes }: { headerFiles: Record<string, AsarHeaderNode> | undefined; prefixes: readonly string[] }): string[] {
  const paths = new Set<string>();
  function walk(node: AsarHeaderNode, current: string): void {
    safeEntry(current);
    if ('link' in node) return;
    if (node.files) for (const [name, child] of Object.entries(node.files)) walk(child, current + '/' + name);
    else paths.add(current);
  }
  for (const prefix of prefixes) {
    safeEntry(prefix);
    let node: AsarHeaderNode | undefined = { files: headerFiles ?? {} };
    for (const segment of prefix.split('/')) node = node?.files?.[segment];
    if (node) walk(node, prefix);
  }
  return [...paths];
}
/** The reader's separator is host supplied, keeping archive enumeration in POSIX form. */
export function toArchiveEntryPath({ relPath, separator }: { relPath: string; separator: string }): string {
  safeEntry(relPath);
  return relPath.split('/').join(separator);
}
/** Compare actual content: equal sizes and an archive's own hash cannot detect shifted offsets. */
export function verifyAsarAgainstSource(required: {
  archivePath: string; sourceRoot: string; prefixes: readonly string[]; separator: string;
  fs: PackagingFilesystemPort; archive: ArchiveReaderPort;
}): AsarVerification {
  const { archivePath, sourceRoot, prefixes, separator, fs, archive } = required;
  if (!prefixes.length) return { checkedCount: 0, mismatches: [{ relPath: '', reason: 'no checked archive prefixes supplied' }] };
  const { files: headerFiles } = archive.header({ archivePath });
  const relPaths = filesUnderPrefixes({ headerFiles, prefixes });
  const mismatches: AsarMismatch[] = prefixes.filter(prefix => !filesUnderPrefixes({ headerFiles, prefixes: [prefix] }).length)
    .map(relPath => ({ relPath, reason: 'nothing under this checked prefix is in app.asar' }));
  for (const relPath of relPaths) {
    let source: Uint8Array;
    try { source = fs.read({ path: path.join(sourceRoot, relPath) }); }
    catch { mismatches.push({ relPath, reason: 'shipped in app.asar but missing from the source tree' }); continue; }
    let shipped: Uint8Array;
    try { shipped = archive.read({ archivePath, entryPath: toArchiveEntryPath({ relPath, separator }) }); }
    catch (error) { mismatches.push({ relPath, reason: `present in the asar header but could not read it (${String(error)})` }); continue; }
    if (source.length !== shipped.length || !source.every((byte, index) => byte === shipped[index])) mismatches.push({ relPath, reason: 'content differs from source (compared byte-for-byte, never by length alone)' });
  }
  return { checkedCount: relPaths.length, mismatches };
}
export function isEmptyVerification({ checkedCount }: { checkedCount: number }): boolean { return checkedCount === 0; }
export function formatMismatchReport({ mismatches }: { mismatches: readonly AsarMismatch[] }): string {
  return [`${mismatches.length} file(s) in app.asar do NOT match source, byte-for-byte:`, ...mismatches.map(item => `  MISMATCH  ${item.relPath} — ${item.reason}`), 'Equal sizes can hide a packaging race that shifts archive offsets.'].join('\n');
}
/** Resources inventory is caller supplied; an empty inventory is a failure. */
export function bundledNpmFailures(required: { resourcesDirs: readonly string[]; requiredFiles: readonly string[]; fs: PackagingFilesystemPort }): string[] {
  if (!required.resourcesDirs.length) return ['no packaged resources directory was found to check for the bundled npm'];
  if (!required.requiredFiles.length) return ['no bundled npm files were specified to check'];
  return required.resourcesDirs.flatMap(dir => required.requiredFiles.map(relative => { safeEntry(relative); return path.join(dir, relative); }).filter(file => !required.fs.exists({ path: file })));
}
