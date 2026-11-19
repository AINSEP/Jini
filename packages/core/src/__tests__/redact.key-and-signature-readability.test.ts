import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const SHA1 = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

describe('key labels that name a hash or a path', () => {
  it.each([`Cache key: ${SHA1}`, `Hash key: ${SHA1.toUpperCase()}`, 'Error: key: /src/main.ts', 'key: ./config/app.json'])('keeps %j', input => {
    expect(run(input)).toBe(input);
  });

  it.each([
    ['key: abc123', 'key: [REDACTED:labeled_secret]'],
    [`key: ${SHA1}`, 'key: [REDACTED:labeled_secret]'],
    ['key: /Zq8wPx3mK7vR2tL9xYb', 'key: [REDACTED:labeled_secret]'],
    ['Cache key: Zq8wPx3mK7vR2tL9xYb', 'Cache key: [REDACTED:labeled_secret]'],
  ])('masks %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });
});

// A signature is URL-safe text and never holds `#`, so `#` after its value starts the fragment.
describe('URL signature values before a fragment', () => {
  it.each([
    ['https://example.test/?sig=abc123#examples', 'https://example.test/?sig=[REDACTED:signed_query]#examples'],
    ['https://example.test/?X-Amz-Signature=abc123#top', 'https://example.test/?X-Amz-Signature=[REDACTED:signed_query]#top'],
  ])('keeps the fragment: %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it('still reads a fragment as part of a password value', () => {
    expect(run('https://example.test/?password=abc#examples')).toBe('https://example.test/?password=[REDACTED:labeled_secret]');
  });
});
