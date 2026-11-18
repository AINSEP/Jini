import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// A label followed by a colon is often prose or a form line, not an assignment: "Password: (skipped)",
// "password: must be at least 8 characters". The value after a colon is a credential only when it is not a
// placeholder, not the start of a sentence, and on the label's own line. The `=` form stays strict.
describe('a colon after a credential word that is followed by prose or a placeholder', () => {
  it.each([
    'Password: (skipped)', '- Password: (skipped)', '- API key: (skipped)', 'Secret: (none)', 'Token: (not provided)',
    'password: must be at least 8 characters', 'The secret: it is a surprise', 'I forgot my password: help me',
    'Please set the password: then save', 'The key: value pair', 'What is token: in JWT?', 'Password: Must be 8 chars',
    'Secret: yes', 'token: none', 'Token: n/a', 'API key: none', 'password: ******', 'secret: TBD', 'Token: pending.', 'api key: needed',
    'Password:\n- Notes: x', 'Password:\n', 'token:   \n  next line',
    '[form answers — f]\n- Password: (skipped)\n- API key: (skipped)\n- Notes: Preserve this prose.',
  ])('keeps %j byte for byte', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it.each([
    ['API key: abc', 'API key: [REDACTED:labeled_secret]'],
    ['password: hunter2', 'password: [REDACTED:labeled_secret]'],
    ['password: hunter2 please', 'password: [REDACTED:labeled_secret] please'],
    ['Secret: Xk9', 'Secret: [REDACTED:labeled_secret]'],
    ['token: abcdefgh12345678', 'token: [REDACTED:labeled_secret]'],
    ['password: correct.', 'password: [REDACTED:labeled_secret]'],
    ['- Password: hunter2\n- Notes: Preserve this prose.', '- Password: [REDACTED:labeled_secret]\n- Notes: Preserve this prose.'],
  ])('still masks a credential-shaped value in %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
  it.each(['password=must be at least 8 characters', 'token=none', 'password=(skipped)'])('keeps the = form strict: %j', input => {
    expect(run(input).redacted).toContain('[REDACTED:labeled_secret]');
  });
  it('resumes the scan after a prose value, so a later label on the line is still checked', () => {
    expect(run('password: must be 8 characters, token: abc').redacted).toBe('password: must be 8 characters, token: [REDACTED:labeled_secret]');
  });
  it('is idempotent', () => {
    const once = run('- Password: hunter2\n- API key: (skipped)').redacted;
    expect(run(once)).toEqual({ redacted: once, counts: {} });
  });
});
