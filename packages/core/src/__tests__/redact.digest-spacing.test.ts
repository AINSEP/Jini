import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const RESPONSE = 'Zq8wPx3mK7vR2tL9';
const OPAQUE = 'Mf4nB8cX2kJ6hQ1s';

// A Digest parameter list was read only as `name=value` with no whitespace around `=`; `response = "..."`, which some
// clients and hand-written examples produce, ended the list after the first name, so the response was shown.
describe('Digest parameters with whitespace around =', () => {
  it.each([' =', '= ', ' = ', '\t=\t'])('masks the whole list with %j', eq => {
    const input = `Authorization: Digest username${eq}"bob", response${eq}"${RESPONSE}", opaque${eq}${OPAQUE}`;
    const out = run(input);
    expect(out).not.toContain(RESPONSE);
    expect(out).not.toContain(OPAQUE);
    expect(out).toBe('Authorization: Digest [REDACTED:api_key_header]');
  });

  it('masks a proxy Digest response written with spaces', () => {
    expect(run(`Proxy-Authorization: Digest response = "${RESPONSE}"`)).not.toContain(RESPONSE);
  });

  it('still ends the list at the header line', () => {
    expect(run(`Authorization: Digest response = "${RESPONSE}"\nnext line stays`)).toMatch(/\nnext line stays$/);
  });
});

describe('Digest spacing stays linear', () => {
  it('reads long space runs around many parameters in bounded time', () => {
    const input = `Authorization: Digest ${'a = b, '.repeat(20_000)}c${' '.repeat(100_000)}`;
    const started = performance.now();
    expect(run(input)).toMatch(/^Authorization: Digest \[REDACTED:api_key_header\]/);
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
