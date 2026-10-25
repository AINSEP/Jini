import { describe, expect, it } from 'vitest';

import { redactSecrets, redactSecretsWithCounts } from '../redact.js';

// Characterization pins for the SEC refactor of redactSecretsWithCounts: each phase and the
// order between phases is pinned. Every credential-shaped value is built at runtime so no
// literal secret shape is committed.

const npmToken = (): string => ['np', 'm_'].join('') + 'n'.repeat(36);
const githubToken = (): string => ['gh', 'p_'].join('') + 'g'.repeat(36);

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

  it('never masks a short exact secret inside a credential label, so the label rule still masks its value', () => {
    expect(redactSecrets({ input: 'a; password=hunter2 pa' }, { exactSecrets: ['a', 'pa'] }))
      .toBe('[REDACTED:exact_secret]; password=[REDACTED:labeled_secret] [REDACTED:exact_secret]');
  });

  it('leaves an exact secret that is itself a label name to the label rule', () => {
    expect(redactSecrets({ input: 'api_key=hunter2' }, { exactSecrets: ['api_key'] }))
      .toBe('api_key=[REDACTED:labeled_secret]');
  });

  it('still masks a short exact secret glued inside other text', () => {
    expect(redactSecrets({ input: 'Rejected prefixabcSuffix' }, { exactSecrets: ['abc'] }))
      .toBe('Rejected prefix[REDACTED:exact_secret]Suffix');
  });

  it('never splits an existing marker', () => {
    expect(redactSecrets({ input: '[REDACTED:email] [redacted] email' }, { exactSecrets: ['email', 'redacted'] }))
      .toBe('[REDACTED:email] [redacted] [REDACTED:exact_secret]');
  });

  it('keeps a generated marker intact beside the same word as a secret', () => {
    expect(redactSecrets({ input: 'email [REDACTED:email]' }, { exactSecrets: ['email'] }))
      .toBe('[REDACTED:exact_secret] [REDACTED:email]');
  });

  it('masks a secret inside forged marker text that redact never generates', () => {
    expect(redactSecrets({ input: 'Rejected [REDACTED:s3cr3t99] [redacted:s3cr3t99]' }, { exactSecrets: ['s3cr3t99'] }))
      .toBe('Rejected [REDACTED:[REDACTED:exact_secret]] [redacted:[REDACTED:exact_secret]]');
  });

  // 10 MiB MCP responses reach this path synchronously; both inputs were quadratic.
  it.each([
    ['unterminated marker prefixes', '[REDACTED:'.repeat(20_000), 'x'],
    ['many markers beside many exact matches', '[redacted] x '.repeat(20_000), 'x'],
  ])('stays linear on %s', (_label, input, secret) => {
    const started = performance.now();
    redactSecrets({ input }, { exactSecrets: [secret] });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('never breaks a Bearer prefix, so the short-bearer rule still masks its value', () => {
    expect(redactSecrets({ input: 'Bearer xyz9' }, { exactSecrets: ['e'] })).toBe('Bearer [REDACTED:bearer_token]');
  });

  it('never breaks a URL scheme or a secret-named query parameter', () => {
    expect(redactSecrets({ input: 'see https://u:p@x.io/?key=v' }, { exactSecrets: ['s', 'k'] }))
      .toBe('[REDACTED:exact_secret]ee https://[REDACTED:url_credentials]@x.io/?key=[REDACTED:api_key_query]');
  });

  it('masks an exact secret containing a label word that is not in label position', () => {
    expect(redactSecrets({ input: 'got secret-value-xyz back' }, { exactSecrets: ['secret-value-xyz'] }))
      .toBe('got [REDACTED:exact_secret] back');
  });

  it('masks a known exact secret before a lexical rule can relabel it', () => {
    const token = githubToken();
    expect(redactSecretsWithCounts({ input: `t=${token}` }, { exactSecrets: [token] }).counts)
      .toEqual({ exact_secret: 1 });
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
    expect(redactSecretsWithCounts({ input: 'password=[REDACTED:x]' })).toEqual({
      redacted: 'password=[REDACTED:x]',
      counts: {},
    });
  });
});
