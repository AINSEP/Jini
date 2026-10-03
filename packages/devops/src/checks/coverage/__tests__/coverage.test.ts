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
