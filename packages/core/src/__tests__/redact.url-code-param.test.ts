import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// `code` was one of the URL secret words, and a name merely ENDING in a secret word is masked too, so
// postal, promo and error codes lost their values. Only the exact parameter name `code` (an OAuth
// authorization code, single-use but a credential) stays masked; every other secret word is unchanged.
describe('URL parameters whose name only ends in "code"', () => {
  it.each([
    '?zipcode=90210', '?postcode=12345', '?promo_code=SAVE10', '?error_code=42', '?country-code=US', '&areacode=415', '#statuscode=200',
  ])('keeps the value of %s', parameter => {
    const input = `https://example.com/a${parameter}&page=2`;
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it.each(['?code=abc', '&code=abc', '#code=abc', ';code=abc'])('still masks the exact name in %s', parameter => {
    expect(run(`https://example.com/cb${parameter}&state=1`).redacted)
      .toBe(`https://example.com/cb${parameter.slice(0, parameter.indexOf('=') + 1)}[REDACTED:url_secret_param]&state=1`);
  });
  it.each(['?sessionKey', '?authtoken', '?x_pwd', '?keys', '?token'])('keeps every other secret word masked: %s', name => {
    expect(run(`https://example.com/${name}=v1&page=2`).redacted).toBe(`https://example.com/${name}=[REDACTED:url_secret_param]&page=2`);
  });
});
