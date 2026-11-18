import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// A short value after a form label that merely ends in "key" ("Sort key: name") is an answer, not a
// credential; a version or build identifier after the word "Token" is not one either.
describe('a form label that ends in "key" with a short answer', () => {
  it.each(['Sort key: ab', 'Sort key: name', 'sort key: b', 'Primary key: 1', 'Partition key: user_id', 'Cache key: tenant:42', '- Foreign key: id'])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it.each([
    ['key: ab', 'key: [REDACTED:labeled_secret]'],
    ['key: abcdefghijkl', 'key: [REDACTED:labeled_secret]'],
    ['secret key: ab', 'secret key: [REDACTED:labeled_secret]'],
    ['signing key: ab', 'signing key: [REDACTED:labeled_secret]'],
    ['Sort key: abcdefgh1234567890', 'Sort key: [REDACTED:labeled_secret]'],
    ['key=abc', 'key=[REDACTED:labeled_secret]'],
    ['{"key": "abc"}', '{"key": "[REDACTED:labeled_secret]"}'],
  ])('still masks a key-shaped value: %j', (input, expected) => {
    expect(run(input).redacted).toBe(expected);
  });
});

describe('a release identifier after the word Token', () => {
  it.each([
    'Token v2.0.14-rc1abcdefgh released', 'release Token 2024.11.18.build1234567', 'Token 1.2.3-beta.4567890123', 'the Token 10.4.0.rc1.build987654321 shipped',
  ])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it.each([
    ['Token abcdefgh12345678xyz9', 'Token [REDACTED:bearer_token]'],
    ['Token 2abcdefgh12345678', 'Token [REDACTED:bearer_token]'],
    ['Basic 1234567890123456', 'Basic [REDACTED:bearer_token]'],
  ])('still masks a credential: %j', (input, expected) => {
    expect(run(input).redacted).toBe(expected);
  });
});
