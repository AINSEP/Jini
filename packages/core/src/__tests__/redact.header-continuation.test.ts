import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;

// A header value may continue on a folded line (a line break followed by indentation), and the credential after a scheme
// word may sit on that line. The rules chat used before read any whitespace there; every header rule here reads it the
// same way. Values are obviously fake.
describe('header values on folded continuation lines', () => {
  it.each([
    ['X-Auth-Token: Basic\r\n  dXNlcjpwdw==', 'X-Auth-Token: [REDACTED:api_key_header]'],
    ['x-api-key: Token\n\tFAKEvalue42', 'x-api-key: [REDACTED:api_key_header]'],
  ])('masks a credential after a scheme word on the next line: %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it('masks every cookie pair, including pairs on a folded continuation line', () => {
    const input = 'Cookie: theme=dark;\r\n  sessionid=FakeSess10nValue0000000a';
    expect(run(input)).toBe('Cookie: [REDACTED:labeled_secret]');
  });

  it('keeps the line after a cookie header when it is not indented', () => {
    expect(run('Cookie: a=b\nNext line stays')).toBe('Cookie: [REDACTED:labeled_secret]\nNext line stays');
  });

  it.each(['credentials', 'token', 'authentication'])('masks a description word used as the value of an Authorization header: %s', word => {
    expect(run(`Authorization: Bearer ${word}`)).toBe('Authorization: Bearer [REDACTED:api_key_header]');
  });

  it('keeps a description word after Bearer outside a header', () => {
    expect(run('Send Bearer credentials with each call')).toBe('Send Bearer credentials with each call');
  });

  it('keeps a documentation placeholder and an already masked header value', () => {
    expect(run('Authorization: Bearer <API_KEY>')).toBe('Authorization: Bearer <API_KEY>');
    expect(run('Authorization: Bearer [REDACTED:bearer_token]')).toBe('Authorization: Bearer [REDACTED:bearer_token]');
  });
});

describe('long padding before a bare scheme word', () => {
  const elapsed = (size: number): number => {
    const input = `Authorization:${' '.repeat(size)}Basic`;
    const started = performance.now();
    run(input);
    return performance.now() - started;
  };

  it('stays linear when the padding doubles', () => {
    elapsed(20_000);
    const small = Math.max(elapsed(40_000), 1);
    const large = elapsed(80_000);
    // Linear work doubles; the former backtracking quadrupled. A generous bound absorbs timer noise.
    expect(large).toBeLessThan(small * 3 + 50);
  });
});

// A header name never introduces prose: the token after `authorization:` is its value even mid-sentence, as the rules chat
// used before read it.
describe('the value after an authorization label inside a sentence', () => {
  it.each(['Hey, my authorization: abc thanks', 'Hey, my authorization :  abc thanks', 'my authorization:abc ok'])('masks the value in %j', input => {
    expect(run(input)).not.toMatch(/\babc\b/);
  });

  it('keeps a placeholder after the label', () => {
    expect(run('Authorization: (skipped)')).toBe('Authorization: (skipped)');
  });
});
