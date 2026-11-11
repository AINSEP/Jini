/**
 * Stryker L5 (2026-10-25): verify.ts's significant-word filter (`>= 4`, stopwords), the
 * substring minimum lengths (5 for the name, 8 for the check), the two-shared-words threshold and
 * the case/trim normalization all survived. Each case flips exactly one of them.
 */
import { describe, expect, it } from 'vitest';
import { enforceVerify, type ActiveRuleForVerify } from '../verify.js';

function verdict(rule: ActiveRuleForVerify, row: string, status: unknown = 'pass') {
  return enforceVerify({
    assistantOutput: 'x', activeRules: [rule], hadArtifact: true, verifyEnabled: true,
    extractScorecard: () => ({ rows: [{ rule: row, status: status as 'pass' }] }),
  });
}
const covered = (rule: ActiveRuleForVerify, row: string) => verdict(rule, row).uncoveredRules.length === 0;

describe('rowCoversRule boundaries', () => {
  it.each([
    ['5-char name contained in the row', { name: 'Alpha' }, 'the alpha section is fine', true],
    ['4-char name is too short for substring', { name: 'Beta' }, 'the beta section is fine', false],
    ['row contained in the name', { name: 'Accessible navigation menus' }, 'navigation', true],
    ['case and padding are normalized', { name: '  CONTRAST  ' }, '  contrast ok', true],
    ['8-char check contained in the row', { name: 'zz', check: 'tabindex' }, 'tabindex verified', true],
    ['7-char check is too short for substring', { name: 'zz', check: 'altattr' }, 'altattr present', false],
    ['two shared significant words', { name: 'zz', check: 'button labels describe actions' }, 'labels on buttons describe each', true],
    ['one shared significant word is not enough', { name: 'zz', check: 'button labels describe actions' }, 'labels only', false],
    ['3-letter words never count', { name: 'zz', check: 'use big red ink' }, 'big red', false],
    ['exactly 4-letter words count', { name: 'zz', check: 'keep text bold here' }, 'bold text', true],
    ['5-letter shared words count too (not via substring)', { name: 'zz', check: 'keep texts bolds here' }, 'bolds texts', true],
    ['stopwords never count', { name: 'zz', check: 'must should verify ensure' }, 'should must', false],
    ['punctuation splits words', { name: 'zz', check: 'focus-rings, skip-links' }, 'focus rings', true],
    ['blank row never covers', { name: 'Alpha' }, '   ', false],
  ])('%s', (_label, rule, row, expected) => {
    expect(covered(rule as ActiveRuleForVerify, row)).toBe(expected);
  });
});

describe('row status is fail-closed', () => {
  it.each([['pass', 'pass', 0], ['fail', 'fail', 1], ['PASS', 'fail', 1], ['', 'fail', 1], [null, 'fail', 1], ['error', 'fail', 1]])(
    'status %j → %s', (status, expected, failed) => {
      const result = verdict({ name: 'Alpha' }, 'alpha', status);
      expect(result.status).toBe(expected);
      expect(result.rowsFailed).toBe(failed);
    });

  it('one row cannot cover two rules', () => {
    const result = enforceVerify({
      assistantOutput: 'x', activeRules: [{ name: 'Alpha rule' }, { name: 'Alpha rules' }], hadArtifact: true, verifyEnabled: true,
      extractScorecard: () => ({ rows: [{ rule: 'alpha rules ok', status: 'pass' }] }),
    });
    expect(result).toMatchObject({ status: 'fail', rulesCovered: 1, uncoveredRules: ['Alpha rules'], rowsTotal: 1, rowsFailed: 0 });
  });
});
