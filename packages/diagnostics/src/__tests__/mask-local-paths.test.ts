import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { maskLocalPaths } from '../index.js';

it.each([
  '/Users/fixture/Sites/private.txt', '~/Sites/private.txt',
  String.raw`C:\Users\fixture\private.txt`, 'C:/Users/fixture/private.txt',
  String.raw`\\fixture-server\share\private.txt`,
  'file:///Users/fixture/private.txt', 'file:///C:/Users/fixture/private.txt',
  'file://fixture-server/share/private.txt',
  '//fixture-server/share/private.txt',
])('masks the complete local path %s on any host OS', text => {
  expect(maskLocalPaths({ text })).toBe('<path>');
  expect(maskLocalPaths({ text: `open ${text} failed` })).toBe('open <path> failed');
});

it.each([
  ['/opt/app/main.ts', '/opt/app', 'app:///main.ts'],
  ['/opt/app/main.ts:12:3', '/opt/app/', 'app:///main.ts:12:3'],
  ['file:///opt/app/main.ts', '/opt/app', 'app:///main.ts'],
  ['~/app/main.ts', '~/app', 'app:///main.ts'],
  ['file:///opt/App%20Files/main.ts', '/opt/App Files', 'app:///main.ts'],
  [String.raw`C:\Program Files\App\main.ts`, String.raw`C:\Program Files\App`, 'app:///main.ts'],
  [String.raw`C:\Program Files (x86)\App\main.ts`, String.raw`C:\Program Files (x86)\App`, 'app:///main.ts'],
  ['c:/APP/main.ts', 'C:/app', 'app:///main.ts'],
  ['file:///C:/App/main.ts', String.raw`C:\App`, 'app:///main.ts'],
  [String.raw`\\server\share\app\main.ts`, String.raw`\\server\share\app`, 'app:///main.ts'],
])('keeps only the shipped relative path for %s', (text, root, expected) => {
  expect(maskLocalPaths({ text: `"${text}"` }, { keepRoots: [root] })).toBe(`"${expected}"`);
});

it.each(['/opt/app-other/private.txt', '/opt/app/../private.txt', '/opt/app/../../private.txt'])('does not keep a sibling or traversal escape %s', text => {
  expect(maskLocalPaths({ text }, { keepRoots: ['/opt/app'] })).toBe('<path>');
});

it('masks quoted paths and stack frames with spaces, retaining frame coordinates', () => {
  const text = 'open "/Users/fixture/Private Files/a.txt"\n at run (C:\\Program Files\\App\\main.ts:4:2)';
  expect(maskLocalPaths({ text })).toBe('open "<path>"\n at run (<path>:4:2)');
});

it('handles multiple roots and paths, without changing unrelated URLs or relative paths', () => {
  const text = 'at /opt/app/main.ts:2:4 then /private/data and D:/App/start.ts';
  expect(maskLocalPaths({ text }, { keepRoots: ['/opt/app', 'D:/App'] }))
    .toBe('at app:///main.ts:2:4 then <path> and app:///start.ts');
  const unchanged = 'plain text; relative/main.ts; https://example.invalid/api/items?count=2';
  expect(maskLocalPaths({ text: unchanged })).toBe(unchanged);
});

it('fails closed on malformed file URLs and Windows traversal escapes', () => {
  expect(maskLocalPaths({ text: 'file:///private/%ZZ.txt' })).toBe('<path>');
  expect(maskLocalPaths({ text: 'C:/App/../private.txt' }, { keepRoots: ['C:/App'] })).toBe('<path>');
  expect(maskLocalPaths({ text: 'open "/private/incomplete.txt' })).toBe('open "<path>');
});

it('handles adversarial 100 KB text within a bounded time', () => {
  const text = '/' + 'a'.repeat(100 * 1024 - 1);
  const started = performance.now();
  expect(maskLocalPaths({ text })).toBe('<path>');
  expect(maskLocalPaths({ text: 'x'.repeat(100 * 1024) })).toBe('x'.repeat(100 * 1024));
  expect(maskLocalPaths({ text: '(/'.repeat(50 * 1024) })).toBe('(<path>'.repeat(50 * 1024));
  expect(performance.now() - started).toBeLessThan(1_000);
});
