import { expect, it } from 'vitest';
import { compileConsentCss, CONSENT_CSS_SCOPE } from '../index.js';

it('accepts a bounded opaque shadow and refuses a fifth shadow dimension', () => {
  const valid = compileConsentCss({ css: '#jini-consent{box-shadow:1px 2px 3px #123456}' });
  expect(valid.problems).toEqual([]);
  expect(valid.css).toContain(`${CONSENT_CSS_SCOPE}{box-shadow:1px 2px 3px #123456}`);
  const invalid = compileConsentCss({ css: '#jini-consent{box-shadow:1px 2px 3px 4px 5px #123456}' });
  expect(invalid.problems).toEqual([expect.objectContaining({ code: 'value', property: 'box-shadow' })]);
  expect(invalid.css).not.toContain('box-shadow:1px');
});
