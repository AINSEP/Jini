/** @file The gap ledger checker names each problem it exists to catch, and nothing else. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findGapProblems, type GapEntry } from '../scripts/gap-problems.ts';

const ledger: GapEntry[] = [{ file: 'src/a.ts', gap: 'G1', maxLines: 3 }];
const reading = (files: Record<string, string[]>) => ({ file }: { file: string }) => files[file] ?? null;

describe('findGapProblems', () => {
  it('returns nothing for a file that exists, is within budget and has its header', () => {
    assert.deepEqual(findGapProblems({ ledger, readLines: reading({ 'src/a.ts': ['// GAP: G1 why', 'x', 'y'] }) }), []);
  });

  it('names a missing file', () => {
    const problems = findGapProblems({ ledger, readLines: reading({}) });
    assert.deepEqual(problems.map((p) => p.kind), ['missing']);
    assert.match(problems[0]?.message ?? '', /src\/a\.ts.*does not exist/);
  });

  it('names a file over budget, and accepts exactly the budget', () => {
    const over = findGapProblems({ ledger, readLines: reading({ 'src/a.ts': ['// GAP: G1', 'x', 'y', 'z'] }) });
    assert.deepEqual(over.map((p) => p.kind), ['over-budget']);
    assert.match(over[0]?.message ?? '', /4 lines, budget 3/);
  });

  it('names a file without its header, and a header for another gap does not count', () => {
    for (const lines of [['x', 'y'], ['// GAP: G2 other', 'y']]) {
      assert.deepEqual(findGapProblems({ ledger, readLines: reading({ 'src/a.ts': lines }) }).map((p) => p.kind), ['no-header']);
    }
  });

  it('reports every problem of every entry', () => {
    const two: GapEntry[] = [...ledger, { file: 'src/b.ts', gap: 'G2', maxLines: 1 }];
    assert.equal(findGapProblems({ ledger: two, readLines: reading({ 'src/a.ts': ['x', 'y', 'z', 'w'] }) }).length, 3);
  });
});
