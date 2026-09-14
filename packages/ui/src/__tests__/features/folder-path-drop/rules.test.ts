import { describe, expect, it } from 'vitest';

import * as core from '../../../core.js';
import type { FolderPathDropPort } from '../../../features/folder-path-drop/ports.js';
import {
  captureFolderPathDrop,
  folderPathsFromDataTransfer,
  formatDroppedFolderPaths,
} from '../../../features/folder-path-drop/rules.js';

// Plain-object stand-ins for `DataTransfer`/`DataTransferItem`/`FileSystemEntry`/`File`: nothing under
// test reads a real DOM property, only `kind`, `webkitGetAsEntry`, `isDirectory`, `items` and `files`.
// This directory runs in the `node` environment (`vitest.config.ts`), which also proves the rules
// need no DOM.

/** Identity is all a fake file needs: it only ever passes through the port. */
function fakeFile(id: string): File {
  return { id } as unknown as File;
}

function fakeEntry(isDirectory: boolean): FileSystemEntry {
  return { isDirectory } as unknown as FileSystemEntry;
}

/** Omit `getEntry` for a drag that never defines `webkitGetAsEntry`; `() => null` for one that resolves nothing. */
function fakeFileItem(getEntry?: () => FileSystemEntry | null): DataTransferItem {
  return { kind: 'file', webkitGetAsEntry: getEntry } as unknown as DataTransferItem;
}

/** E.g. the `text/uri-list` string item macOS Finder adds beside a dropped folder. */
function fakeStringItem(): DataTransferItem {
  return { kind: 'string' } as unknown as DataTransferItem;
}

function fakeDataTransfer(items: DataTransferItem[] | undefined, files: File[] | undefined): DataTransfer {
  return { items, files } as unknown as DataTransfer;
}

/** Answers only for the given files and `''` otherwise — `webUtils.getPathForFile`'s real contract. */
function portFrom(paths: ReadonlyMap<File, string>): FolderPathDropPort {
  return { getPathForFile: (file) => paths.get(file) ?? '' };
}

function constantPort(path: string): FolderPathDropPort {
  return { getPathForFile: () => path };
}

describe('folderPathsFromDataTransfer', () => {
  it('returns no paths for a drop with neither items nor files', () => {
    expect(folderPathsFromDataTransfer(fakeDataTransfer(undefined, undefined), constantPort('/unused'))).toEqual([]);
  });

  it('skips a non-file item (e.g. the text/uri-list string item Finder adds alongside a folder)', () => {
    expect(folderPathsFromDataTransfer(fakeDataTransfer([fakeStringItem()], []), constantPort('/unused'))).toEqual([]);
  });

  it('skips a file item whose entry is not a directory', () => {
    const file = fakeFile('loose-file');
    const dataTransfer = fakeDataTransfer([fakeFileItem(() => fakeEntry(false))], [file]);
    expect(folderPathsFromDataTransfer(dataTransfer, portFrom(new Map([[file, '/should-not-appear']])))).toEqual([]);
  });

  it('skips a file item whose webkitGetAsEntry() resolves to null', () => {
    const file = fakeFile('no-entry');
    const dataTransfer = fakeDataTransfer([fakeFileItem(() => null)], [file]);
    expect(folderPathsFromDataTransfer(dataTransfer, portFrom(new Map([[file, '/should-not-appear']])))).toEqual([]);
  });

  it('skips a file item on a drag that never defines webkitGetAsEntry at all', () => {
    const file = fakeFile('no-method');
    const dataTransfer = fakeDataTransfer([fakeFileItem(undefined)], [file]);
    expect(folderPathsFromDataTransfer(dataTransfer, portFrom(new Map([[file, '/should-not-appear']])))).toEqual([]);
  });

  it('recovers the OS path for a single dropped folder', () => {
    const file = fakeFile('folder-a');
    const dataTransfer = fakeDataTransfer([fakeFileItem(() => fakeEntry(true))], [file]);
    expect(folderPathsFromDataTransfer(dataTransfer, portFrom(new Map([[file, '/Users/x/Desktop/Folder A']])))).toEqual([
      '/Users/x/Desktop/Folder A',
    ]);
  });

  it("drops a resolved folder whose path could not be recovered (getPathForFile returned '')", () => {
    const dataTransfer = fakeDataTransfer([fakeFileItem(() => fakeEntry(true))], [fakeFile('unresolvable-folder')]);
    expect(folderPathsFromDataTransfer(dataTransfer, constantPort(''))).toEqual([]);
  });

  it('drops a folder item when .files has no entry at its index', () => {
    const dataTransfer = fakeDataTransfer([fakeFileItem(() => fakeEntry(true))], []);
    expect(folderPathsFromDataTransfer(dataTransfer, constantPort('/should-not-appear'))).toEqual([]);
  });

  it("keeps the .files index aligned when a string item sits ahead of the folder's file item", () => {
    // One shared loop index would read files[1] (undefined) here instead of files[0].
    const file = fakeFile('the-only-file');
    const dataTransfer = fakeDataTransfer([fakeStringItem(), fakeFileItem(() => fakeEntry(true))], [file]);
    expect(
      folderPathsFromDataTransfer(dataTransfer, portFrom(new Map([[file, '/Users/x/Desktop/Aligned Folder']]))),
    ).toEqual(['/Users/x/Desktop/Aligned Folder']);
  });

  it('preserves drop order across a mix of string items, loose files, and multiple folders', () => {
    const folderOne = fakeFile('folder-one-file');
    const looseFile = fakeFile('loose-file');
    const folderTwo = fakeFile('folder-two-file');
    const dataTransfer = fakeDataTransfer(
      [
        fakeStringItem(),
        fakeFileItem(() => fakeEntry(true)), // folder one -> files[0]
        fakeFileItem(() => fakeEntry(false)), // loose file -> files[1], excluded
        fakeFileItem(() => fakeEntry(true)), // folder two -> files[2]
      ],
      [folderOne, looseFile, folderTwo],
    );
    const port = portFrom(
      new Map([
        [folderOne, '/Users/x/Desktop/Folder One'],
        [folderTwo, '/Users/x/Desktop/Folder Two'],
      ]),
    );
    expect(folderPathsFromDataTransfer(dataTransfer, port)).toEqual([
      '/Users/x/Desktop/Folder One',
      '/Users/x/Desktop/Folder Two',
    ]);
  });

  it('calls getPathForFile as a method of the port, so a class-based port keeps its `this`', () => {
    class MapPort implements FolderPathDropPort {
      constructor(private readonly paths: ReadonlyMap<File, string>) {}
      getPathForFile(file: File): string {
        return this.paths.get(file) ?? '';
      }
    }
    const file = fakeFile('bound-folder');
    const dataTransfer = fakeDataTransfer([fakeFileItem(() => fakeEntry(true))], [file]);
    expect(folderPathsFromDataTransfer(dataTransfer, new MapPort(new Map([[file, '/Users/x/Bound']])))).toEqual([
      '/Users/x/Bound',
    ]);
  });
});

describe('formatDroppedFolderPaths', () => {
  it('returns a single path unchanged', () => {
    expect(formatDroppedFolderPaths(['/Users/x/Site'])).toBe('/Users/x/Site');
  });

  it('joins several paths with one space, in drop order', () => {
    expect(formatDroppedFolderPaths(['/a/One', '/a/Two', '/a/Three'])).toBe('/a/One /a/Two /a/Three');
  });

  it('joins a path that contains a space as-is, unquoted (the current, ambiguous format)', () => {
    expect(formatDroppedFolderPaths(['/Users/x/My Site', '/a/Two'])).toBe('/Users/x/My Site /a/Two');
  });
});

/** One dragged entry: `path` is what the port answers for its `File`. */
interface DraggedEntry {
  path: string;
  isDirectory: boolean;
}

/** A drop of `entries`, with `preventDefault`/`stopPropagation`/`insertText` recorded into `calls` in order. */
function recordingDrop(entries: readonly DraggedEntry[]) {
  const calls: string[] = [];
  const files = entries.map((entry) => ({ path: entry.path }) as unknown as File);
  const items = entries.map(
    (entry) =>
      ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: entry.isDirectory }) }) as unknown as DataTransferItem,
  );
  const event = {
    dataTransfer: { items, files } as unknown as DataTransfer,
    preventDefault: () => {
      calls.push('preventDefault');
    },
    stopPropagation: () => {
      calls.push('stopPropagation');
    },
  };
  const port: FolderPathDropPort = { getPathForFile: (file) => (file as unknown as { path: string }).path };
  const composer = {
    current: {
      insertText: (text: string) => {
        calls.push(`insertText:${text}`);
      },
    },
  };
  return { calls, event, port, composer };
}

describe('captureFolderPathDrop', () => {
  it('swallows a dropped folder, writes its path into the text target, and returns the path', () => {
    const { calls, event, port, composer } = recordingDrop([{ path: '/Users/x/Site', isDirectory: true }]);
    expect(captureFolderPathDrop({ event, port, composer })).toEqual(['/Users/x/Site']);
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'insertText:/Users/x/Site']);
  });

  it('inserts several dropped folders as ONE space-joined insert, in drop order, loose files skipped', () => {
    const { calls, event, port, composer } = recordingDrop([
      { path: '/a/One', isDirectory: true },
      { path: '/a/loose.txt', isDirectory: false },
      { path: '/a/Two', isDirectory: true },
    ]);
    expect(captureFolderPathDrop({ event, port, composer })).toEqual(['/a/One', '/a/Two']);
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'insertText:/a/One /a/Two']);
  });

  it('leaves a drop with no folder in it untouched, so the ordinary file handling can stage it', () => {
    const { calls, event, port, composer } = recordingDrop([{ path: '/a/loose.txt', isDirectory: false }]);
    expect(captureFolderPathDrop({ event, port, composer })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('leaves even a folder drop untouched when the host has no port (null)', () => {
    const { calls, event, composer } = recordingDrop([{ path: '/Users/x/Site', isDirectory: true }]);
    expect(captureFolderPathDrop({ event, port: null, composer })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('leaves even a folder drop untouched when the host has no port (undefined)', () => {
    const { calls, event, composer } = recordingDrop([{ path: '/Users/x/Site', isDirectory: true }]);
    expect(captureFolderPathDrop({ event, port: undefined, composer })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('treats a folder whose path cannot be recovered as no folder drop at all — the event passes through', () => {
    const { calls, event, composer } = recordingDrop([{ path: '', isDirectory: true }]);
    expect(captureFolderPathDrop({ event, port: constantPort(''), composer })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('still swallows a folder drop before the text target mounts, inserting nothing', () => {
    const { calls, event, port } = recordingDrop([{ path: '/Users/x/Site', isDirectory: true }]);
    expect(captureFolderPathDrop({ event, port, composer: { current: null } })).toEqual(['/Users/x/Site']);
    expect(calls).toEqual(['preventDefault', 'stopPropagation']);
  });
});

describe('@jini-ai/ui/core', () => {
  it('exposes the framework-free folder-path-drop rules by reference', () => {
    expect(core.folderPathsFromDataTransfer).toBe(folderPathsFromDataTransfer);
    expect(core.formatDroppedFolderPaths).toBe(formatDroppedFolderPaths);
    expect(core.captureFolderPathDrop).toBe(captureFolderPathDrop);
  });
});
