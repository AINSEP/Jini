import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

// One engine for chat's user text and every other caller (owner decision 2026-11-17, C-CHAT-DEPS E2).
const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

describe('Bearer prose is not a credential', () => {
  it.each([
    'Bearer token authentication is supported.', 'Use Bearer tokens, not cookies.', 'Bearer authentication',
    'Bearer authorization headers', 'the Bearer auth flow', 'Bearer scheme)', 'Bearer credential rotation',
    'Bearer credentials!', 'Bearer token.', 'Authorization: Bearer token',
  ])('keeps %j byte for byte', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it.each([
    ['Bearer x', 'Bearer [REDACTED:bearer_token]'],
    ['Bearer auth-1a2b3c ok', 'Bearer [REDACTED:bearer_token] ok'],
    ['Bearer token.abc123 ok', 'Bearer [REDACTED:bearer_token] ok'],
    ['Bearer tokenX ok', 'Bearer [REDACTED:bearer_token] ok'],
    ['Bearer Bearer x', 'Bearer [REDACTED:bearer_token] [REDACTED:bearer_token]'],
  ])('still masks %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
});

describe('short sk- keys', () => {
  it.each(['sk-abcdefghijklmnop', 'sk-abcdefghijklmnopqr'])('masks %j (16-19 characters after the prefix)', key => {
    expect(run(`key ${key} end`)).toEqual({ redacted: 'key [REDACTED:sk_key] end', counts: { sk_key: 1 } });
  });
  it('leaves a 15-character tail alone', () => {
    expect(run('key sk-abcdefghijklmno end').redacted).toBe('key sk-abcdefghijklmno end');
  });
});

describe('generated markers survive a second pass', () => {
  it.each(['Bearer [REDACTED:credential] ok', 'api_key=[REDACTED:credential] ok', 'see https://x.test/-[REDACTED:credential] now'])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it('masks a Slack token after a dash in a URL path', () => {
    expect(run('see https://x.test/-xoxb-1234567890-abcdefghij now').redacted).toBe('see https://x.test/-[REDACTED:slack_token] now');
  });
});
