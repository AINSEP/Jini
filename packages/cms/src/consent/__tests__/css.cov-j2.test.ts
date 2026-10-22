import { describe, expect, it } from 'vitest';
import { compileConsentCss, CONSENT_CSS_SCOPE as root } from '../index.js';

describe('consent CSS grammar edges', () => {
  it('skips empty declarations between semicolons inside a rule', () => {
    const result = compileConsentCss({ css: '#jini-consent{;color:#111;;border-radius:8px;}' });
    expect(result.problems).toEqual([]);
    expect(result.css).toContain(`${root}{color:#111;border-radius:8px}`);
  });

  it('locates an unclosed group and an unclosed rule at the last consumed token', () => {
    expect(compileConsentCss({ css: '#jini-consent{color:rgb(1,2,3}' }).problems).toEqual([
      { code: 'syntax', message: 'Unclosed CSS group.', offset: 29 },
    ]);
    expect(compileConsentCss({ css: '#jini-consent{color:#111;' }).problems).toEqual([
      { code: 'syntax', message: 'Unclosed CSS rule.', offset: 24 },
    ]);
  });

  it('lets a failure that is not a CSS syntax error propagate instead of reporting it as a diagnostic', () => {
    // A host-built token object whose value can be read only once: serialization for the size
    // check succeeds, the second read while building the token rule throws a non-syntax error.
    let reads = 0;
    const tokens = {
      get backgroundColor(): string {
        reads += 1;
        if (reads > 1) throw new TypeError('token source already consumed');
        return '#fff';
      },
    };
    expect(() => compileConsentCss({ tokens })).toThrow(new TypeError('token source already consumed'));
  });
});
