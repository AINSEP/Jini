import { describe, expect, it } from 'vitest';
import { redactSecrets, redactSecretsWithCounts } from '../redact.js';

describe('exact-only redaction', () => {
  it('preserves every character when secrets are absent or empty, ignoring every heuristic pass', () => {
    const input = 'Bearer abc123 password=hunter2 person@example.com 10.1.2.3 4111 1111 1111 1111 opaque_token_123456789012345';
    for (const exactSecrets of [undefined, [], ['', undefined, null]]) {
      expect(redactSecretsWithCounts({ input }, {
        policy: 'exact-only', ...(exactSecrets ? { exactSecrets } : {}),
        extraPatterns: [{ name: 'everything', regex: /.+/g }], redactPii: true,
      })).toEqual({ redacted: input, counts: {} });
    }
    expect(redactSecretsWithCounts({ input: '' }, { policy: 'exact-only', exactSecrets: ['x'] }))
      .toEqual({ redacted: '', counts: {} });
  });

  it('deduplicates secrets and redacts each matched range once', () => {
    expect(redactSecretsWithCounts({ input: 'abcdef abc ababa a.*+$[x](y)?|\\' }, {
      policy: 'exact-only', exactSecrets: ['abc', 'abcdef', 'abc', 'aba', 'bab', 'a.*+$[x](y)?|\\'],
    })).toEqual({
      // 'ababa' is covered by overlapping 'aba'/'bab'/'aba' matches: one marker, nothing left behind.
      redacted: '[REDACTED:exact_secret] [REDACTED:exact_secret] [REDACTED:exact_secret] [REDACTED:exact_secret]',
      counts: { exact_secret: 4 },
    });
  });

  it('merges overlapping secrets into one marker so no part of either leaks', () => {
    expect(redactSecretsWithCounts({ input: 'xabcdefx abc bcdef' }, { policy: 'exact-only', exactSecrets: ['abc', 'bcdef'] }))
      .toEqual({ redacted: 'x[REDACTED:exact_secret]x [REDACTED:exact_secret] [REDACTED:exact_secret]', counts: { exact_secret: 3 } });
    expect(redactSecrets({ input: 'xx' }, { policy: 'exact-only', exactSecrets: ['x'], marker: '#' })).toBe('##');
  });

  it('inserts markers literally once even when they contain secrets or replacement syntax', () => {
    const marker = 'abc $& $$ $` $\'';
    expect(redactSecretsWithCounts({ input: 'abcdef abc' }, {
      policy: 'exact-only', exactSecrets: ['abc', 'abcdef', '$'], marker,
    })).toEqual({ redacted: `${marker} ${marker}`, counts: { exact_secret: 2 } });
    expect(redactSecrets({ input: 'x-x' }, { policy: 'exact-only', exactSecrets: ['x'], marker: '' })).toBe('-');
  });

  it('preserves provider JSON and SSE framing verbatim around exact matches', () => {
    const input = 'data: { "id":"model_identifier_1234567890", "delta": "secret-value", "mail":"a@b.co" }\r\n\r\n'
      + ': secret-value\r\ndata: [DONE]\r\n\r\n';
    const expected = 'data: { "id":"model_identifier_1234567890", "delta": "[redacted]", "mail":"a@b.co" }\r\n\r\n'
      + ': [redacted]\r\ndata: [DONE]\r\n\r\n';
    expect(redactSecretsWithCounts({ input }, {
      policy: 'exact-only', exactSecrets: ['secret-value'], marker: '[redacted]',
    })).toEqual({ redacted: expected, counts: { exact_secret: 2 } });
    expect(redactSecrets({ input }, { policy: 'exact-only', exactSecrets: ['secret-value'], marker: '[redacted]' })).toBe(expected);
  });

  it('leaves conservative and aggressive behavior unchanged and ignores marker outside exact-only', () => {
    const input = 'known person@example.com opaque_token_123456789012345';
    expect(redactSecrets({ input }, { exactSecrets: ['known'], marker: 'custom' }))
      .toBe('[REDACTED:exact_secret] [REDACTED:email] opaque_token_123456789012345');
    expect(redactSecrets({ input }, { policy: 'aggressive', exactSecrets: ['known'], marker: 'custom' }))
      .toBe('[REDACTED:exact_secret] [REDACTED:email] [REDACTED:opaque_token]');
  });
});
