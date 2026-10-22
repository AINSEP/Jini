import { describe, expect, it, vi } from 'vitest';
import { enforceVerify, type ActiveRuleForVerify, type EnforceVerifyInput, type VerifyScorecard } from '../verify.js';

function evaluate({ rules, rows, status }: { rules: ActiveRuleForVerify[]; rows: VerifyScorecard['rows']; status?: string }) {
  return enforceVerify({ assistantOutput: 'output', activeRules: rules, hadArtifact: true, verifyEnabled: true, extractScorecard: () => ({ rows, ...(status !== undefined ? { status } : {}) }) });
}

describe('verify L088 characterization', () => {
  it.each([
    [false, [], false, 'verify-disabled'], [true, [], false, 'no-rules'],
    [true, [{ name: 'rule' }], false, 'no-artifact'],
  ] as const)('skips before extraction with ordered precedence (%s, %j, %s)', (verifyEnabled, activeRules, hadArtifact, skipReason) => {
    const extractScorecard = vi.fn<EnforceVerifyInput['extractScorecard']>(() => null);
    expect(enforceVerify({ assistantOutput: '', activeRules: [...activeRules], hadArtifact, verifyEnabled, extractScorecard })).toEqual({ status: 'skipped', skipReason, rulesActive: activeRules.length, rulesCovered: 0, uncoveredRules: [], rowsTotal: 0, rowsFailed: 0, hadArtifact });
    expect(extractScorecard).not.toHaveBeenCalled();
  });

  it.each([null, { rows: null }, { rows: {} }])('rejects absent or malformed scorecards: %j', (raw) => {
    // Deliberately model a host parser returning malformed untrusted JSON.
    const extractScorecard = (): VerifyScorecard | null => raw as unknown as VerifyScorecard | null;
    expect(enforceVerify({ assistantOutput: '', activeRules: [{ name: 'alpha' }], hadArtifact: true, verifyEnabled: true, extractScorecard })).toEqual({ status: 'missing', rulesActive: 1, rulesCovered: 0, uncoveredRules: ['alpha'], rowsTotal: 0, rowsFailed: 0, hadArtifact: true });
  });

  it.each([
    ['', { name: 'alpha' }, false],
    [' ALPHA ', { name: 'alpha' }, true], ['alpha with suffix', { name: 'alpha' }, true],
    ['rubric text', { name: 'x', check: 'rubric text here' }, true],
    ['rubric text here plus', { name: 'x', check: 'rubric text here' }, true],
    ['abcd', { name: 'abcd' }, false], ['1234567', { name: 'x', check: '1234567' }, false],
    ['density palette different', { name: 'layout density palette' }, true],
    ['density unrelated', { name: 'layout density palette' }, false],
    ['the rule must ensure', { name: 'the rule must ensure' }, true],
    ['other the rule must ensure', { name: 'x', check: 'must the rule ensure' }, false],
  ] as const)('matches %j against %j as %s', (row, rule, covered) => {
    const result = evaluate({ rules: [rule], rows: [{ rule: row, status: 'pass' }] });
    expect(result).toEqual({ status: covered ? 'pass' : 'fail', rulesActive: 1, rulesCovered: covered ? 1 : 0, uncoveredRules: covered ? [] : [rule.name], rowsTotal: 1, rowsFailed: 0, hadArtifact: true });
  });

  it('consumes the first matching unused row in order without changing the host arrays', () => {
    const rules = [{ name: 'alpha' }, { name: 'alpha beta' }, { name: 'gamma' }];
    const rows: VerifyScorecard['rows'] = [{ rule: '', status: 'pass' }, { rule: 'alpha beta', status: 'pass' }, { rule: 'alpha', status: 'pass' }, { rule: 'unrelated', status: 'fail' }];
    const before = structuredClone({ rules, rows });
    expect(evaluate({ rules, rows, status: '' })).toEqual({ status: 'fail', rulesActive: 3, rulesCovered: 2, uncoveredRules: ['gamma'], scorecardStatus: '', rowsTotal: 4, rowsFailed: 1, hadArtifact: true });
    expect({ rules, rows }).toEqual(before);
  });

  it.each(['fail', 'FAIL', 'error', '', null])('counts a matched row with status %j as failed', (status) => {
    const rows = [{ rule: 'alpha', status }] as unknown as VerifyScorecard['rows'];
    expect(evaluate({ rules: [{ name: 'alpha' }], rows })).toEqual({ status: 'fail', rulesActive: 1, rulesCovered: 1, uncoveredRules: [], rowsTotal: 1, rowsFailed: 1, hadArtifact: true });
  });

  it('refuses a single-character substring as coverage for a long rule', () => {
    expect(evaluate({ rules: [{ name: 'require encryption' }], rows: [{ rule: 'e', status: 'pass' }] })).toEqual({ status: 'fail', rulesActive: 1, rulesCovered: 0, uncoveredRules: ['require encryption'], rowsTotal: 1, rowsFailed: 0, hadArtifact: true });
  });
});
