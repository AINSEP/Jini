import { describe, expect, it } from 'vitest';

import { redactSecrets, redactSecretsWithCounts } from '../redact.js';

// Characterization pins for the SEC refactor of redactSecretsWithCounts: each phase and the
// order between phases is pinned. Every credential-shaped value is built at runtime so no
// literal secret shape is committed.

const npmToken = (): string => ['np', 'm_'].join('') + 'n'.repeat(36);
const githubToken = (): string => ['gh', 'p_'].join('') + 'g'.repeat(36);
const skPrefix = (): string => ['s', 'k-'].join('') + 's'.repeat(20);

describe('@jini-ai/core — redact — characterization pins', () => {
  it('masks a provider api-key header the core header rule cannot anchor, normalizing its separator', () => {
    expect(redactSecretsWithCounts({ input: 'my-x-api-key=abc123 tail' })).toEqual({
      redacted: 'my-x-api-key: [REDACTED:api_key_header] tail',
      counts: { api_key_header: 1 },
    });
  });

  it('leaves an already-masked provider api-key header value alone and uncounted', () => {
    const once = redactSecrets({ input: 'my-x-api-key=abc123' });
    expect(redactSecretsWithCounts({ input: once })).toEqual({ redacted: once, counts: {} });
  });

  it('masks exact secrets longest first so a shorter secret cannot split a longer one', () => {
    expect(redactSecretsWithCounts({ input: 'abcdef abc' }, { exactSecrets: ['abc', 'abcdef'] })).toEqual({
      redacted: '[REDACTED:exact_secret] [REDACTED:exact_secret]',
      counts: { exact_secret: 2 },
    });
  });

  // Exact secrets run after every lexical rule, so a short secret may split a label word the
  // label rule already processed; the case passes as long as no real value survives.
  it.each([
    ['a short secret inside a label', 'a; password=hunter2 pa', ['a', 'pa'], ['hunter2'],
      '[REDACTED:exact_secret]; [REDACTED:exact_secret]ssword=[REDACTED:labeled_secret] [REDACTED:exact_secret]'],
    ['a secret that is itself a label name', 'api_key=hunter2', ['api_key'], ['hunter2'],
      '[REDACTED:exact_secret]=[REDACTED:labeled_secret]'],
    ['a short secret glued inside other text', 'Rejected prefixabcSuffix', ['abc'], [],
      'Rejected prefix[REDACTED:exact_secret]Suffix'],
    ['forged marker text redact never generates', 'Rejected [REDACTED:s3cr3t99] [redacted:s3cr3t99]', ['s3cr3t99'], [],
      'Rejected [REDACTED:[REDACTED:exact_secret]] [redacted:[REDACTED:exact_secret]]'],
    ['a secret shaped like a URL scheme', 'Rejected s3cr3t99://host', ['s3cr3t99'], [],
      'Rejected [REDACTED:exact_secret]://host'],
    ['a secret after a Bearer prefix', 'Authorization: Bearer s3cr3t99', ['s3cr3t99'], [],
      'Authorization: Bearer [REDACTED:bearer_token]'],
    ['a one-letter secret inside a URL scheme', 'see https://user:pw@host', ['s'], ['user', 'pw'],
      '[REDACTED:exact_secret]ee http[REDACTED:exact_secret]://[REDACTED:url_credentials]@ho[REDACTED:exact_secret]t'],
    ['a one-letter secret inside a query name', 'GET /x?key=v4lue', ['k'], ['v4lue'],
      'GET /x?[REDACTED:exact_secret]ey=[REDACTED:api_key_query]'],
    ['a one-letter secret inside a Bearer prefix', 'Bearer hunter2', ['e'], ['hunter2'],
      'B[REDACTED:exact_secret]ar[REDACTED:exact_secret]r [REDACTED:bearer_token]'],
    ['a secret named like a generated marker', 'email [REDACTED:email]', ['email'], [],
      '[REDACTED:exact_secret] [REDACTED:email]'],
    ['a secret named like a marker with another case', '[REDACTED:EMAIL]', ['EMAIL'], [],
      '[REDACTED:[REDACTED:exact_secret]]'],
    // The label, vendor and query rules each stop partway through these; the pre-pass masks them whole.
    ['a secret with spaces after a label', 'password=correct horse battery', ['correct horse battery'], ['horse battery'],
      'password=[REDACTED:exact_secret]'],
    ['a dotted secret glued onto a vendor-shaped token', `${skPrefix()}abc.def.ghi.jkl.mno`, ['abc.def.ghi.jkl.mno'], ['.def.ghi'],
      '[REDACTED:sk_key][REDACTED:exact_secret]'],
    ['a 16+ char secret after api_key=', `GET /x?api_key=${'Q'.repeat(8)}&${'q'.repeat(8)}`, [`${'Q'.repeat(8)}&${'q'.repeat(8)}`], ['q'.repeat(8)],
      'GET /x?api_key=[REDACTED:exact_secret]'],
  ])('leaves no secret value in %s', (_label, input, exactSecrets, otherValues, expected) => {
    const redacted = redactSecrets({ input }, { exactSecrets });
    expect(redacted).toBe(expected);
    const outsideMarkers = redacted.replace(/\[REDACTED:(?:exact_secret|labeled_secret|url_credentials|api_key_query|bearer_token|email|sk_key)\]/g, '');
    for (const value of [...exactSecrets, ...otherValues]) expect(outsideMarkers).not.toContain(value);
  });

  it('never splits an existing marker', () => {
    expect(redactSecrets({ input: '[REDACTED:email] [redacted] email' }, { exactSecrets: ['email', 'redacted'] }))
      .toBe('[REDACTED:email] [redacted] [REDACTED:exact_secret]');
  });

  // 10 MiB MCP responses reach this path synchronously; each input was quadratic.
  it.each([
    ['unterminated marker prefixes', '[REDACTED:'.repeat(20_000), ['x']],
    ['many markers beside many exact matches', '[redacted] x '.repeat(20_000), ['x']],
    ['a long dotted run (URL scheme and email local part)', 'a.'.repeat(20_000), []],
  ])('stays linear on %s', (_label, input, exactSecrets) => {
    const started = performance.now();
    redactSecrets({ input }, { exactSecrets });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('masks URL userinfo behind a scheme glued onto a long word', () => {
    expect(redactSecrets({ input: `${'x'.repeat(40)}https://u:pw@h` })).toBe(`${'x'.repeat(40)}https://[REDACTED:url_credentials]@h`);
  });

  it('masks an exact secret containing a label word that is not in label position', () => {
    expect(redactSecrets({ input: 'got secret-value-xyz back' }, { exactSecrets: ['secret-value-xyz'] }))
      .toBe('got [REDACTED:exact_secret] back');
  });

  it('lets a lexical rule label a short known secret it recognizes before exact substitution runs', () => {
    expect(redactSecretsWithCounts({ input: 'Bearer s3cr3t99' }, { exactSecrets: ['s3cr3t99'] })).toEqual({
      redacted: 'Bearer [REDACTED:bearer_token]',
      counts: { bearer_token: 1 },
    });
  });

  it('masks a 16+ char known secret in the exact pre-pass, before a lexical rule can label it', () => {
    const token = githubToken();
    expect(redactSecretsWithCounts({ input: `t=${token}` }, { exactSecrets: [token] })).toEqual({
      redacted: 't=[REDACTED:exact_secret]',
      counts: { exact_secret: 1 },
    });
  });

  it('applies a non-global extra pattern to every occurrence', () => {
    expect(redactSecretsWithCounts({ input: 'zz1 zz2' }, { extraPatterns: [{ name: 'zz', regex: /zz\d/ }] })).toEqual({
      redacted: '[REDACTED:zz] [REDACTED:zz]',
      counts: { zz: 2 },
    });
  });

  it('does not leak lastIndex state from a caller-owned global extra pattern across calls', () => {
    const extraPatterns = [{ name: 'zz', regex: /zz\d/g }];
    expect(redactSecrets({ input: 'zz1' }, { extraPatterns })).toBe('[REDACTED:zz]');
    expect(redactSecrets({ input: 'zz1' }, { extraPatterns })).toBe('[REDACTED:zz]');
  });

  it('labels a shape known only to the static-scan vocabulary as a credential', () => {
    expect(redactSecretsWithCounts({ input: `x ${npmToken()} y` })).toEqual({
      redacted: 'x [REDACTED:credential] y',
      counts: { credential: 1 },
    });
  });

  it('keeps addresses, numbers and cards readable when PII redaction is off, but still masks credentials', () => {
    const input = `mail a@b.co ip 10.1.2.3 call 415-555-1234 card 4111 1111 1111 1111 key ${githubToken()}`;
    expect(redactSecretsWithCounts({ input }, { redactPii: false })).toEqual({
      redacted: 'mail a@b.co ip 10.1.2.3 call 415-555-1234 card 4111 1111 1111 1111 key [REDACTED:github_token]',
      counts: { github_token: 1 },
    });
  });

  it('runs the aggressive opaque rule before PII rules so a long digit run is one opaque token', () => {
    expect(redactSecretsWithCounts({ input: '41555512344155551234' }, { policy: 'aggressive' })).toEqual({
      redacted: '[REDACTED:opaque_token]',
      counts: { opaque_token: 1 },
    });
  });

  it('leaves opaque runs readable under the default conservative policy', () => {
    expect(redactSecrets({ input: 'abcdefghijklmnopqrstuvwxyz' })).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('masks a short labeled value but not one already masked by an earlier rule', () => {
    expect(redactSecretsWithCounts({ input: 'password=hunter' })).toEqual({
      redacted: 'password=[REDACTED:labeled_secret]',
      counts: { labeled_secret: 1 },
    });
    const once = redactSecrets({ input: 'password=hunter' });
    expect(redactSecretsWithCounts({ input: once })).toEqual({ redacted: once, counts: {} });
  });

  it('masks and counts a labeled value that only looks like a marker', () => {
    expect(redactSecretsWithCounts({ input: 'password=[REDACTED:x]' })).toEqual({
      redacted: 'password=[REDACTED:labeled_secret]',
      counts: { labeled_secret: 1 },
    });
  });
});
