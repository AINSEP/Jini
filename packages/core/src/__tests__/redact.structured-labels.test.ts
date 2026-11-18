import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// A quoted key such as "user password" or "Admin API Key" names a credential by its last words; and an
// env-style name (`DB_PASSWORD=`) may have its value on the next line.
describe('quoted multiword keys that end in a credential name', () => {
  it.each([
    ['{"user password": "hunter2"}', '{"user password": "[REDACTED:labeled_secret]"}'],
    ['{"Admin API Key": "abc123def"}', '{"Admin API Key": "[REDACTED:labeled_secret]"}'],
    ['{"my secret token":"abcdef"}', '{"my secret token":"[REDACTED:labeled_secret]"}'],
    ["{'db password': 'x1'}", "{'db password': '[REDACTED:labeled_secret]'}"],
    ['{\\"user password\\":\\"hunter2\\"}', '{\\"user password\\":\\"[REDACTED:labeled_secret]\\"}'],
    ['{"Client Secret": "a b c"}', '{"Client Secret": "[REDACTED:labeled_secret]"}'],
    ['{"user.password": "hunter2", "page": 2}', '{"user.password": "[REDACTED:labeled_secret]", "page": 2}'],
    ['{"Refresh Token": "r1", "Access Token": "a1"}', '{"Refresh Token": "[REDACTED:labeled_secret]", "Access Token": "[REDACTED:labeled_secret]"}'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it.each([
    '{"password manager": "1Password"}', '{"keyboard layout": "qwerty"}', '{"first name": "Ada"}', '{"secret santa": "Bob"}',
    '{"tokens per minute": "40"}', '{"user password": ""}', '{"user password": 12345}', '{"note": "my password is a secret"}',
  ])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});

describe('a prefixed credential name whose value is on the next line', () => {
  it.each([
    ['DB_PASSWORD=\nhunter2', 'DB_PASSWORD=\n[REDACTED:labeled_secret]'],
    ['DB_PASSWORD=\r\nhunter2\r\nNEXT=1', 'DB_PASSWORD=\r\n[REDACTED:labeled_secret]\r\nNEXT=1'],
    ['APP_SECRET:\n  abcdefgh12345678', 'APP_SECRET:\n  [REDACTED:labeled_secret]'],
    ['my-token:\n"quoted value"', 'my-token:\n"[REDACTED:labeled_secret]"'],
    ['app_secret=\n  s3cr3t\nother', 'app_secret=\n  [REDACTED:labeled_secret]\nother'],
    ['DB_PASSWORD=\nsome words here', 'DB_PASSWORD=\n[REDACTED:labeled_secret] words here'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it.each([
    'DB_PASSWORD=\nDB_USER=app', 'DB_PASSWORD=\n', 'DB_PASSWORD:\n- Notes: x', 'APP_SECRET:\nNotes:\nmore', 'APP_SECRET:\n\nhunter2',
  ])('keeps the next line when it is another assignment, a list item, prose or not adjacent: %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});
