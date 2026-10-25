import { describe, expect, it } from 'vitest';
import { evaluateArea, evaluateFloor } from '../floors.js';
import { isIntegrationTestFile, isMeasurableSourceFile, loadRouteCoverage, mergeCoverage, parseLcov, toRepoRelative } from '../lcov.js';
import type { FileCoverage, SourceClassificationRules } from '../lcov.js';

/** L9 §8.10: a coverage gate must not accept NaN/negative/>100 floors, and path grammar
 *  (backslashes, trailing slashes, directory boundaries, anchors) is pinned case by case. */
const file = (name: string, lh = 1, lf = 1): FileCoverage => ({ file: name, lf, lh, brf: 0, brh: 0, fnf: 0, fnh: 0 });
const ok = { line: 0, branch: 0, funcs: 0 };

describe('evaluateFloor floor validation', () => {
  it.each(['line', 'branch', 'funcs'] as const)('%s: 0 and 100 accepted; -0.01, 100.01, NaN, Infinity refused', (axis) => {
    for (const value of [0, 100]) expect(() => evaluateFloor({ files: [file('a')], floors: { ...ok, [axis]: value } })).not.toThrow();
    for (const value of [-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => evaluateFloor({ files: [file('a')], floors: { ...ok, [axis]: value } })).toThrow(new RangeError('coverage floors must be percentages from 0 to 100'));
    }
  });
  it('compares with < : exactly at the floor passes, just under fails with a formatted message', () => {
    expect(evaluateFloor({ files: [file('a', 1, 2)], floors: { ...ok, line: 50 } }).failures).toEqual([]);
    expect(evaluateFloor({ files: [file('a', 1, 2)], floors: { ...ok, line: 50.01 } }).failures).toEqual(['line 50.00% < floor 50.01%']);
  });
});

describe('evaluateArea prefix boundaries', () => {
  const all = [file('pkg/src/a.ts'), file('pkg/srcx/b.ts', 0), file('pkg/src/sub/c.ts')];
  it.each(['pkg/src', 'pkg/src/', 'pkg/src//'])('prefix %j matches only whole directories', (prefix) => {
    const result = evaluateArea({ area: { prefix, ...ok, line: 100 }, all, isMeasurable: () => true });
    expect(result.count).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.area.prefix).toBe(prefix);
  });
  it('passes the area floors (not defaults) and applies the classifier', () => {
    const result = evaluateArea({ area: { prefix: 'pkg/src', line: 100, branch: 0, funcs: 0 }, all: [...all, file('pkg/src/d.ts', 0)], isMeasurable: ({ file: name }) => !name.endsWith('d.ts') });
    expect(result.count).toBe(2);
    const failing = evaluateArea({ area: { prefix: 'pkg/src', line: 100, branch: 0, funcs: 0 }, all: [...all, file('pkg/src/d.ts', 0)], isMeasurable: () => true });
    expect(failing.failures).toEqual(['line 66.67% < floor 100%']);
  });
});

describe('toRepoRelative', () => {
  it.each([
    ['/repo/a.ts', '/repo', 'a.ts'],
    ['  /repo/a.ts \n', '/repo', 'a.ts'],
    ['C:\\repo\\pkg\\a.ts', 'C:\\repo', 'pkg/a.ts'],
    ['/repo/a.ts', '/repo//', 'a.ts'],
    ['/repo', '/repo/', ''],
    ['/repository/a.ts', '/repo', '/repository/a.ts'],
    ['/other/a.ts', '/repo', '/other/a.ts'],
  ])('%j under %j → %j', (sourceFile, repoRoot, expected) => {
    expect(toRepoRelative({ sourceFile, repoRoot })).toBe(expected);
  });
});

describe('isIntegrationTestFile', () => {
  const args = { suffixes: ['.int.test.ts', '.e2e.ts'], directories: ['/integration/', 'e2e'] };
  it.each([
    ['a.int.test.ts', true], ['x/b.e2e.ts', true], ['src\\integration\\c.ts', true], ['integration/c.ts', true], ['pkg/e2e/d.ts', true],
    ['a.test.ts', false], ['src/integrationx/c.ts', false], ['src/myintegration/c.ts', false], ['src/e2ex/d.ts', false], ['a.int.test.ts.bak', false],
  ])('%j → %s', (name, expected) => {
    expect(isIntegrationTestFile({ file: name, ...args })).toBe(expected);
  });
});

describe('isMeasurableSourceFile', () => {
  const rules: SourceClassificationRules = { prefixes: ['packages/a/src/', 'packages/b/src'], sourceExtensions: ['.ts', '.tsx'], excludedDirectories: ['__tests__', 'fixtures'], excludedBasenames: ['index.ts'], testPattern: /\.test\.tsx?$/g };
  it.each([
    ['packages/a/src/x.ts', true], ['packages\\b\\src\\y.tsx', true], ['packages/b/src/deep/z.ts', true],
    ['packages/a/srcx/x.ts', false], ['other/packages/a/src/x.ts', false], ['packages/a/src/x.js', false], ['packages/a/src/x.ts.map', false],
    ['packages/a/src/__tests__/x.ts', false], ['packages/a/src/fixtures/x.ts', false], ['packages/a/src/fixturesx/x.ts', true],
    ['packages/a/src/index.ts', false], ['packages/a/src/sub/index.ts', false], ['packages/a/src/myindex.ts', true],
    ['packages/a/src/x.test.ts', false], ['packages/a/src/x.test.tsx', false],
  ])('%j → %s', (name, expected) => {
    expect(isMeasurableSourceFile({ file: name, rules })).toBe(expected);
  });
  it('a sticky/global testPattern is not mutated and gives the same answer twice', () => {
    const pattern = /\.test\.ts$/gy;
    const sticky = { ...rules, testPattern: pattern };
    expect(isMeasurableSourceFile({ file: 'packages/a/src/x.test.ts', rules: sticky })).toBe(false);
    expect(isMeasurableSourceFile({ file: 'packages/a/src/x.test.ts', rules: sticky })).toBe(false);
    expect(pattern.lastIndex).toBe(0);
  });
});

describe('parseLcov anchors', () => {
  it('splits only on whole end_of_record lines and reads only line-anchored SF/LF fields', () => {
    const text = [
      'TN:', 'SF:/repo/a.ts', 'LF:10', 'LH:5', 'XLF:99', 'end_of_record',
      'SF:/repo/b.ts', 'FNF:2', 'FNH:1', 'BRF:4', 'BRH:3', 'LF:1', 'LH:1', 'not_end_of_record_marker', 'end_of_record',
      'XSF:/repo/c.ts', 'end_of_record',
    ].join('\r\n');
    expect(parseLcov({ text, repoRoot: '/repo' })).toEqual([
      { file: 'a.ts', lf: 10, lh: 5, brf: 0, brh: 0, fnf: 0, fnh: 0 },
      { file: 'b.ts', lf: 1, lh: 1, brf: 4, brh: 3, fnf: 2, fnh: 1 },
    ]);
  });
  it('LF with trailing junk is not a number field', () => {
    expect(parseLcov({ text: 'SF:/repo/a.ts\nLF:10x\nend_of_record', repoRoot: '/repo' })[0]!.lf).toBe(0);
  });
  it('end_of_record with trailing text does not split', () => {
    expect(parseLcov({ text: 'SF:/repo/a.ts\nend_of_record_x\nSF:/repo/b.ts\nend_of_record', repoRoot: '/repo' }).map(r => r.file)).toEqual(['a.ts']);
  });
});

describe('loadRouteCoverage + mergeCoverage', () => {
  it('filters by the classifier', () => {
    const reader = { readText: () => 'SF:/r/keep.ts\nLF:1\nLH:1\nend_of_record\nSF:/r/drop.ts\nend_of_record' };
    expect(loadRouteCoverage({ lcovPath: 'l', repoRoot: '/r', reader: reader as never, isMeasurable: ({ file: name }) => name === 'keep.ts' }).map(r => r.file)).toEqual(['keep.ts']);
  });
  it('higher line-hit image wins; a tie keeps the first; unmeasurable files are dropped', () => {
    const merged = mergeCoverage({ reports: [[file('a', 2, 5), file('b', 3, 5), file('skip', 5, 5)], [file('a', 4, 5), file('b', 3, 9)]], isMeasurable: ({ file: name }) => name !== 'skip' });
    expect(merged.get('a')!.lh).toBe(4);
    expect(merged.get('b')!.lf).toBe(5);
    expect(merged.has('skip')).toBe(false);
  });
});
