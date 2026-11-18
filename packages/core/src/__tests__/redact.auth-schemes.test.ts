import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// The diagnostics rules masked the value of every auth header name and scheme they knew; the engine
// knew only Bearer and Basic and two of the header names. Values here are obviously fake.
describe('custom auth headers', () => {
  it.each([
    ['x-auth-token: abc', 'x-auth-token: [REDACTED:api_key_header]'],
    ['X-Auth-Token: abc123', 'X-Auth-Token: [REDACTED:api_key_header]'],
    ['curl -H "x-auth-token: abc" https://x.test', 'curl -H "x-auth-token: [REDACTED:api_key_header]" https://x.test'],
    ['x-auth-token=abc;', 'x-auth-token=[REDACTED:api_key_header];'],
    ['Proxy-Authorization: Token abc123', 'Proxy-Authorization: Token [REDACTED:api_key_header]'],
    ['proxy-authorization: ApiKey abc123', 'proxy-authorization: ApiKey [REDACTED:api_key_header]'],
  ])('masks the value in %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
  it.each(['Proxy-Authorization: Basic abc', 'proxy-authorization: Bearer abc'])('masks the credential in %j', input => {
    expect(run(input).redacted).not.toContain('abc');
  });
});

describe('auth schemes other than Bearer', () => {
  it.each([
    ['Authorization: Token abc123def456', 'Authorization: Token [REDACTED:api_key_header]'],
    ['authorization: token abc123', 'authorization: token [REDACTED:api_key_header]'],
    ['Authorization: ApiKey abc123', 'Authorization: ApiKey [REDACTED:api_key_header]'],
    ['"Authorization": "Token abc123"', '"Authorization": "Token [REDACTED:api_key_header]"'],
    ['Authorization: Digest username="bob", realm="x", response="abc"', 'Authorization: Digest [REDACTED:api_key_header]'],
    ['sent (Authorization: Token abc123): refused', 'sent (Authorization: Token [REDACTED:api_key_header]): refused'],
  ])('masks the value in %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
  it('still masks a Basic credential in a header', () => {
    expect(run('Authorization: Basic QWxhZGRpbjpvcGVuc2VzYW1l').redacted).not.toContain('QWxhZGRpbjpv');
  });
  it.each([
    ['Basic dXNlcjpwYXNzd29yZDEy', 'Basic [REDACTED:bearer_token]'],
    ['Token abcdef0123456789abcdef', 'Token [REDACTED:bearer_token]'],
    ['sent Basic dXNlcjpwYXNzd29yZDEy now', 'sent Basic [REDACTED:bearer_token] now'],
  ])('masks a bare long scheme credential in %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
});

describe('scheme words that describe a header are not credentials', () => {
  it.each([
    'Authorization: Bearer', 'Authorization: Basic', 'Authorization: Digest', 'Authorization: Token', 'Authorization: ApiKey',
    'sent as `Authorization: Bearer`, the documented header.', 'Authorization: Basic.', 'authorization: Digest, then retry',
    'Basic authentication is not supported', 'Token expired at noon', 'Token abcdefabcdefabcdef', 'Token a1b2', 'basic dXNlcjpwYXNzd29yZDEy',
  ])('keeps %j byte for byte', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});

describe('second pass', () => {
  it.each([
    'x-auth-token: abc', 'Authorization: Token abc123', 'Authorization: Digest username="bob", response="abc"', 'Basic dXNlcjpwYXNzd29yZDEy',
    'Proxy-Authorization: Token abc123',
  ])('keeps the markers of %j', input => {
    const once = run(input).redacted;
    expect(run(once)).toEqual({ redacted: once, counts: {} });
  });
  it('scans a long header-less run in linear time', () => {
    const input = 'authorization '.repeat(20_000) + 'Token '.repeat(20_000);
    const started = performance.now();
    run(input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
