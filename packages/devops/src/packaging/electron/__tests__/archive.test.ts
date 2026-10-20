import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { bundledNpmFailures, filesUnderPrefixes, formatMismatchReport, isEmptyVerification, toArchiveEntryPath, verifyAsarAgainstSource } from '../archive.js';
import type { ArchiveReaderPort, AsarHeaderNode } from '../ports.js';
import { memoryFs } from './memory-fs.js';

const NUL = String.fromCharCode(0);
const BACKSLASH = String.fromCharCode(92);

function archiveOf(files: Record<string, AsarHeaderNode> | undefined, contents: Record<string, string | Error>): ArchiveReaderPort & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    header: () => (files ? { files } : {}),
    read: ({ entryPath }) => {
      reads.push(entryPath);
      const body = contents[entryPath];
      if (body instanceof Error) throw body;
      if (body === undefined) throw new Error(`no entry ${entryPath}`);
      return Buffer.from(body);
    },
  };
}

describe('archive entry safety (path containment)', () => {
  const unsafe: [string, string][] = [
    ['empty', ''], ['backslash', `src${BACKSLASH}a.js`], ['NUL byte', `src/a${NUL}.js`], ['leading slash', '/src'],
    ['trailing slash', 'src/'], ['empty middle segment', 'src//a.js'], ['dot segment', 'src/./a.js'], ['dot-dot segment', 'src/../a.js'],
    ['bare dot', '.'], ['bare dot-dot', '..'],
  ];
  for (const [label, value] of unsafe) {
    test(`a prefix with a ${label} is refused by name`, () => {
      assert.throws(() => filesUnderPrefixes({ headerFiles: {}, prefixes: [value] }), { message: `Unsafe archive entry: ${value}` });
    });
    test(`an entry path with a ${label} is refused before conversion`, () => {
      assert.throws(() => toArchiveEntryPath({ relPath: value, separator: '/' }), { message: `Unsafe archive entry: ${value}` });
    });
  }
  test('a header child named ".." is refused while walking', () => {
    assert.throws(() => filesUnderPrefixes({ headerFiles: { src: { files: { '..': { size: 1 } } } }, prefixes: ['src'] }), { message: 'Unsafe archive entry: src/..' });
  });
  test('a header child name carrying a slash-joined traversal is refused while walking', () => {
    assert.throws(() => filesUnderPrefixes({ headerFiles: { src: { files: { 'a/../../etc': { size: 1 } } } }, prefixes: ['src'] }), { message: 'Unsafe archive entry: src/a/../../etc' });
  });
  test('a header child name with a backslash is refused while walking', () => {
    assert.throws(() => filesUnderPrefixes({ headerFiles: { src: { files: { [`a${BACKSLASH}b`]: { size: 1 } } } }, prefixes: ['src'] }), { message: `Unsafe archive entry: src/a${BACKSLASH}b` });
  });
});

describe('filesUnderPrefixes', () => {
  test('an undefined header lists nothing', () => {
    assert.deepEqual(filesUnderPrefixes({ headerFiles: undefined, prefixes: ['src'] }), []);
  });
  test('a nested prefix walks only that subtree', () => {
    const headerFiles = { src: { files: { sub: { files: { 'b.js': { size: 1 } } }, 'a.js': { size: 1 } } } };
    assert.deepEqual(filesUnderPrefixes({ headerFiles, prefixes: ['src/sub'] }), ['src/sub/b.js']);
  });
  test('a prefix that continues through a file finds nothing', () => {
    assert.deepEqual(filesUnderPrefixes({ headerFiles: { 'main.js': { size: 1 } }, prefixes: ['main.js/x'] }), []);
  });
  test('a symlink named directly as a prefix is excluded', () => {
    assert.deepEqual(filesUnderPrefixes({ headerFiles: { link: { link: 'main.js' } }, prefixes: ['link'] }), []);
  });
  test('an empty directory contributes nothing', () => {
    assert.deepEqual(filesUnderPrefixes({ headerFiles: { src: { files: {} } }, prefixes: ['src'] }), []);
  });
  test('overlapping prefixes list each file once', () => {
    assert.deepEqual(filesUnderPrefixes({ headerFiles: { src: { files: { 'a.js': { size: 1 } } } }, prefixes: ['src', 'src/a.js'] }), ['src/a.js']);
  });
});

test('toArchiveEntryPath joins POSIX segments with the supplied separator', () => {
  assert.equal(toArchiveEntryPath({ relPath: 'src/sub/b.js', separator: BACKSLASH }), ['src', 'sub', 'b.js'].join(BACKSLASH));
});

describe('verifyAsarAgainstSource', () => {
  const base = { archivePath: '/out/app.asar', sourceRoot: '/repo', separator: '/' };
  test('no prefixes is a mismatch, never a clean pass, and the archive is not opened', () => {
    let opened = false;
    const archive: ArchiveReaderPort = { header: () => { opened = true; return {}; }, read: () => new Uint8Array() };
    assert.deepEqual(verifyAsarAgainstSource({ ...base, prefixes: [], fs: memoryFs({ files: {} }), archive }), { checkedCount: 0, mismatches: [{ relPath: '', reason: 'no checked archive prefixes supplied' }] });
    assert.equal(opened, false);
  });
  test('a header without files reports every prefix as empty', () => {
    const result = verifyAsarAgainstSource({ ...base, prefixes: ['src', 'bin'], fs: memoryFs({ files: {} }), archive: archiveOf(undefined, {}) });
    assert.deepEqual(result, { checkedCount: 0, mismatches: [{ relPath: 'src', reason: 'nothing under this checked prefix is in app.asar' }, { relPath: 'bin', reason: 'nothing under this checked prefix is in app.asar' }] });
  });
  test('source is read from sourceRoot joined with the POSIX path and the archive with the separator path', () => {
    const fs = memoryFs({ files: { '/repo/src/sub/b.js': 'same' } });
    const archive = archiveOf({ src: { files: { sub: { files: { 'b.js': { size: 4 } } } } } }, { [['src', 'sub', 'b.js'].join(BACKSLASH)]: 'same' });
    assert.deepEqual(verifyAsarAgainstSource({ ...base, separator: BACKSLASH, prefixes: ['src'], fs, archive }), { checkedCount: 1, mismatches: [] });
    assert.deepEqual(fs.calls, [{ op: 'read', path: '/repo/src/sub/b.js' }]);
    assert.deepEqual(archive.reads, [['src', 'sub', 'b.js'].join(BACKSLASH)]);
  });
  test('a shipped file missing from source is reported without reading the archive entry', () => {
    const archive = archiveOf({ 'main.js': { size: 1 } }, { 'main.js': 'x' });
    assert.deepEqual(verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: {} }), archive }).mismatches, [{ relPath: 'main.js', reason: 'shipped in app.asar but missing from the source tree' }]);
    assert.deepEqual(archive.reads, []);
  });
  test('an unreadable archive entry reports the default message with the error', () => {
    const archive = archiveOf({ 'main.js': { size: 1 } }, { 'main.js': new Error('offset invalid') });
    assert.deepEqual(verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: { '/repo/main.js': 'x' } }), archive }).mismatches, [{ relPath: 'main.js', reason: 'present in the asar header but could not read it (Error: offset invalid)' }]);
  });
  test('an unreadable archive entry uses the caller message, which receives the error', () => {
    const failure = new Error('offset invalid');
    const seen: unknown[] = [];
    const archive = archiveOf({ 'main.js': { size: 1 } }, { 'main.js': failure });
    const result = verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: { '/repo/main.js': 'x' } }), archive }, { readFailureMessage: ({ error }) => { seen.push(error); return 'custom read failure'; } });
    assert.deepEqual(result.mismatches, [{ relPath: 'main.js', reason: 'custom read failure' }]);
    assert.deepEqual(seen, [failure]);
  });
  test('a length difference is a content mismatch', () => {
    const archive = archiveOf({ 'main.js': { size: 1 } }, { 'main.js': 'xx' });
    assert.deepEqual(verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: { '/repo/main.js': 'x' } }), archive }).mismatches, [{ relPath: 'main.js', reason: 'content differs from source (compared byte-for-byte, never by length alone)' }]);
  });
  test('a same-length byte difference in the last byte is a content mismatch', () => {
    const archive = archiveOf({ 'main.js': { size: 3 } }, { 'main.js': 'abd' });
    assert.equal(verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: { '/repo/main.js': 'abc' } }), archive }).mismatches.length, 1);
  });
  test('a content mismatch uses the caller message when supplied', () => {
    const archive = archiveOf({ 'main.js': { size: 1 } }, { 'main.js': 'y' });
    assert.deepEqual(verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: { '/repo/main.js': 'x' } }), archive }, { contentMismatchMessage: 'custom differs' }).mismatches, [{ relPath: 'main.js', reason: 'custom differs' }]);
  });
  test('two empty files match', () => {
    const archive = archiveOf({ 'main.js': { size: 0 } }, { 'main.js': '' });
    assert.deepEqual(verifyAsarAgainstSource({ ...base, prefixes: ['main.js'], fs: memoryFs({ files: { '/repo/main.js': '' } }), archive }), { checkedCount: 1, mismatches: [] });
  });
  test('prefix mismatches come before per-file mismatches and the count covers all listed files', () => {
    const archive = archiveOf({ src: { files: { 'a.js': { size: 1 }, 'b.js': { size: 1 } } } }, { 'src/a.js': 'a', 'src/b.js': 'z' });
    const result = verifyAsarAgainstSource({ ...base, prefixes: ['bin', 'src'], fs: memoryFs({ files: { '/repo/src/a.js': 'a', '/repo/src/b.js': 'b' } }), archive });
    assert.equal(result.checkedCount, 2);
    assert.deepEqual(result.mismatches.map(item => item.relPath), ['bin', 'src/b.js']);
  });
  test('an unsafe prefix is refused rather than reported', () => {
    assert.throws(() => verifyAsarAgainstSource({ ...base, prefixes: ['../x'], fs: memoryFs({ files: {} }), archive: archiveOf({}, {}) }), { message: 'Unsafe archive entry: ../x' });
  });
});

test('isEmptyVerification is true only for zero checked files', () => {
  assert.equal(isEmptyVerification({ checkedCount: 0 }), true);
  assert.equal(isEmptyVerification({ checkedCount: 1 }), false);
});

test('formatMismatchReport lists every mismatch between a count header and the offset warning', () => {
  assert.equal(formatMismatchReport({ mismatches: [{ relPath: 'src/a.js', reason: 'differs' }, { relPath: 'bin', reason: 'empty' }] }), [
    '2 file(s) in app.asar do NOT match source, byte-for-byte:',
    '  MISMATCH  src/a.js — differs',
    '  MISMATCH  bin — empty',
    'Equal sizes can hide a packaging race that shifts archive offsets.',
  ].join('\n'));
});

describe('bundledNpmFailures', () => {
  test('no resources directory is a failure', () => {
    assert.deepEqual(bundledNpmFailures({ resourcesDirs: [], requiredFiles: ['npm/a.js'], fs: memoryFs({ files: {} }) }), ['no packaged resources directory was found to check for the bundled npm']);
  });
  test('no required files is a failure', () => {
    assert.deepEqual(bundledNpmFailures({ resourcesDirs: ['/res'], requiredFiles: [], fs: memoryFs({ files: {} }) }), ['no bundled npm files were specified to check']);
  });
  test('missing files are listed per resources directory', () => {
    const fs = memoryFs({ files: { '/a/npm/x.js': '', '/b/npm/y.js': '' } });
    assert.deepEqual(bundledNpmFailures({ resourcesDirs: ['/a', '/b'], requiredFiles: ['npm/x.js', 'npm/y.js'], fs }), ['/a/npm/y.js', '/b/npm/x.js']);
  });
  test('a traversing required file is refused', () => {
    assert.throws(() => bundledNpmFailures({ resourcesDirs: ['/a'], requiredFiles: ['../etc/passwd'], fs: memoryFs({ files: {} }) }), { message: 'Unsafe archive entry: ../etc/passwd' });
  });
});
