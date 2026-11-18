import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const A = 'Zq8wPx3mK7vR2tL9';
const B = 'Mf4nB8cX2kJ6hQ1s';

// Three shapes the rules chat used before masked whole and the engine left partly visible.
describe('a cookie assignment with several pairs', () => {
  // A `cookie=` value is a cookie header written as an assignment: every `name=value` pair after `;` is part of it.
  it.each([
    `cookie=sid=${A}; auth=${B}`,
    `Cookie=sid=${A};csrf=${B};theme=dark`,
    `set-cookie=sid=${A}; session_id=${B}; Path=/`,
  ])('masks every pair in %j', input => {
    const out = run(input);
    expect(out).not.toContain(A);
    expect(out).not.toContain(B);
  });

  it('ends the value at the first part that is not a pair', () => {
    const out = run(`cookie=sid=${A}; see the docs`);
    expect(out).not.toContain(A);
    expect(out).toMatch(/ see the docs$/);
  });
});

describe('an auth scheme word assigned as a literal credential', () => {
  // Only an auth header names a scheme word as its value's first part; `password=Bearer` sets the password to that word.
  it.each(['password=Bearer', 'password=Token', 'api_key=Token', 'secret=Digest', 'pwd=ApiKey', 'token=Basic'])('masks %j', input => {
    expect(run(input)).toMatch(/=\[REDACTED:[a-z_]+\]$/);
  });

  it('masks both words of a scheme-shaped password value', () => {
    expect(run(`password=Bearer ${A}`)).not.toMatch(/Bearer|Zq8w/);
  });

  it.each(['Authorization=Bearer', 'Authorization: Bearer', 'x-api-key: Bearer.', 'Authorization: Basic.'])('keeps the header description %j', input => {
    expect(run(input)).toBe(input);
  });
});

describe('Google keys ending in a hyphen', () => {
  // The AQ rule ended at a word boundary, so a key ending in `-` left that last character visible after the marker.
  it.each([
    ['AQ.Ab8RN6Kq3zXb2Lw9Pm4Tv7Yc1Hd5Jf0Gs-', '[REDACTED:google_api_key]'],
    ['key AQ.Ab8RN6Kq3zXb2Lw9Pm4Tv7Yc1Hd5Jf0G-- end', 'key [REDACTED:google_api_key] end'],
    ['(AQ.Ab8RN6Kq3zXb2Lw9Pm4Tv7Yc1Hd5Jf0Gs-)', '([REDACTED:google_api_key])'],
  ])('masks %j through its last character', (input, expected) => {
    expect(run(input)).toBe(expected);
  });
});
