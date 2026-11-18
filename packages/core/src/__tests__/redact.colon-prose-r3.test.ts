import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;

// After a credential label and a colon, a value that starts a sentence is kept as prose. Two readings were wrong:
// a long letters-only password after a label in the middle of a sentence was taken for the first word of a sentence
// (the rules chat used before masked any 12+ character token there), and a field-start policy sentence that begins
// with the label's own word ("Password: Passwords expire...") was taken for a passphrase and hidden.
describe('a long single word after a mid-sentence credential label', () => {
  it.each([
    ['Hey, my password: hunterabcdefghijklmnop thanks', 'hunterabcdefghijklmnop'],
    ['fyi password: correcthorsebatterystaple', 'correcthorsebatterystaple'],
    ['and the token: qwertyuiopasdfgh please store it', 'qwertyuiopasdfgh'],
  ])('masks the word in %j', (input, secret) => {
    expect(run(input)).not.toContain(secret);
  });

  it.each([
    'the password: must be at least 8 characters',
    'I forgot my password: it was reset yesterday',
    'note the secret: rotate it every month',
  ])('keeps the sentence %j', input => {
    expect(run(input)).toBe(input);
  });
});

describe('a field-start sentence that begins with the label word', () => {
  it.each([
    'Password: Passwords expire every 90 days.',
    '- Password: Passwords must be rotated each quarter',
    'Token: Tokens are rotated daily by the platform.',
    '1. Secret: Secrets live in the vault, never in chat.',
    'Password: Password resets are handled by IT',
  ])('keeps %j', input => {
    expect(run(input)).toBe(input);
  });

  it.each([
    ['Password: hunter2', 'hunter2'],
    ['password: correct horse battery staple', 'battery'],
    ['token: sunflower is the thing', 'sunflower'],
    ['Password: Passwordz9x', 'Passwordz9x'],
  ])('still masks the credential in %j', (input, secret) => {
    expect(run(input)).not.toContain(secret);
  });
});
