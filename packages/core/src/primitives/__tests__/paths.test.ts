import { expect, it } from 'vitest';
import { pathContains } from '../paths.js';

// REGRESSION: fails if pathContains is removed from core/primitives.
it('checks resolved absolute paths using complete directory segments', () => {
  expect(pathContains({ root: '/projects', target: '/projects' })).toBe(true);
  expect(pathContains({ root: '/projects/', target: '/projects/site' })).toBe(true);
  expect(pathContains({ root: '/projects', target: '/projects/../outside' })).toBe(false);
  expect(pathContains({ root: '/projects', target: '/projects-sibling/site' })).toBe(false);
  expect(pathContains({ root: '/projects', target: '/projects/..legal-name' })).toBe(true);
  expect(pathContains({ root: '/', target: '/site' })).toBe(true);
});

// REGRESSION: fails if paths are compared without Windows root/separator normalization.
it('keeps drives and UNC shares separate and permits host-selected case folding', () => {
  expect(pathContains({ root: 'C:\\projects', target: 'C:\\projects\\site' }, { separator: '\\' })).toBe(true);
  expect(pathContains({ root: 'C:\\projects', target: 'D:\\projects\\site' }, { separator: '\\' })).toBe(false);
  expect(pathContains({ root: 'C:\\Projects', target: 'c:\\projects\\site' }, { caseSensitive: false, separator: '\\' })).toBe(true);
  expect(pathContains({ root: '\\\\host\\share', target: '\\\\host\\other\\site' }, { separator: '\\' })).toBe(false);
});

// REGRESSION: fails if pathContains silently resolves relative input using a process working directory.
it('requires the host to resolve relative paths and symlinks', () => {
  expect(() => pathContains({ root: 'projects', target: '/projects/site' })).toThrow(RangeError);
});

// REGRESSION: fails if POSIX paths unconditionally replace backslashes with separators.
it('keeps POSIX literal backslashes distinct from directory separators', () => {
  expect(pathContains({ root: '/projects/sub\\folder', target: '/projects/sub/folder/child' })).toBe(false);
  expect(pathContains({ root: '/projects/sub\\folder', target: '/projects/sub\\folder/child' })).toBe(true);
});
