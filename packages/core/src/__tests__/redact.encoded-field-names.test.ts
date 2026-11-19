import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;

// A field name is matched as it decodes: a percent escape in a URL parameter name or a `\u` escape in a JSON key spells
// the same name as its plain form. Values are obviously fake.
describe('credential field names written with escapes', () => {
  it.each([
    ['https://x.test/?%74oken=abc123&page=2', 'https://x.test/?%74oken=[REDACTED:labeled_secret]&page=2'],
    ['https://x.test/cb#access%5Ftoken=abc123', 'https://x.test/cb#access%5Ftoken=[REDACTED:labeled_secret]'],
    ['user=a&pass%77ord=abc123', 'user=a&pass%77ord=[REDACTED:labeled_secret]'],
  ])('masks a parameter whose decoded name is a credential: %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it.each([
    ['{"\\u0070assword": "hunter2"}', '{"\\u0070assword": "[REDACTED:labeled_secret]"}'],
    ['{"api\\u005fkey":"abc","n":1}', '{"api\\u005fkey":"[REDACTED:labeled_secret]","n":1}'],
    ['{"\\u0074oken": abc123}', '{"\\u0074oken": [REDACTED:labeled_secret]}'],
  ])('masks a JSON value whose decoded key is a credential: %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it.each([
    'https://x.test/?%70age=2&q=a%20b',
    '{"\\u006eame": "Ada"}',
    'https://x.test/?q=%zz&x=1',
  ])('keeps escaped names that are not credentials: %j', input => {
    expect(run(input)).toBe(input);
  });
});
