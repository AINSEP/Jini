import { describe, expect, it } from 'vitest';
import { parseRuleBody } from '../rule-body.js';

describe('rule-body L088 characterization', () => {
  it('keeps the first nonempty value of each label and shares the rationale slot', () => {
    const body = [
      'unlabeled prose', 'Assertion:  ', 'CHECK:', 'Verified by:', 'Other: ignored',
      '  aSsErTiOn: first assertion  ', 'Assertion: later assertion',
      'Check: first check', 'Check: later check',
      'Rationale: first rationale', 'Verified by: later provenance',
    ].join('\r\n');
    expect(parseRuleBody({ body })).toEqual({ assertion: 'first assertion', check: 'first check', rationale: 'first rationale' });
  });

  it.each([
    ['', { assertion: '', check: '', rationale: '' }],
    ['  prose\nsecond line', { assertion: 'prose', check: 'prose', rationale: '' }],
    ['Assertion: \nCheck: explicit\nVerified by: proof', { assertion: 'Assertion:', check: 'explicit', rationale: 'proof' }],
    ['Verified by: proof\nRationale: ignored', { assertion: 'Verified by: proof', check: 'Verified by: proof', rationale: 'proof' }],
    ['Assertion : spaced label\nCheck: rubric', { assertion: 'Assertion : spaced label', check: 'rubric', rationale: '' }],
    ['constructor: ignored\nCheck: rubric', { assertion: 'constructor: ignored', check: 'rubric', rationale: '' }],
  ] as const)('preserves fallback and ignored-label behavior for %j', (body, expected) => {
    expect(parseRuleBody({ body })).toEqual(expected);
  });
});
