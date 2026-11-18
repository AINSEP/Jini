import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// A custom auth header (`x-auth-token`, `x-api-key`, ...) may carry a scheme word before its credential,
// and a proxy header may carry the credential with no scheme at all. Masking only the scheme word, or
// nothing, leaves the credential visible.
describe('custom auth headers mask the credential, with or without a scheme word', () => {
  it.each([
    ['x-auth-token: Token abcdefgh12345678', 'x-auth-token: [REDACTED:api_key_header]'],
    ['X-Api-Key: ApiKey abcdefgh12345678', 'X-Api-Key: [REDACTED:api_key_header]'],
    ['x-api-key: Bearer abcdefgh12345678', 'x-api-key: [REDACTED:api_key_header]'],
    ['x-api-key: Bearer short1', 'x-api-key: [REDACTED:api_key_header]'],
    ['x-goog-api-key: Basic dXNlcjpwYXNz', 'x-goog-api-key: [REDACTED:api_key_header]'],
    ['api-key: Token abc12', 'api-key: [REDACTED:api_key_header]'],
    ['x-auth-token: Digest username="bob", response="dead beef"', 'x-auth-token: [REDACTED:api_key_header]'],
    ['api-key: Digest username="a b", realm="r s", response="c d"', 'api-key: [REDACTED:api_key_header]'],
    ['Proxy-Authorization: abcdefgh12345678', 'Proxy-Authorization: [REDACTED:api_key_header]'],
    ['proxy-authorization: dXNlcjpwYXNz', 'proxy-authorization: [REDACTED:api_key_header]'],
    ['proxy-authorization=abc12345 retry', 'proxy-authorization=[REDACTED:api_key_header] retry'],
    ['{"x-auth-token":"Token abcdefgh12345678"}', '{"x-auth-token":"[REDACTED:api_key_header]"}'],
    ['x-auth-token: Token abcdefgh12345678\nHost: example.test', 'x-auth-token: [REDACTED:api_key_header]\nHost: example.test'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it.each([
    'x-api-key: Bearer', 'x-auth-token: Token', 'Proxy-Authorization: Bearer', 'Proxy-Authorization: Digest', 'x-api-key: Bearer.',
    'Authorization: Bearer', 'x-forwarded-proxy-authorization-note: none',
  ])('keeps a scheme word with no credential: %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it('still masks a Proxy-Authorization value that carries a scheme', () => {
    const out = run('Proxy-Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==').redacted;
    expect(out).not.toContain('dXNlcjpw');
    expect(out).toMatch(/^Proxy-Authorization: \[REDACTED:[a-z_]+\]$/);
  });
});
