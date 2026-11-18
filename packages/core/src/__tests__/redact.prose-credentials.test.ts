import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// The "prose after a colon" reading exists for sentences and form transcripts. It must not override credential
// syntax: a label that starts its line (or a list item) followed by a value is an assignment, so an alphabetic
// credential, a plain-word passphrase and a value on the next line are masked.
describe('a credential assignment written with a colon is not prose', () => {
  it.each([
    ['password: correct horse battery staple', 'password: [REDACTED:labeled_secret]'],
    ['Password: sunflower\nNotes: x', 'Password: [REDACTED:labeled_secret]\nNotes: x'],
    ['- secret: abcdef xyz', '- secret: [REDACTED:labeled_secret]'],
    ['token: sunflower is the thing', 'token: [REDACTED:labeled_secret]'],
    ['api key: kiwi banana', 'api key: [REDACTED:labeled_secret]'],
    ['1. Password: hunter please', '1. Password: [REDACTED:labeled_secret]'],
    ['Password:\nhunter2', 'Password:\n[REDACTED:labeled_secret]'],
    ['Password:\n  hunter2\nNotes: x', 'Password:\n  [REDACTED:labeled_secret]\nNotes: x'],
    ['my password:\nhunter2', 'my password:\n[REDACTED:labeled_secret]'],
    ['password:\r\nhunter2\r\nnext line', 'password:\r\n[REDACTED:labeled_secret]\r\nnext line'],
    ['password: hunter\nmore', 'password: [REDACTED:labeled_secret]\nmore'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it.each([
    'Password: Must be 8 chars', 'Secret: it is a surprise', 'Password: please choose another', 'Token: the one you were sent', 'password: must be at least 8 characters',
    'I forgot my password: help me', 'Please set the password: then save', 'What is token: in JWT?',
    // 'Password:\n\nhunter2' moved to redact.next-line-values-r3.test.ts: the rules chat used before masked a value after blank lines.
    'Password:\n- Notes: x', 'Password:\nNotes:', 'Password:\n(skipped)', 'Password:\nnone', 'Password:\nnext line', 'Token:\n1 2 3',
    'Password: (skipped)', 'API key: none', 'Secret: TBD',
  ])('keeps the prose or placeholder %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});
