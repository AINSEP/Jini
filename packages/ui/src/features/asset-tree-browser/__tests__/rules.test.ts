// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  basenameForRename,
  buildBreadcrumbSegments,
  canCopyLocalPath,
  computeMenuPosition,
  countFilesUnderDir,
  deriveTreeChildren,
  extensionForMimeType,
  fileExtensionLabel,
  filesFromClipboardData,
  filesFromDataTransfer,
  filesFromFileSystemEntry,
  groupFilesByKind,
  humanBytes,
  isDoubleActivation,
  nextExistingAncestorDir,
  normalizePastedFile,
  pruneMissingPaths,
  relativeTimeResult,
  resolveKindConfig,
  resolveRenameCommit,
  shouldIgnoreClipboardFilePaste,
  toggleInSet,
} from '../rules.js';
import type { AssetTreeSelectors } from '../types.js';

interface TestFile {
  path: string;
  kind: string;
  mtime: number;
  localPath: string | null;
}

function file(path: string, kind = 'text', mtime = 0, localPath: string | null = null): TestFile {
  return { path, kind, mtime, localPath };
}

describe('deriveTreeChildren', () => {
  it('at the root, flattens every file (including nested) and surfaces the top-level dir', () => {
    const files = [file('a.txt'), file('dir/b.txt'), file('dir/sub/c.txt')];
    const result = deriveTreeChildren(files, [], '');
    expect(result.dirsAtCurrentDir).toEqual(['dir']);
    expect(result.filesAtCurrentDir.map((f) => f.path).sort()).toEqual(['a.txt', 'dir/b.txt', 'dir/sub/c.txt']);
  });

  it('inside a directory, scopes to files exactly one level deep', () => {
    const files = [file('dir/b.txt'), file('dir/sub/c.txt')];
    const result = deriveTreeChildren(files, [], 'dir');
    expect(result.dirsAtCurrentDir).toEqual(['sub']);
    expect(result.filesAtCurrentDir.map((f) => f.path)).toEqual(['dir/b.txt']);
  });

  it('ignores files outside the current prefix', () => {
    const files = [file('other/x.txt')];
    const result = deriveTreeChildren(files, [], 'dir');
    expect(result.filesAtCurrentDir).toEqual([]);
    expect(result.dirsAtCurrentDir).toEqual([]);
  });

  it('surfaces a persisted empty folder as a subdirectory', () => {
    const result = deriveTreeChildren([], [{ path: 'empty' }], '');
    expect(result.dirsAtCurrentDir).toEqual(['empty']);
  });

  it('surfaces a nested persisted folder correctly scoped to its parent', () => {
    const result = deriveTreeChildren([], [{ path: 'dir/nested-empty' }], 'dir');
    expect(result.dirsAtCurrentDir).toEqual(['nested-empty']);
  });

  it('skips a persisted folder path that equals the current directory itself (via prefix mismatch: "dir" never starts with "dir/")', () => {
    const result = deriveTreeChildren([], [{ path: 'dir' }], 'dir');
    expect(result.dirsAtCurrentDir).toEqual([]);
  });

  it('skips a persisted folder record whose path, after stripping the prefix, is empty (the degenerate "root describing itself" case)', () => {
    // Distinct from the previous test: this exercises the `!remainder`
    // `continue` specifically, which requires `folder.path` to literally
    // equal the prefix (here, the root's prefix is `''`, so an empty-path
    // folder record matches it) rather than fail the earlier
    // `startsWith(prefix)` check.
    const result = deriveTreeChildren([], [{ path: '' }], '');
    expect(result.dirsAtCurrentDir).toEqual([]);
  });

  it('scopes a persisted folder nested two levels below the current directory to its immediate child segment', () => {
    const result = deriveTreeChildren([], [{ path: 'dir/sub/deep' }], 'dir');
    expect(result.dirsAtCurrentDir).toEqual(['sub']);
  });

  it('sorts dirsAtCurrentDir alphabetically', () => {
    const files = [file('zeta/x.txt'), file('alpha/x.txt')];
    const result = deriveTreeChildren(files, [], '');
    expect(result.dirsAtCurrentDir).toEqual(['alpha', 'zeta']);
  });
});

describe('countFilesUnderDir', () => {
  it('counts files at every depth under the directory, not just the immediate level', () => {
    const files = [file('dir/a.txt'), file('dir/sub/b.txt'), file('dir/sub/deep/c.txt'), file('other/x.txt')];
    expect(countFilesUnderDir(files, 'dir')).toBe(3);
  });

  it('returns 0 for a directory with no files under it', () => {
    expect(countFilesUnderDir([file('a.txt')], 'empty')).toBe(0);
  });

  it('does not count a file whose name merely starts with the dir name as a prefix (no slash)', () => {
    expect(countFilesUnderDir([file('dirextra.txt')], 'dir')).toBe(0);
  });
});

describe('fileExtensionLabel', () => {
  it('uppercases the extension', () => expect(fileExtensionLabel('a/b.txt')).toBe('TXT'));
  it('empty for a path with no extension', () => expect(fileExtensionLabel('README')).toBe(''));
  it('empty for a path ending in a bare dot', () => expect(fileExtensionLabel('a.')).toBe(''));
});

describe('groupFilesByKind', () => {
  it('orders configured kinds first, then unconfigured kinds in first-seen order', () => {
    const files = [file('a.css', 'stylesheet', 1), file('b.mp3', 'audio', 2), file('c.ts', 'code', 3)];
    const sections = groupFilesByKind(files, ['code', 'stylesheet'], (f) => f.kind, (f) => f.mtime);
    expect(sections.map((s) => s.kind)).toEqual(['code', 'stylesheet', 'audio']);
  });

  it('sorts files within each section by most-recently-modified first', () => {
    const files = [file('old.txt', 'text', 1), file('mid.txt', 'text', 5), file('new.txt', 'text', 10)];
    const sections = groupFilesByKind(files, [], (f) => f.kind, (f) => f.mtime);
    expect(sections[0]!.files.map((f) => f.path)).toEqual(['new.txt', 'mid.txt', 'old.txt']);
  });

  it('returns no sections for an empty file list', () => {
    expect(groupFilesByKind([], ['code'], (f: TestFile) => f.kind, (f: TestFile) => f.mtime)).toEqual([]);
  });

  it('omits a configured kind absent from the files', () => {
    const sections = groupFilesByKind([file('a.ts', 'code')], ['code', 'stylesheet'], (f) => f.kind, (f) => f.mtime);
    expect(sections.map((s) => s.kind)).toEqual(['code']);
  });
});

describe('nextExistingAncestorDir', () => {
  it('returns null at the root', () => {
    expect(nextExistingAncestorDir([], [], '')).toBeNull();
  });

  it('returns null when the current directory still has files under it', () => {
    expect(nextExistingAncestorDir([file('dir/a.txt')], [], 'dir')).toBeNull();
  });

  it('returns null when the current directory is itself a persisted folder', () => {
    expect(nextExistingAncestorDir([], [{ path: 'dir' }], 'dir')).toBeNull();
  });

  it('walks up to the nearest existing ancestor', () => {
    expect(nextExistingAncestorDir([file('a/other.txt')], [], 'a/b/c')).toBe('a');
  });

  it('falls back to the root when no ancestor exists', () => {
    expect(nextExistingAncestorDir([], [], 'a/b/c')).toBe('');
  });

  it('treats a persisted folder nested under an ancestor as proof the ancestor exists', () => {
    expect(nextExistingAncestorDir([], [{ path: 'a/kept' }], 'a/b/c')).toBe('a');
  });
});

describe('selection helpers', () => {
  it('toggleInSet adds then removes', () => {
    let s = toggleInSet(new Set(), 'a');
    expect([...s]).toEqual(['a']);
    s = toggleInSet(s, 'a');
    expect(s.size).toBe(0);
  });

  it('pruneMissingPaths returns the exact same reference when prev is empty', () => {
    const prev = new Set<string>();
    expect(pruneMissingPaths(prev, [])).toBe(prev);
  });

  it('pruneMissingPaths returns the exact same reference when nothing was pruned', () => {
    const prev = new Set(['a']);
    expect(pruneMissingPaths(prev, ['a', 'b'])).toBe(prev);
  });

  it('pruneMissingPaths drops paths absent from livePaths', () => {
    const prev = new Set(['a', 'b']);
    const next = pruneMissingPaths(prev, ['b']);
    expect([...next]).toEqual(['b']);
    expect(next).not.toBe(prev);
  });
});

describe('rename helpers', () => {
  it('basenameForRename strips the currentDir prefix', () => {
    expect(basenameForRename('dir/file.txt', 'dir')).toBe('file.txt');
    expect(basenameForRename('file.txt', '')).toBe('file.txt');
  });

  it('resolveRenameCommit rejects an empty draft', () => {
    expect(resolveRenameCommit('a.txt', '', '   ')).toBeNull();
  });

  it('resolveRenameCommit rejects a no-op rename (draft resolves back to the same path)', () => {
    expect(resolveRenameCommit('a.txt', '', 'a.txt')).toBeNull();
  });

  it('resolveRenameCommit returns the resolved next path at the root', () => {
    expect(resolveRenameCommit('a.txt', '', 'b.txt')).toEqual({ nextPath: 'b.txt' });
  });

  it('resolveRenameCommit prefixes currentDir for a nested rename', () => {
    expect(resolveRenameCommit('dir/a.txt', 'dir', 'b.txt')).toEqual({ nextPath: 'dir/b.txt' });
  });
});

describe('computeMenuPosition', () => {
  it('opens below the anchor when there is room', () => {
    expect(computeMenuPosition({ top: 100, bottom: 120, right: 300 }, 800)).toEqual({ top: 124, left: 140 });
  });

  it('opens above the anchor when there is no room below but room above', () => {
    expect(computeMenuPosition({ top: 700, bottom: 720, right: 300 }, 750)).toEqual({ top: 516, left: 140 });
  });

  it('clamps to the viewport when there is no room above or below', () => {
    const result = computeMenuPosition({ top: 100, bottom: 110, right: 300 }, 200);
    expect(result.top).toBe(12);
  });

  it('clamps left to the safe padding when the anchor is near the left edge', () => {
    const result = computeMenuPosition({ top: 0, bottom: 20, right: 50 }, 800);
    expect(result.left).toBe(8);
  });

  it('honors custom estimatedHeight/safePadding options', () => {
    const result = computeMenuPosition({ top: 0, bottom: 20, right: 300 }, 100, { estimatedHeight: 10, safePadding: 2 });
    expect(result.top).toBe(24);
  });
});

describe('canCopyLocalPath', () => {
  const selectorsWithLocal: AssetTreeSelectors<TestFile> = {
    getSize: () => 0,
    getModifiedAt: (f) => f.mtime,
    getKind: (f) => f.kind,
    getLocalPath: (f) => f.localPath,
  };
  const selectorsWithoutLocal: AssetTreeSelectors<TestFile> = {
    getSize: () => 0,
    getModifiedAt: (f) => f.mtime,
    getKind: (f) => f.kind,
  };

  it('true when getLocalPath returns a non-empty string', () => {
    expect(canCopyLocalPath(file('a.txt', 'text', 0, '/a.txt'), selectorsWithLocal)).toBe(true);
  });

  it('false when getLocalPath returns null', () => {
    expect(canCopyLocalPath(file('a.txt', 'text', 0, null), selectorsWithLocal)).toBe(false);
  });

  it('false when the selectors have no getLocalPath at all', () => {
    expect(canCopyLocalPath(file('a.txt'), selectorsWithoutLocal)).toBe(false);
  });
});

describe('isDoubleActivation', () => {
  it('false when there is no prior timestamp', () => {
    expect(isDoubleActivation(undefined, 1000)).toBe(false);
  });

  it('true within the window', () => {
    expect(isDoubleActivation(1000, 1200, 300)).toBe(true);
  });

  it('false outside the window', () => {
    expect(isDoubleActivation(1000, 1400, 300)).toBe(false);
  });
});

describe('resolveKindConfig', () => {
  it('returns the configured entry when present', () => {
    expect(resolveKindConfig('image', { image: { label: 'Images', glyph: 'IMG' } })).toEqual({
      label: 'Images',
      glyph: 'IMG',
    });
  });

  it('falls back to the raw kind key and the default glyph when unconfigured', () => {
    expect(resolveKindConfig('mystery', {})).toEqual({ label: 'mystery', glyph: '·' });
  });
});

describe('humanBytes', () => {
  it('formats bytes', () => expect(humanBytes(500)).toBe('500 B'));
  it('formats kilobytes', () => expect(humanBytes(2048)).toBe('2.0 KB'));
  it('formats megabytes', () => expect(humanBytes(5 * 1024 * 1024)).toBe('5.0 MB'));
});

describe('relativeTimeResult', () => {
  const now = 1_000_000_000;
  it('just now', () => expect(relativeTimeResult(now - 1000, now)).toEqual({ label: 'Just now', translatable: true }));
  it('minutes ago', () =>
    expect(relativeTimeResult(now - 5 * 60_000, now)).toEqual({ label: '{n}m ago', translatable: true, params: { n: 5 } }));
  it('hours ago', () =>
    expect(relativeTimeResult(now - 3 * 3_600_000, now)).toEqual({ label: '{n}h ago', translatable: true, params: { n: 3 } }));
  it('days ago', () =>
    expect(relativeTimeResult(now - 2 * 86_400_000, now)).toEqual({ label: '{n}d ago', translatable: true, params: { n: 2 } }));
  it('weeks ago', () =>
    expect(relativeTimeResult(now - 10 * 86_400_000, now)).toEqual({
      label: '{n}w ago',
      translatable: true,
      params: { n: 1 },
    }));
  it('falls back to a locale date beyond 30 days, non-translatable', () => {
    const ts = now - 40 * 86_400_000;
    const result = relativeTimeResult(ts, now);
    expect(result.translatable).toBe(false);
    expect(result.label).toBe(new Date(ts).toLocaleDateString());
  });
});

describe('buildBreadcrumbSegments', () => {
  it('empty at the root', () => expect(buildBreadcrumbSegments('')).toEqual([]));
  it('one segment per path component, marking the last', () => {
    expect(buildBreadcrumbSegments('a/b/c')).toEqual([
      { path: 'a', label: 'a', isLast: false },
      { path: 'a/b', label: 'b', isLast: false },
      { path: 'a/b/c', label: 'c', isLast: true },
    ]);
  });
});

describe('filesFromClipboardData', () => {
  it('null clipboardData yields no files', () => {
    expect(filesFromClipboardData(null)).toEqual([]);
  });

  it('prefers clipboardData.files when present', () => {
    const f = new File(['x'], 'x.png');
    const files = filesFromClipboardData({ files: [f], items: [] } as unknown as DataTransfer);
    expect(files).toEqual([f]);
  });

  it('falls back to file-kind items via getAsFile, skipping non-file items and null getAsFile results', () => {
    const f = new File(['x'], 'x.png');
    const items = [
      { kind: 'file', getAsFile: () => f },
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => null },
    ];
    const files = filesFromClipboardData({ files: [], items } as unknown as DataTransfer);
    expect(files).toEqual([f]);
  });
});

describe('normalizePastedFile', () => {
  it('passes through a file that already has a name', () => {
    const f = new File(['x'], 'x.png');
    expect(normalizePastedFile(f)).toBe(f);
  });

  it('synthesizes a timestamped name for an unnamed file', () => {
    const f = new File(['x'], '', { type: 'image/png' });
    const result = normalizePastedFile(f);
    expect(result.name).toMatch(/^pasted-.*\.png$/);
  });
});

describe('extensionForMimeType', () => {
  it.each([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/gif', '.gif'],
    ['image/webp', '.webp'],
    ['image/svg+xml', '.svg'],
    ['text/html', '.html'],
    ['text/plain', '.txt'],
    ['application/octet-stream', ''],
  ])('%s -> %s', (mime, ext) => {
    expect(extensionForMimeType(mime)).toBe(ext);
  });
});

describe('shouldIgnoreClipboardFilePaste', () => {
  it('false for a non-HTMLElement target', () => {
    expect(shouldIgnoreClipboardFilePaste(null)).toBe(false);
  });

  it('true for a contenteditable ancestor', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    div.appendChild(span);
    expect(shouldIgnoreClipboardFilePaste(span)).toBe(true);
  });

  it.each(['input', 'textarea', 'select'])('true for a %s target', (tag) => {
    expect(shouldIgnoreClipboardFilePaste(document.createElement(tag))).toBe(true);
  });

  it('false for a generic element', () => {
    expect(shouldIgnoreClipboardFilePaste(document.createElement('div'))).toBe(false);
  });
});

describe('filesFromDataTransfer', () => {
  it('falls back to dataTransfer.files when there are no items', async () => {
    const f = new File(['x'], 'x.txt');
    const result = await filesFromDataTransfer({ items: [], files: [f] } as unknown as DataTransfer);
    expect(result).toEqual([f]);
  });

  it('treats a missing (undefined) items list the same as an empty one', async () => {
    const f = new File(['x'], 'x.txt');
    const result = await filesFromDataTransfer({ items: undefined, files: [f] } as unknown as DataTransfer);
    expect(result).toEqual([f]);
  });

  it('treats a missing (undefined) files list the same as an empty one', async () => {
    const item = { kind: 'file', getAsFile: () => new File(['x'], 'x.txt') } as unknown as DataTransferItem;
    const result = await filesFromDataTransfer({ items: [item], files: undefined } as unknown as DataTransfer);
    expect(result).toHaveLength(1);
  });

  it('reads a file-kind item with no entry API via getAsFile', async () => {
    const f = new File(['x'], 'x.txt');
    const item = { kind: 'file', getAsFile: () => f } as unknown as DataTransferItem;
    const result = await filesFromDataTransfer({ items: [item], files: [] } as unknown as DataTransfer);
    expect(result).toEqual([f]);
  });

  it('drops a non-file item with no entry API and no fallback', async () => {
    const item = { kind: 'string', getAsFile: () => null } as unknown as DataTransferItem;
    const result = await filesFromDataTransfer({ items: [item], files: [] } as unknown as DataTransfer);
    expect(result).toEqual([]);
  });

  it('recursively expands a dropped folder entry, tagging the nested file with its relative path', async () => {
    const nestedFile = new File(['x'], 'nested.txt');
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      fullPath: '/my-folder/nested.txt',
      file: (success: (f: File) => void) => success(nestedFile),
    } as unknown as FileSystemEntry;
    let readCalls = 0;
    const dirEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (success: (entries: FileSystemEntry[]) => void) => {
          readCalls += 1;
          success(readCalls === 1 ? [fileEntry] : []);
        },
      }),
    } as unknown as FileSystemEntry;
    const item = {
      kind: 'file',
      webkitGetAsEntry: () => dirEntry,
    } as unknown as DataTransferItem;
    const result = await filesFromDataTransfer({ items: [item], files: [] } as unknown as DataTransfer);
    expect(result).toEqual([nestedFile]);
    expect((result[0] as { relativePath?: string }).relativePath).toBe('my-folder/nested.txt');
  });

  it('preserves a two-level folder structure across sibling files and a nested subdirectory', async () => {
    const rootFile = new File(['x'], 'readme.txt');
    const rootFileEntry = {
      isFile: true,
      isDirectory: false,
      fullPath: '/project/readme.txt',
      file: (success: (f: File) => void) => success(rootFile),
    } as unknown as FileSystemEntry;
    const nestedFile = new File(['x'], 'a.txt');
    const nestedFileEntry = {
      isFile: true,
      isDirectory: false,
      fullPath: '/project/sub/a.txt',
      file: (success: (f: File) => void) => success(nestedFile),
    } as unknown as FileSystemEntry;
    let subReadCalls = 0;
    const subDirEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (success: (entries: FileSystemEntry[]) => void) => {
          subReadCalls += 1;
          success(subReadCalls === 1 ? [nestedFileEntry] : []);
        },
      }),
    } as unknown as FileSystemEntry;
    let rootReadCalls = 0;
    const rootDirEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (success: (entries: FileSystemEntry[]) => void) => {
          rootReadCalls += 1;
          success(rootReadCalls === 1 ? [rootFileEntry, subDirEntry] : []);
        },
      }),
    } as unknown as FileSystemEntry;
    const item = { kind: 'file', webkitGetAsEntry: () => rootDirEntry } as unknown as DataTransferItem;

    const result = await filesFromDataTransfer({ items: [item], files: [] } as unknown as DataTransfer);

    const byName = new Map(result.map((f) => [f.name, (f as { relativePath?: string }).relativePath]));
    expect(byName.get('readme.txt')).toBe('project/readme.txt');
    expect(byName.get('a.txt')).toBe('project/sub/a.txt');
  });

  it('falls back to dataTransfer.files when every item entry read rejects', async () => {
    const fallback = new File(['x'], 'fallback.txt');
    const failingEntry = {
      isFile: true,
      isDirectory: false,
      file: (_success: (f: File) => void, error: (e: DOMException) => void) => error(new DOMException('nope')),
    } as unknown as FileSystemEntry;
    const item = { kind: 'file', webkitGetAsEntry: () => failingEntry } as unknown as DataTransferItem;
    const result = await filesFromDataTransfer({ items: [item], files: [fallback] } as unknown as DataTransfer);
    expect(result).toEqual([fallback]);
  });

  it('throws when every item entry read rejects and there is no fallback', async () => {
    const failingEntry = {
      isFile: true,
      isDirectory: false,
      file: (_success: (f: File) => void, error: (e: DOMException) => void) => error(new DOMException('nope')),
    } as unknown as FileSystemEntry;
    const item = { kind: 'file', webkitGetAsEntry: () => failingEntry } as unknown as DataTransferItem;
    await expect(filesFromDataTransfer({ items: [item], files: [] } as unknown as DataTransfer)).rejects.toThrow();
  });
});

describe('filesFromFileSystemEntry', () => {
  it('resolves a file entry, tagged with its relative path derived from fullPath', async () => {
    const f = new File(['x'], 'x.txt');
    const entry = {
      isFile: true,
      isDirectory: false,
      fullPath: '/x.txt',
      file: (success: (f: File) => void) => success(f),
    } as unknown as FileSystemEntry;
    const result = await filesFromFileSystemEntry(entry);
    expect(result).toEqual([f]);
    expect((result[0] as { relativePath?: string }).relativePath).toBe('x.txt');
  });

  it('returns empty for a directory entry with no createReader', async () => {
    const entry = { isFile: false, isDirectory: true } as unknown as FileSystemEntry;
    await expect(filesFromFileSystemEntry(entry)).resolves.toEqual([]);
  });

  it('returns empty for an entry that is neither a file nor a directory', async () => {
    const entry = { isFile: false, isDirectory: false } as unknown as FileSystemEntry;
    await expect(filesFromFileSystemEntry(entry)).resolves.toEqual([]);
  });

  it('rejects when a folder read fails', async () => {
    const entry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (_success: (e: FileSystemEntry[]) => void, error: (e: DOMException) => void) =>
          error(new DOMException('boom')),
      }),
    } as unknown as FileSystemEntry;
    await expect(filesFromFileSystemEntry(entry)).rejects.toThrow(/Could not read dropped folder/);
  });
});
