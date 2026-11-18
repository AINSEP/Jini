import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const VALUE = 'Zq8wPx3mK7vR2tL9';
const LONG_KEY = 'the old production database admin root user account login password';

// Forms of an aliased credential label that the diagnostics rules chat used before masked and the alias rules did not:
// a quoted value holding a backslash escape, a multiword quoted key longer than 60 characters, a quoted value on the
// line after the key, and a value on the line after a standalone alias or an exact-name command-line flag.
describe('aliased credential labels in every form the old chat rules read', () => {
  it.each([
    `"passwd": "a\\\\b ${VALUE}"`,
    `"pwd":"x\\"y ${VALUE}"`,
    `{\\"auth_token\\":\\"a\\\\\\\\b ${VALUE}\\"}`,
    `"${LONG_KEY}": "${VALUE}"`,
    `'${LONG_KEY}': '${VALUE}'`,
    `"backup password":\n"${VALUE}"`,
    `passwd:\n${VALUE}`,
    `pwd=\n${VALUE}`,
    `passwd:\r\n  ${VALUE}`,
    `--token=\n${VALUE}`,
    `--password=\n${VALUE}`,
    `--token:\n${VALUE}`,
  ])('masks the value in %j', input => {
    expect(run(input)).not.toContain(VALUE);
  });

  it('keeps the closing quote and what follows an escaped quoted value', () => {
    expect(run(`{"passwd": "a\\"b", "page": 2}`)).toBe('{"passwd": "[REDACTED:labeled_secret]", "page": 2}');
  });

  it('keeps a next-line heading or sentence after a standalone alias', () => {
    expect(run('passwd:\nNotes: none')).toBe('passwd:\nNotes: none');
    expect(run('pwd:\nprints the working directory')).toBe('pwd:\nprints the working directory');
  });
});

describe('alias forms stay linear', () => {
  it('reads many quotes, escapes and line breaks in bounded time', () => {
    const input = `${'"a b\\\\" '.repeat(20_000)}${'passwd:\n\n'.repeat(20_000)}`;
    const started = performance.now();
    run(input);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
