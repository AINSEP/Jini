import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const VALUE = 'Zq8wPx3mK7vR2tL9';

// Found by the parity corpus sweep (labels x separators x values x contexts against the rules chat used before). After
// `label:` and a line break, the engine masked the next line only when it held one token and followed a single break.
// The old rules masked a value after blank lines too, and a credential-shaped first token followed by more text
// ("<key> --verbose", "<key> thanks"). One reading now serves the engine's labels and the alias rules alike.
describe('a credential on the line after a colon label', () => {
  it.each(['password', 'Password', 'api_key', 'passwd', 'DB_PASSWORD', 'id_token', 'my-token', 'webhook_secret'])('masks it after %s', label => {
    for (const input of [
      `${label}:\n\n${VALUE}`,
      `${label}:\n${VALUE} --verbose`,
      `Hey, my ${label}:\n\n${VALUE} thanks`,
      `${label}:\n\n"${VALUE}"`,
      `${label}:\ncorrecthorsebatterystaple`,
      `${label}:\n\nhunter2`,
      `APP_SECRET:\n\nhunter2`,
    ]) expect(run(input), input).not.toMatch(/Zq8w|correcthorse|hunter2/);
  });

  it.each([
    'Password:\n\nThe policy is on the wiki.',
    'Password:\nsee the vault entry for this host',
    'passwd:\n\nprints nothing useful here',
    'Token:\n\nTBD',
    'password:\n- Notes: x',
    'api_key:\n\nNEXT=1',
  ])('keeps the next-line prose or form line in %j', input => {
    expect(run(input)).toBe(input);
  });
});

describe('a value glued after a quoted label hint', () => {
  // `"password: "<value>""` is a nested quote pasted without escapes: the quoted hint ends right where the value starts.
  it.each([`curl -H "password: "${VALUE}"" https://x.test`, `x "api_key="${VALUE}"" y`, `"token: "${VALUE}`])('masks the value in %j', input => {
    expect(run(input)).not.toContain(VALUE);
  });

  it('keeps a hint followed by concatenation', () => {
    expect(run('const header = "password: " + value;')).toBe('const header = "[REDACTED:labeled_secret]" + value;');
  });
});

describe('the line after an Authorization header name', () => {
  it.each(['Authorization:\np@ss,w;rd', 'Hey, my authorization:\n\np@ss,w;rd thanks'])('masks the credential in %j', input => {
    expect(run(input)).not.toContain('p@ss');
  });
});
