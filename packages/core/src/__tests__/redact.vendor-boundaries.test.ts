import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });
const fake = (unit: string, times: number) => unit.repeat(times);

// A recognized key must be masked whatever follows it. A trailing word boundary in the key rules left the
// final `-` of a key, or the whole key when an underscore came next, visible.
describe('a vendor-shaped key is masked through its last character', () => {
  it.each([
    [`sk-${fake('a1', 12)}-`, '[REDACTED:sk_key]'],
    [`sk-proj-${fake('a1', 12)}--`, '[REDACTED:sk_key]'],
    [`sk-lf-${fake('a1b2', 5)}-`, '[REDACTED:langfuse_key]'],
    ['xoxb-1234567890-abc-', '[REDACTED:slack_token]'],
    ['eyJaaaa.eyJbbbb.cccc-dd-', '[REDACTED:jwt]'],
    [`sk_live_${fake('a1', 10)}_x`, '[REDACTED:stripe_key]_x'],
    [`pk_test_${fake('a1', 10)}_`, '[REDACTED:stripe_key]_'],
    [`rk_live_${fake('a1', 10)}é`, '[REDACTED:stripe_key]é'],
    [`ghp_${fake('a1', 18)}_x`, '[REDACTED:github_token]_x'],
  ])('%j', (key, expected) => {
    const input = `key ${key} end`;
    const first = run(input);
    expect(first.redacted).toBe(`key ${expected} end`);
    expect(run(first.redacted).redacted).toBe(first.redacted);
  });
  it.each(['x', '_', '-', 'é'])('masks a temporary cloud key id glued after %j just as it does the permanent one', glue => {
    const id = `ASIA${fake('X1', 8)}`;
    expect(run(`key ${glue}${id} end`).redacted).toBe(`key ${glue}[REDACTED:aws_access_key] end`);
  });
  it('keeps a longer uppercase run that merely contains the shape', () => {
    const input = `key ASIA${fake('X1', 8)}1 end`;
    expect(run(input).redacted).toBe(input);
  });
});

// A header written over two lines puts the credential on the line after its scheme word.
describe('a bare Basic or Token credential on the line after its scheme word', () => {
  it.each([
    ['Basic\ndXNlcjpwYXNzd29yZDEyMw==', 'Basic\n[REDACTED:bearer_token]'],
    ['Basic \r\ndXNlcjpwYXNzd29yZDEyMw==', 'Basic \r\n[REDACTED:bearer_token]'],
    ['Token\n  abcdefgh12345678xyz9', 'Token\n  [REDACTED:bearer_token]'],
  ])('%j', (input, expected) => {
    expect(run(input).redacted).toBe(expected);
    expect(run(expected).redacted).toBe(expected);
  });
  it.each(['Basic\nauthentication is not supported', 'Token\nexpired at noon', 'Basic\n\n\nnothing follows'])('keeps prose: %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});
