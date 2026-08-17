import { describe, expect, it } from 'vitest';
import type { Violation } from '../check-engine-boundaries.js';
import { diffAgainstBaseline, violationKey } from '../check-guard-drift.js';

/**
 * Unit tests for the CI-facing ratchet's actual enforcement logic — `diffAgainstBaseline` is what
 * decides whether `pnpm guard:drift` fails a build, so a bug here is a bug in the gate itself, not
 * just in reporting. See `check-guard-drift.ts`'s own module doc for why this has to be a multiset
 * diff rather than a set (a file can carry the same (rule, reason) pair more than once — two
 * separate deep-path imports on one line count, for example).
 */

function violation(rule: string, file: string, reason = 'reason'): Violation {
  return { rule, file, reason };
}

describe('violationKey', () => {
  it('produces the same key for two structurally-identical violations', () => {
    const a = violation('R2-deep-path', 'x.ts', 'deep-path import "@jini-ai/chat/core"');
    const b = violation('R2-deep-path', 'x.ts', 'deep-path import "@jini-ai/chat/core"');
    expect(violationKey(a)).toBe(violationKey(b));
  });

  it('produces a different key when only the reason differs', () => {
    const a = violation('R2-deep-path', 'x.ts', 'reason one');
    const b = violation('R2-deep-path', 'x.ts', 'reason two');
    expect(violationKey(a)).not.toBe(violationKey(b));
  });
});

describe('diffAgainstBaseline', () => {
  it('reports nothing added or removed when current exactly matches baseline', () => {
    const baseline = [violation('R5-neutrality', 'a.ts'), violation('R2-deep-path', 'b.ts')];
    const current = [violation('R5-neutrality', 'a.ts'), violation('R2-deep-path', 'b.ts')];
    const { added, removed } = diffAgainstBaseline(baseline, current);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('reports a genuinely new violation (different file) as added', () => {
    const baseline = [violation('R5-neutrality', 'a.ts')];
    const current = [violation('R5-neutrality', 'a.ts'), violation('R5-neutrality', 'new-file.ts')];
    const { added, removed } = diffAgainstBaseline(baseline, current);
    expect(added).toEqual([violation('R5-neutrality', 'new-file.ts')]);
    expect(removed).toEqual([]);
  });

  it('reports a fixed violation as removed, not added', () => {
    const baseline = [violation('R5-neutrality', 'a.ts'), violation('R5-neutrality', 'fixed.ts')];
    const current = [violation('R5-neutrality', 'a.ts')];
    const { added, removed } = diffAgainstBaseline(baseline, current);
    expect(added).toEqual([]);
    expect(removed).toEqual([violation('R5-neutrality', 'fixed.ts')]);
  });

  it('does not flag a violation as new merely because it appears twice in one file and the baseline also has it twice', () => {
    const twice = [violation('R2-deep-path', 'dup.ts'), violation('R2-deep-path', 'dup.ts')];
    const { added, removed } = diffAgainstBaseline(twice, twice);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('flags only the EXCESS instances when a duplicated-key violation becomes more numerous — the multiset case a plain Set-based diff would miss', () => {
    const baseline = [violation('R2-deep-path', 'dup.ts'), violation('R2-deep-path', 'dup.ts')];
    // A third import of the same banned deep path landed in the same file.
    const current = [
      violation('R2-deep-path', 'dup.ts'),
      violation('R2-deep-path', 'dup.ts'),
      violation('R2-deep-path', 'dup.ts'),
    ];
    const { added, removed } = diffAgainstBaseline(baseline, current);
    expect(added).toHaveLength(1);
    expect(added[0]).toEqual(violation('R2-deep-path', 'dup.ts'));
    expect(removed).toEqual([]);
  });

  it('flags only the missing instances when a duplicated-key violation becomes less numerous', () => {
    const baseline = [
      violation('R2-deep-path', 'dup.ts'),
      violation('R2-deep-path', 'dup.ts'),
      violation('R2-deep-path', 'dup.ts'),
    ];
    // One of the three imports got fixed; two remain.
    const current = [violation('R2-deep-path', 'dup.ts'), violation('R2-deep-path', 'dup.ts')];
    const { added, removed } = diffAgainstBaseline(baseline, current);
    expect(added).toEqual([]);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toEqual(violation('R2-deep-path', 'dup.ts'));
  });

  it('handles a violation moving to a different rule as both an addition and a removal, not a match', () => {
    const baseline = [violation('R2-deep-path', 'same-file.ts', 'same reason text')];
    const current = [violation('R5-neutrality', 'same-file.ts', 'same reason text')];
    const { added, removed } = diffAgainstBaseline(baseline, current);
    expect(added).toEqual([violation('R5-neutrality', 'same-file.ts', 'same reason text')]);
    expect(removed).toEqual([violation('R2-deep-path', 'same-file.ts', 'same reason text')]);
  });

  it('handles empty baseline and empty current without throwing', () => {
    expect(diffAgainstBaseline([], [])).toEqual({ added: [], removed: [] });
  });
});
