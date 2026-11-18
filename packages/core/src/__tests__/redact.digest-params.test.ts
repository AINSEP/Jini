import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// A Digest credential is a parameter list whose quoted values may hold spaces and commas
// (`realm="my realm"`). The whole list is the credential: ending the match at the first space left the
// rest of the response visible.
describe('a Digest parameter list is masked whole', () => {
  it.each([
    ['Authorization: Digest username="bob", realm="my realm", response="abc def", opaque="x"', 'Authorization: Digest [REDACTED:api_key_header]'],
    ['Authorization: Digest username="a b", response="c d"', 'Authorization: Digest [REDACTED:api_key_header]'],
    ['Proxy-Authorization: Digest username="a b", response="c d"', 'Proxy-Authorization: Digest [REDACTED:api_key_header]'],
    ['Authorization: Digest username="Mufasa", realm="a@b.test", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", uri="/dir/index.html", qop=auth, nc=00000001, cnonce="0a4f113b", response="6629fae49393a05397450978507c4ef1", opaque="5ccc069c403ebaf9f0171e9517f40e41"', 'Authorization: Digest [REDACTED:api_key_header]'],
    ['Authorization: Digest response="a\\"b c d"', 'Authorization: Digest [REDACTED:api_key_header]'],
    ['Authorization: Digest username="x", response="never closed\nHost: example.test', 'Authorization: Digest [REDACTED:api_key_header]\nHost: example.test'],
    ['Authorization: Digest a="b c"\nHost: example.test', 'Authorization: Digest [REDACTED:api_key_header]\nHost: example.test'],
    ['(Authorization: Digest username="a b", response="c d") failed', '(Authorization: Digest [REDACTED:api_key_header]) failed'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it('keeps a Digest scheme word with no parameters', () => {
    expect(run('Authorization: Digest').redacted).toBe('Authorization: Digest');
  });
});
