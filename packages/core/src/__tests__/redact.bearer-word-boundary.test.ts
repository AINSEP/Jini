import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// The short-Bearer rule reads the next word as a credential. Without a word boundary in front of
// "Bearer", a class or pattern name that merely ends in it (TokenBearer, MyBearer) made the word after
// it vanish from user text.
describe('Bearer must start a word to introduce a credential', () => {
  it.each(['TokenBearer is a class', 'The TokenBearer pattern', 'TokenBearer abc', 'MyBearer token is fine', 'ABearer x'])(
    'keeps %j byte for byte', input => {
      expect(run(input)).toEqual({ redacted: input, counts: {} });
    });
  it.each([
    ['Bearer x', 'Bearer [REDACTED:bearer_token]'],
    ['say "Bearer x" now', 'say "Bearer [REDACTED:bearer_token]" now'],
    ['not-a-Bearer abc1 ok', 'not-a-Bearer [REDACTED:bearer_token] ok'],
    ['TokenBearer is Bearer x', 'TokenBearer is Bearer [REDACTED:bearer_token]'],
  ])('still masks the value after a real scheme word in %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
});
