import { describe, expect, it } from 'vitest';
import { pathContains } from '../paths.js';

// Characterization pins for the lexical normalizer behind pathContains, one branch per test.
const WIN = { separator: '\\' } as const;
const NOT_ABSOLUTE = 'pathContains requires resolved absolute paths';

describe('pathContains: POSIX normalization', () => {
  it('ignores "." segments, repeated slashes and trailing slashes', () => {
    expect(pathContains({ root: '/a//b/./', target: '/a/b' })).toBe(true);
  });

  it('cannot climb above the root with excess ".." segments', () => {
    expect(pathContains({ root: '/a', target: '/../../a/x' })).toBe(true);
  });

  it('resolves ".." within the target before comparing', () => {
    expect(pathContains({ root: '/a/b', target: '/a/b/c/../../x' })).toBe(false);
  });

  it('treats a leading double slash as the POSIX root, not a UNC share', () => {
    expect(pathContains({ root: '/host', target: '//host/share' })).toBe(true);
  });

  it('contains every absolute target under the root "/"', () => {
    expect(pathContains({ root: '/', target: '/' })).toBe(true);
  });

  it('compares case-sensitively by default', () => {
    expect(pathContains({ root: '/Projects', target: '/projects/x' })).toBe(false);
  });

  it('folds case, including non-ASCII letters, when the host asks', () => {
    expect(pathContains({ root: '/ÄRGER', target: '/ärger/x' }, { caseSensitive: false })).toBe(true);
  });

  it('keeps unicode segments distinct', () => {
    expect(pathContains({ root: '/café', target: '/cafe/x' })).toBe(false);
  });

  it('treats a drive-letter path as relative on POSIX', () => {
    expect(() => pathContains({ root: 'C:/a', target: '/a' })).toThrow(new RangeError(NOT_ABSOLUTE));
  });
});

describe('pathContains: refusals', () => {
  it('rejects an empty root', () => {
    expect(() => pathContains({ root: '', target: '/a' })).toThrow(new RangeError(NOT_ABSOLUTE));
  });

  it('rejects a relative target', () => {
    expect(() => pathContains({ root: '/a', target: 'a/b' })).toThrow(new RangeError(NOT_ABSOLUTE));
  });

  it('rejects a drive-relative Windows path such as "C:foo"', () => {
    expect(() => pathContains({ root: 'C:foo', target: 'C:\\foo' }, WIN)).toThrow(new RangeError(NOT_ABSOLUTE));
  });

  it('rejects a bare Windows drive without a separator', () => {
    expect(() => pathContains({ root: 'C:', target: 'C:\\x' }, WIN)).toThrow(new RangeError(NOT_ABSOLUTE));
  });
});

describe('pathContains: Windows normalization', () => {
  it('accepts lowercase drive letters and forward slashes', () => {
    expect(pathContains({ root: 'c:/a', target: 'c:\\a/b' }, WIN)).toBe(true);
  });

  it('contains everything on the drive under a drive root', () => {
    expect(pathContains({ root: 'C:\\', target: 'C:\\x\\y' }, WIN)).toBe(true);
  });

  it('cannot climb above a drive root', () => {
    expect(pathContains({ root: 'C:\\a', target: 'C:\\..\\..\\a\\x' }, WIN)).toBe(true);
  });

  it('treats a bare share root, with or without a trailing separator, as the same root', () => {
    expect(pathContains({ root: '\\\\host\\share\\', target: '\\\\host\\share' }, WIN)).toBe(true);
  });

  it('cannot climb from one UNC share into a sibling share', () => {
    expect(pathContains({ root: '\\\\host\\share\\a', target: '\\\\host\\share\\..\\other\\a' }, WIN)).toBe(false);
  });

  it('treats a rootless-drive "\\x" path as relative to the current drive root "/"', () => {
    expect(pathContains({ root: '\\a', target: '\\a\\b' }, WIN)).toBe(true);
  });

  it('keeps a drive root distinct from a driveless root', () => {
    expect(pathContains({ root: '\\a', target: 'C:\\a\\b' }, WIN)).toBe(false);
  });

  it('keeps a \\\\?\\ device path distinct from the drive it names (fails closed)', () => {
    expect(pathContains({ root: 'C:\\a', target: '\\\\?\\C:\\a\\b' }, WIN)).toBe(false);
  });

  // Win32 path canonicalization trims trailing dots and spaces from segments, so ".. " can act
  // as ".." on the filesystem while this lexical check keeps it as an ordinary name.
  it('treats a ".. " segment as a plain name on Windows (reported, not fixed)', () => {
    expect(pathContains({ root: 'C:\\a\\b', target: 'C:\\a\\b\\.. \\x' }, WIN)).toBe(true);
  });
});
