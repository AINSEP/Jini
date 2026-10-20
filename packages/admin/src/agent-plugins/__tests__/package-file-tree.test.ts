import { describe, expect, it, vi } from 'vitest';
import { buildPackageFileTree, firstPackageFilePath, ancestorFolderPaths, visiblePackageFileRows, packageFileTreeKeyAction, packageFileIconKind, type PackageFileTreeRow } from '../package-file-tree.js';

const tree = buildPackageFileTree({ paths: ['a.md', 'dir/b.md', 'dir/sub/c.md'] });
function rowsWith(expanded: string[]) { const set = new Set(expanded), isExpanded = ({ path }: { path: string }) => set.has(path); return { rows: visiblePackageFileRows({ nodes: tree, isExpanded }), isExpanded }; }
function press(key: string, currentPath: string, expanded: string[] = []) { return packageFileTreeKeyAction({ ...rowsWith(expanded), currentPath, key }); }

describe('buildPackageFileTree', () => {
  it('skips empty and slash-only paths', () => { expect(buildPackageFileTree({ paths: ['', '/', '//'] })).toEqual([]); });
  it('nests files under shared folders with full folder paths', () => { expect(tree).toEqual([{ kind: 'file', name: 'a.md', path: 'a.md' }, { kind: 'folder', name: 'dir', path: 'dir', children: [{ kind: 'file', name: 'b.md', path: 'dir/b.md' }, { kind: 'folder', name: 'sub', path: 'dir/sub', children: [{ kind: 'file', name: 'c.md', path: 'dir/sub/c.md' }] }] }]); });
  it('keeps the first listed spelling of a path that normalizes to a duplicate', () => { expect(buildPackageFileTree({ paths: ['/x//y.md', 'x/y.md'] })).toEqual([{ kind: 'folder', name: 'x', path: 'x', children: [{ kind: 'file', name: 'y.md', path: '/x//y.md' }] }]); });
  it('orders a file before a folder of the same name', () => { expect(buildPackageFileTree({ paths: ['x/y.md', 'x'] }).map(n => n.kind)).toEqual(['file', 'folder']); });
  it('orders files before folders whichever is listed first', () => { expect(buildPackageFileTree({ paths: ['a.md', 'b/c.md'] }).map(n => n.kind)).toEqual(['file', 'folder']); expect(buildPackageFileTree({ paths: ['b/c.md', 'a.md'] }).map(n => n.kind)).toEqual(['file', 'folder']); });
  it('sorts with the requested locale', () => { expect(buildPackageFileTree({ paths: ['ä.md', 'z.md'] }, { locale: 'sv' }).map(n => n.name)).toEqual(['z.md', 'ä.md']); });
  it('breaks collator ties by code unit order in both directions', () => { expect(buildPackageFileTree({ paths: ['a.md', 'A.md'] }).map(n => n.name)).toEqual(['A.md', 'a.md']); expect(buildPackageFileTree({ paths: ['A.md', 'a.md'] }).map(n => n.name)).toEqual(['A.md', 'a.md']); });
});

describe('packageFileTreeKeyAction', () => {
  it('returns nothing for an empty tree', () => { expect(packageFileTreeKeyAction({ rows: [], currentPath: 'a.md', key: 'ArrowDown', isExpanded: () => false })).toEqual({}); });
  it('returns nothing for keys it does not handle, including prototype names', () => { expect(press('Tab', 'a.md')).toEqual({}); expect(press('constructor', 'a.md')).toEqual({}); expect(press('toString', 'a.md')).toEqual({}); });
  it('treats an unknown current path as the first row', () => { expect(press('ArrowDown', 'missing')).toEqual({ focus: 'dir' }); });
  it('moves down and stops at the last row', () => { expect(press('ArrowDown', 'a.md')).toEqual({ focus: 'dir' }); expect(press('ArrowDown', 'dir')).toEqual({ focus: 'dir' }); });
  it('moves up and stops at the first row', () => { expect(press('ArrowUp', 'dir')).toEqual({ focus: 'a.md' }); expect(press('ArrowUp', 'a.md')).toEqual({ focus: 'a.md' }); });
  it('jumps to the first and last visible rows', () => { expect(press('Home', 'dir/b.md', ['dir'])).toEqual({ focus: 'a.md' }); expect(press('End', 'a.md', ['dir'])).toEqual({ focus: 'dir/sub' }); });
  it('keeps focus on a file for ArrowRight', () => { expect(press('ArrowRight', 'a.md')).toEqual({ focus: 'a.md' }); });
  it('expands a closed folder for ArrowRight', () => { expect(press('ArrowRight', 'dir')).toEqual({ focus: 'dir', setExpanded: { path: 'dir', expanded: true } }); });
  it('steps into an open folder for ArrowRight', () => { expect(press('ArrowRight', 'dir', ['dir'])).toEqual({ focus: 'dir/b.md' }); });
  it('keeps focus on an open folder with no visible child for ArrowRight', () => { const rows: PackageFileTreeRow[] = [{ node: { kind: 'folder', name: 'dir', path: 'dir', children: [] }, depth: 0, parentPath: null, setSize: 1, posInSet: 1 }]; expect(packageFileTreeKeyAction({ rows, currentPath: 'dir', key: 'ArrowRight', isExpanded: () => true })).toEqual({ focus: 'dir' }); });
  it('collapses an open folder for ArrowLeft', () => { expect(press('ArrowLeft', 'dir', ['dir'])).toEqual({ focus: 'dir', setExpanded: { path: 'dir', expanded: false } }); });
  it('steps out to the parent for ArrowLeft', () => { expect(press('ArrowLeft', 'dir/b.md', ['dir'])).toEqual({ focus: 'dir' }); });
  it('keeps focus on a root row for ArrowLeft', () => { expect(press('ArrowLeft', 'a.md')).toEqual({ focus: 'a.md' }); });
  it('opens a file for Enter and Space', () => { expect(press('Enter', 'a.md')).toEqual({ focus: 'a.md', open: 'a.md' }); expect(press(' ', 'a.md')).toEqual({ focus: 'a.md', open: 'a.md' }); });
  it('toggles a folder for Enter and Space', () => { expect(press('Enter', 'dir')).toEqual({ focus: 'dir', setExpanded: { path: 'dir', expanded: true } }); expect(press(' ', 'dir', ['dir'])).toEqual({ focus: 'dir', setExpanded: { path: 'dir', expanded: false } }); });
  it('asks whether the focused folder is open even for an unhandled key', () => { const isExpanded = vi.fn(() => false); packageFileTreeKeyAction({ rows: rowsWith([]).rows, currentPath: 'dir', key: 'Tab', isExpanded }); expect(isExpanded).toHaveBeenCalledWith({ path: 'dir' }); });
});

describe('packageFileIconKind', () => {
  it('uses the plain file icon without an extension', () => { expect(packageFileIconKind({ fileName: 'Makefile' })).toBe('file'); });
  it('uses the plain file icon for an unknown extension', () => { expect(packageFileIconKind({ fileName: 'a.xyz' })).toBe('file'); });
  it('maps extensions case-insensitively', () => { expect(packageFileIconKind({ fileName: 'A.JSON' })).toBe('json'); });
  it('treats a dotfile name as its extension', () => { expect(packageFileIconKind({ fileName: '.env' })).toBe('config'); });
});

describe('firstPackageFilePath', () => {
  it('prefers a root file over nested files', () => { expect(firstPackageFilePath({ nodes: tree })).toBe('a.md'); });
  it('descends into the first folder holding a file', () => { expect(firstPackageFilePath({ nodes: buildPackageFileTree({ paths: ['dir/sub/c.md'] }) })).toBe('dir/sub/c.md'); });
  it('returns null when no file is listed', () => { expect(firstPackageFilePath({ nodes: [{ kind: 'folder', name: 'e', path: 'e', children: [] }] })).toBeNull(); });
});

describe('ancestorFolderPaths', () => {
  it('lists every containing folder from the root down', () => { expect(ancestorFolderPaths({ filePath: 'skills/deploy/SKILL.md' })).toEqual(['skills', 'skills/deploy']); });
  it('returns no folders for a root file', () => { expect(ancestorFolderPaths({ filePath: 'plugin.json' })).toEqual([]); });
});
