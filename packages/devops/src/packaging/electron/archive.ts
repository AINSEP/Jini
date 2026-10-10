// Preserved Tovu rationale below: VERIFIED_PREFIXES and scripts/verify-package.ts are host-owned;
// archivePath/entryPath/separator and filesystem/archive ports replace the old SDK parameters.
import path from 'node:path';
import type { AsarHeaderNode, ArchiveReaderPort, PackagingFilesystemPort } from './ports.js';
export interface AsarMismatch { relPath: string; reason: string }
export interface AsarVerification { checkedCount: number; mismatches: AsarMismatch[] }

function safeEntry(value: string): void {
  if (!value || value.includes('\\') || value.includes('\0') || value.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error(`Unsafe archive entry: ${value}`);
}
/**
 * Every leaf FILE path (POSIX, no leading slash) under one of `prefixes` in an asar header's `files`
 * metadata tree. Pure and dependency-free — takes the already-parsed header object rather than an
 * archive path — so the tree-walk itself (files vs. directories vs. symlinks, and a prefix that
 * names a file directly, like `"main.ts"`, vs. one that names a directory, like `"src"`) is testable
 * against a plain object literal fixture, with no real `.asar` file anywhere near the test.
 *
 * @param headerFiles the `files` object from `getRawHeader(archivePath).header`.
 * @param prefixes top-level entry names to include, e.g. `["src", "bin", "main.ts"]`. A prefix
 *   absent from the archive is silently skipped — that is a scope decision for the caller, not
 *   something this function should fail on.
 * @returns POSIX-style relative paths, e.g. `"src/tracked-sites.ts"`.
 * @complexity O(n) in archive entries under the given prefixes.
 */
export function filesUnderPrefixes({ headerFiles, prefixes }: { headerFiles: Record<string, AsarHeaderNode> | undefined; prefixes: readonly string[] }): string[] {
  const paths = new Set<string>();
  function walk(node: AsarHeaderNode, current: string): void {
    safeEntry(current);
    // A leaf is either a file (`size`/`offset`) or a symlink (`link`). Symlinks carry no bytes of
    // their own to compare and this repo's desktop archive has none under src/bin, so they are
    // simply excluded rather than treated as an error.
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
/**
 * Converts a POSIX-style archive-relative path (as {@link filesUnderPrefixes} always produces,
 * e.g. `"src/sub/b.js"`) to the separator `extractFile` actually needs on this host.
 * `@electron/asar`'s own `searchNodeFromDirectory` walks the parsed header tree by splitting the
 * path it is given on the HOST OS's `path.sep` — so on win32, a `/`-joined relPath has no backslash
 * to split on, is treated as a single segment name that does not exist at the archive root, and the
 * lookup fails even though the entry is genuinely present in the header. Kept as a pure,
 * injectable-separator function (rather than reading `path.sep` internally with no override) so the
 * win32 branch is provable on any host OS, including this suite's macOS/Linux CI.
 *
 * @param relPath POSIX-style, e.g. `"src/sub/b.js"`.
 * @param sep the separator to convert to; defaults to this host's real `path.sep`.
 * @complexity O(n) in path length.
 */
export function toArchiveEntryPath({ relPath, separator }: { relPath: string; separator: string }): string {
  safeEntry(relPath);
  return relPath.split('/').join(separator);
}
/** Compare actual content: equal sizes and an archive's own hash cannot detect shifted offsets. */
export function verifyAsarAgainstSource(required: {
  archivePath: string; sourceRoot: string; prefixes: readonly string[]; separator: string;
  fs: PackagingFilesystemPort; archive: ArchiveReaderPort;
}, optional: { readFailureMessage?: (required: { error: unknown }) => string; contentMismatchMessage?: string } = {}): AsarVerification {
  const { archivePath, sourceRoot, prefixes, separator, fs, archive } = required;
  if (!prefixes.length) return { checkedCount: 0, mismatches: [{ relPath: '', reason: 'no checked archive prefixes supplied' }] };
  const { files: headerFiles } = archive.header({ archivePath });
  const relPaths = filesUnderPrefixes({ headerFiles, prefixes });
  // Per prefix, not just in total: a whole missing `bin/` hides behind a non-zero count from `src`.
  const mismatches: AsarMismatch[] = prefixes.filter(prefix => !filesUnderPrefixes({ headerFiles, prefixes: [prefix] }).length)
    .map(relPath => ({ relPath, reason: 'nothing under this checked prefix is in app.asar' }));
  for (const relPath of relPaths) {
    let source: Uint8Array;
    try { source = fs.read({ path: path.join(sourceRoot, relPath) }); }
    catch { mismatches.push({ relPath, reason: 'shipped in app.asar but missing from the source tree' }); continue; }
    // No leading slash: `extractFile`'s path argument is resolved relative to the archive root by
    // splitting on the OS path separator (`filesystem.js`'s `searchNodeFromDirectory`), and a
    // leading "/" produces a spurious empty first segment that walks into a fresh, empty directory
    // node instead of the real root — silently "not found" for every nested path. This is the
    // opposite convention from `listPackage()`'s OUTPUT, which prefixes every entry with "/" for
    // display; that display format is not the input format `extractFile` expects.
    let shipped: Uint8Array;
    try { shipped = archive.read({ archivePath, entryPath: toArchiveEntryPath({ relPath, separator }) }); }
    catch (error) { mismatches.push({ relPath, reason: optional.readFailureMessage?.({ error }) ?? `present in the asar header but could not read it (${String(error)})` }); continue; }
    if (source.length !== shipped.length || !source.every((byte, index) => byte === shipped[index])) mismatches.push({ relPath, reason: optional.contentMismatchMessage ?? 'content differs from source (compared byte-for-byte, never by length alone)' });
  }
  return { checkedCount: relPaths.length, mismatches };
}
/**
 * `checkedCount === 0` is never a clean pass — the walk found nothing to compare at all, which
 * almost always means a path-separator mismatch (see {@link toArchiveEntryPath}) or a stale
 * `VERIFIED_PREFIXES` entry hid every real file from the check before a single byte was compared.
 * Exported so `scripts/verify-package.ts` can turn "verified nothing" into a hard `exit 1` instead
 * of a false green, and so that decision — not the process exit itself — is unit-testable.
 *
 * @param checkedCount `verifyAsarAgainstSource`'s returned count.
 * @complexity O(1).
 */
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
