import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;
const PADDED = 'Ab3dEf6hIj9kLm2nOp5qRs8=';

// Base64 padding (`=` at the end of a token) does not make the next line an assignment: the line holds one value.
describe('next-line values that end in padding', () => {
  it.each(['password', 'pwd', 'passwd', 'DB_PASSWORD'])('masks a padded value on the line after %s:', label => {
    expect(run(`${label}:\n${PADDED}`)).toBe(`${label}:\n[REDACTED:labeled_secret]`);
  });

  it('masks a value with double padding after blank lines', () => {
    expect(run('pwd:\n\nAb3dEf6hIj9kLm2nOp5q==')).toBe('pwd:\n\n[REDACTED:labeled_secret]');
  });

  it('keeps a next line that is its own assignment', () => {
    expect(run('pwd:\nNEXT=1')).toBe('pwd:\nNEXT=1');
    expect(run('password:\nmode=fast')).toBe('password:\nmode=fast');
  });
});
