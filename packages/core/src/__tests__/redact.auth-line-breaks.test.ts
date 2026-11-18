import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const VALUE = 'Zq8wPx3mK7vR2tL9';

// The diagnostics rules chat used before it moved onto this engine read any whitespace, line breaks included, between an
// auth header, its scheme word and the credential; the engine read only spaces and tabs on the header's line, and at most
// 16 whitespace characters before a bare Basic/Token value. A header wrapped onto the next line, or a value pasted after
// a run of padding, was then shown in full. Values here are obviously fake.
describe('auth credentials after line breaks and long whitespace', () => {
  it.each([
    `Authorization: Token\n${VALUE}`,
    `Authorization: ApiKey\r\n${VALUE}`,
    `Authorization: Digest\n\n${VALUE}`,
    `Authorization: ApiKey\n\t${VALUE}`,
    `Authorization:\n\n${VALUE}`,
    `Proxy-Authorization: Token\n  ${VALUE}`,
    `Basic${' '.repeat(17)}${VALUE}`,
    `Basic${' '.repeat(64)}${VALUE}`,
    `Token\n\n\n${' '.repeat(40)}${VALUE}`,
    `header Basic${'\t'.repeat(20)}${VALUE}`,
  ])('masks the credential in %j', input => {
    expect(run(input)).not.toContain(VALUE);
  });

  it('keeps prose after a bare scheme word, which has no digit-bearing 16+ character value', () => {
    expect(run(`Token\n\n${' '.repeat(30)}expired yesterday, please rotate`)).toBe(`Token\n\n${' '.repeat(30)}expired yesterday, please rotate`);
  });

  it('reads a long whitespace run in linear time', () => {
    const input = `Basic${' '.repeat(200_000)}x Token${'\n'.repeat(200_000)}y`;
    const started = performance.now();
    expect(run(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
