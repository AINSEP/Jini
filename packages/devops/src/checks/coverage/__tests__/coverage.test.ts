import { expect, test } from 'vitest';
import {
  parseLcov, loadLcov, pct, isIntegrationTestFile, isMeasurableSourceFile, toRepoRelative,
  evaluateFileTiers, evaluateFloor, evaluateArea, checkCoverageDiff, resolveBaseRef, mergeCoverage,
} from '../index.js';
import type { FileCoverage, SourceClassificationRules } from '../index.js';

// Generalized route classifiers and two-tier regression cases from the original suites.
const rules: SourceClassificationRules = {
  prefixes: ['services/api/routes/', 'services/api/public/'], sourceExtensions: ['.ts'],
  excludedDirectories: ['__tests__', '__measurements__'], excludedBasenames: ['types.ts', 'deps.ts', 'execution-deps.ts'],
  testPattern: /\.(test|spec)\.tsx?$/,
};
const measurable = ({ file }: { file: string }) => isMeasurableSourceFile({ file, rules });
const rec = (overrides: Partial<FileCoverage> = {}): FileCoverage => ({ file: 'services/api/routes/example.ts', lf: 10, lh: 9, brf: 100, brh: 99, fnf: 2, fnh: 2, ...overrides });
const thresholds = { unit: 99, integration: 95 };

test.each<[string, boolean]>([
  ['src/server/__tests__/integration/boot.integration.test.ts', true],
  ['src/server/__tests__/integration/plain.test.ts', true],
  ['src/server/__tests__/products.test.ts', false],
  ['src/server/integrations/__tests__/create.test.ts', false],
  ['src\\server\\__tests__\\integration\\boot.test.ts', true],
])('classifies integration tests with caller-supplied naming conventions: %s', (file, expected) => {
  expect(isIntegrationTestFile({ file, suffixes: ['.integration.test.ts'], directories: ['__tests__/integration'] })).toBe(expected);
});

test.each<[string, boolean]>([
  ['services/api/public/pages.ts', true], ['services/api/routes/list.ts', true],
  ['services/api/public/__tests__/pages.test.ts', false], ['services/api/routes/types.ts', false],
  ['services/api/routes-legacy/list.ts', false], ['services\\api\\public\\pages.ts', true],
])('classifies measurable sources using required roots and exclusions: %s', (file, expected) => {
  expect(measurable({ file })).toBe(expected);
});

test('normalizes absolute paths without stripping a sibling repository prefix', () => {
  expect(toRepoRelative({ sourceFile: '/repo/src/main.ts', repoRoot: '/repo' })).toBe('src/main.ts');
  expect(toRepoRelative({ sourceFile: '/repo-other/src/main.ts', repoRoot: '/repo' })).toBe('/repo-other/src/main.ts');
  expect(toRepoRelative({ sourceFile: 'C:\\repo\\src\\main.ts', repoRoot: 'C:\\repo' })).toBe('src/main.ts');
});

test('parses CRLF LCOV, ignores header-only blocks, and defaults absent counters to zero', () => {
  expect(parseLcov({ text: 'TN:fixture\r\nend_of_record\r\nSF:/repo/src/main.ts\r\nLF:10\r\nLH:9\r\nend_of_record\r\n', repoRoot: '/repo' })).toEqual([
    { file: 'src/main.ts', lf: 10, lh: 9, brf: 0, brh: 0, fnf: 0, fnh: 0 },
  ]);
  expect(loadLcov({ lcovPath: '/repo/report.lcov', repoRoot: '/repo', reader: { readText: () => 'SF:src/main.ts\nend_of_record\n' } })).toHaveLength(1);
  expect(pct({ hit: 0, found: 0 })).toBe(100);
});

test('coverage image merge keeps the best full image rather than adding hit counts', () => {
  const first = rec({ lh: 4, brh: 30 });
  const second = rec({ lh: 9, brh: 50 });
  const reports = [[first, rec({ file: 'external/ignored.ts' })], [second]];
  expect([...mergeCoverage({ reports, isMeasurable: measurable }).values()]).toEqual([second]);
  expect(first.lh).toBe(4);
});

test.each<[FileCoverage | undefined, FileCoverage | undefined, boolean, number, number]>([
  [undefined, undefined, false, 0, 0],
  [rec({ brf: 0, brh: 0 }), undefined, true, 100, 100],
  [undefined, rec({ brf: 0, brh: 0 }), true, 100, 100],
  [rec(), rec({ brh: 95 }), true, 99, 95],
  [rec({ brh: 98 }), rec({ brh: 100 }), false, 98, 100],
  [rec({ brh: 100 }), rec({ brh: 94 }), false, 100, 94],
  [rec({ brh: 100 }), undefined, false, 100, 0],
  [undefined, rec({ brh: 100 }), false, 0, 100],
])('evaluates both tiers independently', (unitRec, integrationRec, ok, unitPct, integrationPct) => {
  const result = evaluateFileTiers({ file: rec().file, unitRec, integrationRec, thresholds });
  expect(result.ok).toBe(ok);
  expect(result.unit.pctValue).toBe(unitPct);
  expect(result.integration.pctValue).toBe(integrationPct);
});

test('conflicting branch totals cannot produce a vacuous pass', () => {
  const result = evaluateFileTiers({ file: rec().file, unitRec: rec({ brf: 0 }), integrationRec: rec(), thresholds });
  expect(result.ok).toBe(false);
  expect(result.unit.detail).toMatch(/inconsistent/);
});

test('aggregate floor uses sums, rejects an empty scope, and reports each missed axis', () => {
  const floors = { line: 90, branch: 95, funcs: 100 };
  expect(evaluateFloor({ files: [], floors }).failures).toEqual(['0 measurable files']);
  const result = evaluateFloor({ files: [rec({ lf: 90, lh: 90 }), rec({ lf: 10, lh: 0, brh: 80, fnh: 0 })], floors });
  expect(result.line).toBe(90);
  expect(result.failures).toEqual(['branch 89.50% < floor 95%', 'funcs 50.00% < floor 100%']);
  expect(evaluateArea({ area: { prefix: 'services/api/routes/', ...floors }, all: [rec(), rec({ file: 'external/irrelevant.ts' })], isMeasurable: measurable }).count).toBe(1);
});

test('base-ref precedence uses supplied values and handles a new-branch zero SHA', () => {
  const required = { fallbackRef: 'upstream/trunk', remote: 'upstream' };
  expect(resolveBaseRef(required, { override: 'override', positional: 'pos', pullRequestBase: 'pr', eventBefore: 'before' })).toBe('override');
  expect(resolveBaseRef(required, { positional: 'pos', pullRequestBase: 'pr' })).toBe('pos');
  expect(resolveBaseRef(required, { pullRequestBase: 'pr', eventBefore: 'before' })).toBe('upstream/pr');
  expect(resolveBaseRef(required, { eventBefore: 'before' })).toBe('before');
  expect(resolveBaseRef(required, { eventBefore: '0'.repeat(40) })).toBe('upstream/trunk');
});

test('diff orchestration filters changed files and reads both supplied coverage artifacts', async () => {
  const reads: string[] = [];
  const result = await checkCoverageDiff({
    baseRef: 'fixture-base', repoRoot: '/repo', sourceRoots: rules.prefixes, thresholds,
    unitCoveragePath: '/repo/unit.lcov', integrationCoveragePath: '/repo/integration.lcov',
    isMeasurable: measurable,
    diff: { changedFiles: async (args) => {
      expect(args).toEqual({ baseRef: 'fixture-base', repoRoot: '/repo', sourceRoots: rules.prefixes });
      return [rec().file, 'README.md', 'services/api/routes/__tests__/ignored.test.ts'];
    } },
    reader: { readText: ({ path }) => { reads.push(path); return `SF:${rec().file}\nBRF:100\nBRH:${path.includes('unit') ? 98 : 95}\nend_of_record\n`; } },
  });
  expect(reads).toEqual(['/repo/unit.lcov', '/repo/integration.lcov']);
  expect(result.ok).toBe(false);
  expect(result.files).toHaveLength(1);
  expect(result.files[0]?.unit.pctValue).toBe(98);
});

// --- L060b characterization pins: evaluateFileTiers / resolveBaseRef / checkCoverageDiff ---------

test.each<[string, number]>([
  ['unit', Number.NaN], ['unit', -0.01], ['unit', 100.01], ['unit', Number.POSITIVE_INFINITY],
  ['integration', Number.NaN], ['integration', -1], ['integration', 101],
])('a %s threshold of %s is refused before any record is read', (key, value) => {
  const bad = { ...thresholds, [key]: value };
  expect(() => evaluateFileTiers({ file: rec().file, unitRec: undefined, integrationRec: undefined, thresholds: bad }))
    .toThrow(new RangeError('tier thresholds must be percentages from 0 to 100'));
});

test('thresholds of exactly 0 and 100 are accepted boundaries', () => {
  const result = evaluateFileTiers({ file: rec().file, unitRec: rec({ brh: 100 }), integrationRec: rec({ brh: 0 }), thresholds: { unit: 100, integration: 0 } });
  expect(result).toEqual({
    file: rec().file, ok: true,
    unit: { ok: true, pctValue: 100, detail: '100.00% branch' },
    integration: { ok: true, pctValue: 0, detail: '0.00% branch' },
  });
});

test('no record on either tier fails both tiers with one shared detail', () => {
  const result = evaluateFileTiers({ file: 'f.ts', unitRec: undefined, integrationRec: undefined, thresholds });
  expect(result).toEqual({
    file: 'f.ts', ok: false,
    unit: { ok: false, pctValue: 0, detail: 'no coverage record on either tier' },
    integration: { ok: false, pctValue: 0, detail: 'no coverage record on either tier' },
  });
});

test('inconsistent branch totals fail both tiers with the inconsistency detail', () => {
  const result = evaluateFileTiers({ file: 'f.ts', unitRec: rec({ brf: 10, brh: 10 }), integrationRec: rec({ brf: 12, brh: 12 }), thresholds });
  expect(result.integration).toEqual({ ok: false, pctValue: 0, detail: 'inconsistent branch totals between tiers' });
  expect(result.unit).toEqual({ ok: false, pctValue: 0, detail: 'inconsistent branch totals between tiers' });
});

test('a branchless file passes both tiers vacuously with distinct result objects', () => {
  const result = evaluateFileTiers({ file: 'f.ts', unitRec: rec({ brf: 0, brh: 0 }), integrationRec: rec({ brf: 0, brh: 0 }), thresholds });
  const detail = '0 branches in this file (vacuously passes both tiers)';
  expect(result).toEqual({ file: 'f.ts', ok: true, unit: { ok: true, pctValue: 100, detail }, integration: { ok: true, pctValue: 100, detail } });
  expect(result.unit).not.toBe(result.integration);
});

test('a missing tier record next to a branch-bearing one names the missing tier', () => {
  expect(evaluateFileTiers({ file: 'f.ts', unitRec: rec(), integrationRec: undefined, thresholds }).integration.detail).toBe('no integration coverage record');
  expect(evaluateFileTiers({ file: 'f.ts', unitRec: undefined, integrationRec: rec(), thresholds }).unit.detail).toBe('no unit coverage record');
});

test('a pull-request base that already names a remote is used as-is', () => {
  expect(resolveBaseRef({ fallbackRef: 'upstream/trunk', remote: 'upstream' }, { pullRequestBase: 'fork/feature' })).toBe('fork/feature');
});

test('no inputs at all falls back to the supplied ref', () => {
  expect(resolveBaseRef({ fallbackRef: 'upstream/trunk', remote: 'upstream' })).toBe('upstream/trunk');
});

test('no measurable changed files passes without reading any coverage artifact', async () => {
  const reads: string[] = [];
  const result = await checkCoverageDiff({
    baseRef: 'b', repoRoot: '/repo', sourceRoots: rules.prefixes, thresholds,
    unitCoveragePath: '/repo/unit.lcov', integrationCoveragePath: '/repo/integration.lcov', isMeasurable: measurable,
    diff: { changedFiles: async () => ['README.md'] },
    reader: { readText: ({ path }) => { reads.push(path); return ''; } },
  });
  expect(result).toEqual({ ok: true, files: [] });
  expect(reads).toEqual([]);
});

test('a changed file reported twice by the diff is evaluated once', async () => {
  const result = await checkCoverageDiff({
    baseRef: 'b', repoRoot: '/repo', sourceRoots: rules.prefixes, thresholds,
    unitCoveragePath: '/repo/unit.lcov', integrationCoveragePath: '/repo/integration.lcov', isMeasurable: measurable,
    diff: { changedFiles: async () => [rec().file, rec().file] },
    reader: { readText: () => `SF:${rec().file}\nBRF:10\nBRH:10\nend_of_record\n` },
  });
  expect(result.ok).toBe(true);
  expect(result.files.map((f) => f.file)).toEqual([rec().file]);
});
